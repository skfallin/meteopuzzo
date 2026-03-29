import json
from pathlib import Path

import pytest

from meteopuzzo_backend import MeteopuzzoBackend, RefreshFailedError, RefreshInProgressError


def _write_snapshot(data_dir: Path, *, generated_at: str = "2026-03-29T08:08:25.439521+02:00") -> None:
    series = {
        "station": {
            "name": "Stazione Meteo Montenero",
            "slug": "montenero",
            "timezone": "Europe/Rome",
            "sourceUrl": "https://stazioni.meteoproject.it/dati/montenero/archivio.php",
        },
        "generatedAt": generated_at,
        "lastObservationAt": "2026-03-29T03:00:00+02:00",
        "observationCount": 1,
        "observations": [],
        "records": [{"timestamp": "2026-03-29T03:00:00+02:00", "label": "29/03 03:00"}],
    }
    status = {
        "ok": True,
        "status": "ok",
        "generatedAt": generated_at,
        "publishedAt": generated_at,
        "sourceUpdatedAt": "2026-03-29T03:00:00+02:00",
        "stale": False,
        "rowCount": 1,
    }
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "series.json").write_text(json.dumps(series), encoding="utf-8")
    (data_dir / "status.json").write_text(json.dumps(status), encoding="utf-8")


def test_dashboard_snapshot_includes_backend_capabilities(tmp_path: Path) -> None:
    _write_snapshot(tmp_path / "data")
    backend = MeteopuzzoBackend(tmp_path)

    payload = backend.dashboard_snapshot()

    assert payload["series"]["observationCount"] == 1
    assert payload["status"]["stale"] is False
    assert payload["backend"]["capabilities"]["supportsLiveRefresh"] is True
    assert payload["backend"]["capabilities"]["refreshInProgress"] is False


def test_refresh_live_updates_snapshot_and_reports_metadata(tmp_path: Path) -> None:
    data_dir = tmp_path / "data"
    _write_snapshot(data_dir, generated_at="2026-03-29T08:00:00+02:00")

    def pipeline_runner(config, logger, progress_callback=None):
        if progress_callback is not None:
            progress_callback("triggering_source", "Richiedo alla sorgente la preparazione di un nuovo snapshot.")
            progress_callback("downloading_csv", "Scarico il CSV piu recente dalla sorgente meteo.")
        payload = json.loads((config.output_dir / "series.json").read_text(encoding="utf-8"))
        payload["generatedAt"] = "2026-03-29T08:30:00+02:00"
        payload["lastObservationAt"] = "2026-03-29T03:15:00+02:00"
        payload["records"] = [{"timestamp": "2026-03-29T03:15:00+02:00", "label": "29/03 03:15"}]
        payload["observations"] = payload["records"]
        (config.output_dir / "series.json").write_text(json.dumps(payload), encoding="utf-8")

        status = json.loads((config.output_dir / "status.json").read_text(encoding="utf-8"))
        status["generatedAt"] = "2026-03-29T08:30:00+02:00"
        status["publishedAt"] = "2026-03-29T08:30:00+02:00"
        status["sourceUpdatedAt"] = "2026-03-29T03:15:00+02:00"
        (config.output_dir / "status.json").write_text(json.dumps(status), encoding="utf-8")
        return {
            "generatedAt": "2026-03-29T08:30:00+02:00",
            "observationCount": 1,
            "seriesPayload": payload,
            "statusPayload": status,
            "triggerOk": True,
            "triggerDetails": "ok",
        }

    backend = MeteopuzzoBackend(tmp_path, pipeline_runner=pipeline_runner)

    payload = backend.refresh_live()

    assert payload["refresh"]["ok"] is True
    assert payload["refresh"]["state"] == "completed"
    assert payload["refresh"]["progress"][0]["step"] == "triggering_source"
    assert payload["refresh"]["pipeline"]["triggerOk"] is True
    assert payload["series"]["generatedAt"] == "2026-03-29T08:30:00+02:00"
    assert payload["status"]["sourceUpdatedAt"] == "2026-03-29T03:15:00+02:00"


def test_refresh_live_rejects_concurrent_requests(tmp_path: Path) -> None:
    _write_snapshot(tmp_path / "data")
    backend = MeteopuzzoBackend(tmp_path)
    assert backend._refresh_lock.acquire(blocking=False) is True

    try:
        with pytest.raises(RefreshInProgressError):
            backend.refresh_live()
    finally:
        backend._refresh_lock.release()


def test_refresh_live_wraps_pipeline_errors_with_partial_snapshot(tmp_path: Path) -> None:
    _write_snapshot(tmp_path / "data")

    def pipeline_runner(config, logger, progress_callback=None):
        if progress_callback is not None:
            progress_callback("triggering_source", "Richiedo alla sorgente la preparazione di un nuovo snapshot.")
        raise RuntimeError("boom")

    backend = MeteopuzzoBackend(tmp_path, pipeline_runner=pipeline_runner)

    with pytest.raises(RefreshFailedError) as excinfo:
        backend.refresh_live()

    assert excinfo.value.snapshot is not None
    assert excinfo.value.snapshot["status"]["status"] == "ok"
    assert excinfo.value.progress[0]["step"] == "triggering_source"
