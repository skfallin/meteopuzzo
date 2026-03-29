from __future__ import annotations

import json
import logging
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from update_data import Config, load_config, run_pipeline


class SnapshotUnavailableError(RuntimeError):
    pass


class RefreshInProgressError(RuntimeError):
    pass


class RefreshFailedError(RuntimeError):
    def __init__(
        self,
        message: str,
        *,
        snapshot: dict[str, Any] | None = None,
        progress: list[dict[str, Any]] | None = None,
    ):
        super().__init__(message)
        self.snapshot = snapshot
        self.progress = progress or []


@dataclass(frozen=True)
class RefreshResult:
    ok: bool
    state: str
    started_at: str
    finished_at: str
    duration_ms: int
    message: str


class MeteopuzzoBackend:
    def __init__(
        self,
        root_dir: Path,
        *,
        config_loader: Callable[[Path | None], Config] = load_config,
        pipeline_runner: Callable[..., dict[str, Any] | None] = run_pipeline,
    ) -> None:
        self.root_dir = root_dir.resolve()
        self.data_dir = self.root_dir / "data"
        self._config_loader = config_loader
        self._pipeline_runner = pipeline_runner
        self._logger = logging.getLogger("meteopuzzo.backend")
        self._refresh_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._refresh_in_progress = False
        self._last_refresh_started_at: str | None = None
        self._last_refresh_finished_at: str | None = None
        self._last_refresh_state: str | None = None
        self._last_refresh_message: str | None = None
        self._last_refresh_progress: list[dict[str, Any]] = []

    def dashboard_snapshot(self) -> dict[str, Any]:
        series = self._load_json(self.data_dir / "series.json")
        status = self._load_json(self.data_dir / "status.json")
        return {
            "backend": self.backend_payload(),
            "series": series,
            "status": status,
        }

    def refresh_live(self) -> dict[str, Any]:
        if not self._refresh_lock.acquire(blocking=False):
            raise RefreshInProgressError("A refresh is already in progress")

        started_at = _utc_now_iso()
        self._set_refresh_state(True, started_at=started_at, finished_at=None, state="running", message="Refresh live avviato")
        progress_events: list[dict[str, Any]] = []
        try:
            config = self._config_loader(self.data_dir)
            pipeline_result = self._pipeline_runner(
                config,
                self._logger,
                progress_callback=lambda step, message: self._record_progress_event(progress_events, step, message),
            )
            finished_at = _utc_now_iso()
            result = RefreshResult(
                ok=True,
                state="completed",
                started_at=started_at,
                finished_at=finished_at,
                duration_ms=_duration_ms(started_at, finished_at),
                message="Live refresh completed",
            )
            self._set_refresh_state(
                False,
                started_at=started_at,
                finished_at=finished_at,
                state=result.state,
                message=result.message,
            )
            snapshot = self.dashboard_snapshot()
            return {
                **snapshot,
                "refresh": {
                    "ok": result.ok,
                    "state": result.state,
                    "startedAt": result.started_at,
                    "finishedAt": result.finished_at,
                    "durationMs": result.duration_ms,
                    "message": result.message,
                    "progress": progress_events,
                    "pipeline": pipeline_result,
                },
            }
        except Exception as exc:  # pragma: no cover - exercised through tests via injected runner
            finished_at = _utc_now_iso()
            self._set_refresh_state(
                False,
                started_at=started_at,
                finished_at=finished_at,
                state="failed",
                message=str(exc),
            )
            snapshot: dict[str, Any] | None
            try:
                snapshot = self.dashboard_snapshot()
            except SnapshotUnavailableError:
                snapshot = None
            raise RefreshFailedError(str(exc), snapshot=snapshot, progress=progress_events) from exc
        finally:
            self._refresh_lock.release()

    def refresh_status_payload(self) -> dict[str, Any]:
        with self._state_lock:
            progress = [dict(event) for event in self._last_refresh_progress]
            last_step = progress[-1]["step"] if progress else None
            state = self._last_refresh_state or ("running" if self._refresh_in_progress else "idle")
            phase = "running" if self._refresh_in_progress else (
                "success" if state == "completed" else "error" if state == "failed" else "idle"
            )
            if phase == "running":
                step = last_step or "queued"
            elif phase == "success":
                step = "completed"
            elif phase == "error":
                step = "failed"
            else:
                step = "idle"

            return {
                "running": self._refresh_in_progress,
                "phase": phase,
                "step": step,
                "message": self._last_refresh_message or "Backend live pronto.",
                "error": self._last_refresh_message if phase == "error" else None,
                "startedAt": self._last_refresh_started_at,
                "completedAt": self._last_refresh_finished_at,
                "progress": progress,
            }

    def backend_payload(self) -> dict[str, Any]:
        with self._state_lock:
            return {
                "name": "meteopuzzo-local-backend",
                "apiVersion": 1,
                "mode": "local-http",
                "dataDirectory": "data",
                "capabilities": {
                    "servesStaticAssets": True,
                    "supportsLiveRefresh": True,
                    "refreshEndpoint": "/api/refresh",
                    "dashboardEndpoint": "/api/dashboard",
                    "statusEndpoint": "/api/refresh-status",
                    "refreshInProgress": self._refresh_in_progress,
                    "lastRefreshStartedAt": self._last_refresh_started_at,
                    "lastRefreshFinishedAt": self._last_refresh_finished_at,
                    "lastRefreshState": self._last_refresh_state,
                    "lastRefreshMessage": self._last_refresh_message,
                },
            }

    def _set_refresh_state(
        self,
        in_progress: bool,
        *,
        started_at: str | None,
        finished_at: str | None,
        state: str | None,
        message: str | None,
    ) -> None:
        with self._state_lock:
            self._refresh_in_progress = in_progress
            self._last_refresh_started_at = started_at
            self._last_refresh_finished_at = finished_at
            self._last_refresh_state = state
            self._last_refresh_message = message
            if in_progress:
                self._last_refresh_progress = []

    def _load_json(self, path: Path) -> dict[str, Any]:
        if not path.exists():
            raise SnapshotUnavailableError(f"Missing snapshot file: {path}")

        with path.open(encoding="utf-8") as handle:
            payload = json.load(handle)

        if not isinstance(payload, dict):
            raise SnapshotUnavailableError(f"Snapshot file is not a JSON object: {path}")

        return payload

    def _record_progress_event(
        self,
        progress_events: list[dict[str, Any]],
        step: str,
        message: str,
    ) -> None:
        event = {
            "step": step,
            "message": message,
            "at": _utc_now_iso(),
        }
        progress_events.append(event)
        with self._state_lock:
            self._last_refresh_message = message
            self._last_refresh_progress.append(dict(event))


def _utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _duration_ms(started_at: str, finished_at: str) -> int:
    started = datetime.fromisoformat(started_at)
    finished = datetime.fromisoformat(finished_at)
    return max(0, round((finished - started).total_seconds() * 1000))
