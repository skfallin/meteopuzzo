from __future__ import annotations

import argparse
import functools
import json
import logging
import os
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from meteopuzzo_backend import MeteopuzzoBackend, RefreshFailedError, RefreshInProgressError, SnapshotUnavailableError


class MeteopuzzoRequestHandler(SimpleHTTPRequestHandler):
    server_version = "MeteopuzzoHTTP/1.0"
    sys_version = ""

    @property
    def backend(self) -> MeteopuzzoBackend:
        return self.server.backend  # type: ignore[attr-defined]

    def do_GET(self) -> None:
        if self._route_api_get():
            return
        super().do_GET()

    def do_OPTIONS(self) -> None:
        self.send_response(HTTPStatus.NO_CONTENT)
        self.end_headers()

    def do_POST(self) -> None:
        route = urlparse(self.path).path
        if route == "/api/refresh":
            self._handle_refresh()
            return
        self.send_error(HTTPStatus.NOT_FOUND, "Unknown endpoint")

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Access-Control-Allow-Origin", self.server.allow_origin)  # type: ignore[attr-defined]
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        super().end_headers()

    def _route_api_get(self) -> bool:
        route = urlparse(self.path).path
        if route == "/api/health" or route == "/api/refresh-status":
            self._handle_health()
            return True
        if route == "/api/dashboard":
            self._handle_dashboard()
            return True
        if route == "/api/refresh":
            self.send_error(HTTPStatus.METHOD_NOT_ALLOWED, "Use POST for /api/refresh")
            return True
        return False

    def _handle_health(self) -> None:
        self._send_json(self._live_payload())

    def _handle_dashboard(self) -> None:
        try:
            payload = self.backend.dashboard_snapshot()
            self._send_json(
                {
                    **self._live_payload(),
                    "series": payload["series"],
                    "status": payload["status"],
                }
            )
        except SnapshotUnavailableError as exc:
            self._send_json(
                {
                    **self._live_payload(),
                    "error": str(exc),
                },
                status=HTTPStatus.SERVICE_UNAVAILABLE,
            )

    def _handle_refresh(self) -> None:
        self._discard_request_body()
        try:
            payload = self.backend.refresh_live()
            self._send_json(
                {
                    **self._live_payload(),
                    "series": payload["series"],
                    "status": payload["status"],
                    "refresh": payload["refresh"],
                }
            )
        except RefreshInProgressError as exc:
            self._send_json(
                {
                    **self._live_payload(),
                    "error": str(exc),
                },
                status=HTTPStatus.ACCEPTED,
            )
        except RefreshFailedError as exc:
            body: dict[str, Any] = {
                **self._live_payload(),
                "error": str(exc),
            }
            if exc.snapshot is not None:
                body["series"] = exc.snapshot["series"]
                body["status"] = exc.snapshot["status"]
            self._send_json(body, status=HTTPStatus.BAD_GATEWAY)

    def _send_json(self, payload: dict[str, Any], *, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def _discard_request_body(self) -> None:
        content_length = int(self.headers.get("Content-Length", "0") or 0)
        if content_length:
            self.rfile.read(content_length)

    def _live_payload(self) -> dict[str, Any]:
        snapshot_available = True
        snapshot = None
        try:
            snapshot = self.backend.dashboard_snapshot()
        except SnapshotUnavailableError:
            snapshot_available = False

        status_payload = snapshot["status"] if snapshot else {}
        observation_count = status_payload.get("observationCount")
        if observation_count is None and snapshot:
            observation_count = snapshot["series"].get("observationCount")

        return {
            "ok": True,
            "refreshSupported": True,
            "state": self.backend.refresh_status_payload(),
            "snapshot": {
                "available": snapshot_available,
                "publishedAt": status_payload.get("publishedAt"),
                "sourceUpdatedAt": status_payload.get("sourceUpdatedAt"),
                "status": status_payload.get("status"),
                "stale": status_payload.get("stale"),
                "message": status_payload.get("message"),
                "observationCount": observation_count,
            },
            "backend": self.backend.backend_payload(),
        }


def create_server(root_dir: Path, host: str, port: int) -> ThreadingHTTPServer:
    backend = MeteopuzzoBackend(root_dir)
    handler = functools.partial(MeteopuzzoRequestHandler, directory=str(root_dir))
    server = ThreadingHTTPServer((host, port), handler)
    server.backend = backend  # type: ignore[attr-defined]
    server.allow_origin = os.getenv("METEOPUZZO_ALLOW_ORIGIN", "*")  # type: ignore[attr-defined]
    return server


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve the Meteopuzzo dashboard with live refresh API.")
    parser.add_argument("--host", default="127.0.0.1", help="Host to bind")
    parser.add_argument("--port", type=int, default=8000, help="Port to bind")
    parser.add_argument(
        "--root",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Repository root to serve",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    root_dir = args.root.resolve()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    server = create_server(root_dir, args.host, args.port)
    print(f"Serving Meteopuzzo from {root_dir} at http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping server")
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
