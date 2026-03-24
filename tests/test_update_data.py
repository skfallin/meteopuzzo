import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from update_data import (
    Config,
    PipelineError,
    build_series_payload,
    build_status_payload,
    parse_csv_payload,
    publish_outputs,
    validate_observations,
)


SAMPLE_CSV = """Data;Ora;Temp;Min;Max;Umid;"Dew pt";Vento;Dir;Raffica;"Dir Raff.";Press;Pioggia;Int.Pio.;Rad.Sol.;"Ore Bagn"
24/3/2026;8:30;12.9;12.5;12.9;71;7.1;8.0;NW;24.1;NW;1016.1;0.0;0.0;323;NULL
24/3/2026;8:45;13.3;12.9;13.3;72;7.7;9.7;NW;20.9;NW;1016.2;0.0;0.0;362;NULL
24/3/2026;9:00;13.3;13.3;13.5;72;7.7;12.9;NNW;25.7;NW;1016.4;0.0;0.0;306;NULL

"Unita di misura"
"Temperatura: C";;"Vento: km/h";;"Pressione: hPa";;"Radiazione Solare: W/mq";;;"Precipitazione ed ET: mm"
"""


@pytest.fixture
def config(tmp_path: Path) -> Config:
    return Config(
        station_slug="montenero",
        station_name="Stazione Meteo Montenero",
        timezone_name="Europe/Rome",
        lookback_days=1,
        max_stale_minutes=45,
        expected_cadence_minutes=15,
        request_timeout_seconds=20,
        retries=3,
        retry_delay_seconds=0.1,
        output_dir=tmp_path,
        trigger_archive_refresh=False,
    )


def test_parse_csv_payload_removes_footer_and_parses_values() -> None:
    observations, metrics = parse_csv_payload(SAMPLE_CSV, ZoneInfo("Europe/Rome"))

    assert len(observations) == 3
    assert metrics["skipped_footer_rows"] == 2
    assert observations[-1].timestamp.isoformat() == "2026-03-24T09:00:00+01:00"
    assert observations[-1].wind_direction == "NNW"
    assert observations[-1].wet_hours is None


def test_parse_csv_payload_rejects_unexpected_headers() -> None:
    with pytest.raises(PipelineError):
        parse_csv_payload("bad;header\n1;2\n", ZoneInfo("Europe/Rome"))


def test_validate_observations_rejects_stale_data() -> None:
    observations, _ = parse_csv_payload(SAMPLE_CSV, ZoneInfo("Europe/Rome"))
    now = datetime(2026, 3, 24, 10, 0, tzinfo=ZoneInfo("Europe/Rome"))

    with pytest.raises(PipelineError):
        validate_observations(
            observations,
            now=now,
            max_stale_minutes=45,
            minimum_observations=2,
        )


def test_publish_outputs_writes_json_and_csv(tmp_path: Path, config: Config) -> None:
    config = Config(**{**config.__dict__, "output_dir": tmp_path})
    observations, metrics = parse_csv_payload(SAMPLE_CSV, ZoneInfo("Europe/Rome"))
    generated_at = datetime(2026, 3, 24, 9, 10, tzinfo=ZoneInfo("Europe/Rome"))
    checks = validate_observations(
        observations,
        now=generated_at,
        max_stale_minutes=45,
        minimum_observations=2,
    )
    series = build_series_payload(config=config, generated_at=generated_at, observations=observations)
    status = build_status_payload(
        config=config,
        generated_at=generated_at,
        observations=observations,
        checks=checks,
        parse_metrics=metrics,
        trigger_ok=False,
        trigger_details="disabled",
    )

    publish_outputs(
        config=config,
        observations=observations,
        series_payload=series,
        status_payload=status,
    )

    latest_csv = (tmp_path / "latest.csv").read_text(encoding="utf-8")
    series_json = json.loads((tmp_path / "series.json").read_text(encoding="utf-8"))
    status_json = json.loads((tmp_path / "status.json").read_text(encoding="utf-8"))

    assert "timestamp,temperature_c" in latest_csv
    assert series_json["observationCount"] == 3
    assert status_json["ok"] is True
