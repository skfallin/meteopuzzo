from __future__ import annotations

import argparse
import csv
import json
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from io import StringIO
from pathlib import Path
from tempfile import NamedTemporaryFile
from typing import Any
from zoneinfo import ZoneInfo

import requests


CARDINAL_DIRECTIONS = {
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
}
EXPECTED_HEADERS = [
    "Data",
    "Ora",
    "Temp",
    "Min",
    "Max",
    "Umid",
    "Dew pt",
    "Vento",
    "Dir",
    "Raffica",
    "Dir Raff.",
    "Press",
    "Pioggia",
    "Int.Pio.",
    "Rad.Sol.",
    "Ore Bagn",
]
CSV_FIELDNAMES = [
    "timestamp",
    "temperature_c",
    "min_temperature_c",
    "max_temperature_c",
    "humidity_pct",
    "dew_point_c",
    "wind_kmh",
    "wind_direction",
    "gust_kmh",
    "gust_direction",
    "pressure_hpa",
    "precipitation_mm",
    "precipitation_intensity_mm",
    "solar_radiation_wm2",
    "wet_hours",
]


class PipelineError(RuntimeError):
    pass


@dataclass(frozen=True)
class Config:
    station_slug: str
    station_name: str
    timezone_name: str
    lookback_days: int
    max_stale_minutes: int
    expected_cadence_minutes: int
    request_timeout_seconds: int
    retries: int
    retry_delay_seconds: float
    output_dir: Path
    trigger_archive_refresh: bool

    @property
    def timezone(self) -> ZoneInfo:
        return ZoneInfo(self.timezone_name)

    @property
    def archive_url(self) -> str:
        return f"https://stazioni.meteoproject.it/dati/{self.station_slug}/archivio.php"

    def csv_url(self, start_day: date, end_day: date) -> str:
        return (
            f"https://stazioni.meteoproject.it/dati/{self.station_slug}/csv.php"
            f"?gg={end_day.day}&mm={end_day.month}&aa={end_day.year % 100}"
            f"&gg2={start_day.day}&mm2={start_day.month}&aa2={start_day.year % 100}"
        )


@dataclass(frozen=True)
class Observation:
    timestamp: datetime
    temperature_c: float | None
    min_temperature_c: float | None
    max_temperature_c: float | None
    humidity_pct: float | None
    dew_point_c: float | None
    wind_kmh: float | None
    wind_direction: str | None
    gust_kmh: float | None
    gust_direction: str | None
    pressure_hpa: float | None
    precipitation_mm: float | None
    precipitation_intensity_mm: float | None
    solar_radiation_wm2: float | None
    wet_hours: float | None

    def to_json(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "label": self.timestamp.strftime("%d/%m %H:%M"),
            "temperatureC": self.temperature_c,
            "minTemperatureC": self.min_temperature_c,
            "maxTemperatureC": self.max_temperature_c,
            "humidityPct": self.humidity_pct,
            "dewPointC": self.dew_point_c,
            "windKmh": self.wind_kmh,
            "windDirection": self.wind_direction,
            "gustKmh": self.gust_kmh,
            "gustDirection": self.gust_direction,
            "pressureHpa": self.pressure_hpa,
            "precipitationMm": self.precipitation_mm,
            "precipitationIntensityMm": self.precipitation_intensity_mm,
            "solarRadiationWm2": self.solar_radiation_wm2,
            "wetHours": self.wet_hours,
        }

    def to_csv_row(self) -> dict[str, Any]:
        return {
            "timestamp": self.timestamp.isoformat(),
            "temperature_c": self.temperature_c,
            "min_temperature_c": self.min_temperature_c,
            "max_temperature_c": self.max_temperature_c,
            "humidity_pct": self.humidity_pct,
            "dew_point_c": self.dew_point_c,
            "wind_kmh": self.wind_kmh,
            "wind_direction": self.wind_direction,
            "gust_kmh": self.gust_kmh,
            "gust_direction": self.gust_direction,
            "pressure_hpa": self.pressure_hpa,
            "precipitation_mm": self.precipitation_mm,
            "precipitation_intensity_mm": self.precipitation_intensity_mm,
            "solar_radiation_wm2": self.solar_radiation_wm2,
            "wet_hours": self.wet_hours,
        }


def get_logger() -> logging.Logger:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.StreamHandler(sys.stdout)],
    )
    return logging.getLogger("meteopuzzo")


def load_config(output_dir: Path | None = None) -> Config:
    return Config(
        station_slug=os.getenv("METEOPUZZO_STATION_SLUG", "montenero"),
        station_name=os.getenv("METEOPUZZO_STATION_NAME", "Stazione Meteo Montenero"),
        timezone_name=os.getenv("METEOPUZZO_TIMEZONE", "Europe/Rome"),
        lookback_days=int(os.getenv("METEOPUZZO_LOOKBACK_DAYS", "1")),
        max_stale_minutes=int(os.getenv("METEOPUZZO_MAX_STALE_MINUTES", "90")),
        expected_cadence_minutes=int(os.getenv("METEOPUZZO_EXPECTED_CADENCE_MINUTES", "15")),
        request_timeout_seconds=int(os.getenv("METEOPUZZO_REQUEST_TIMEOUT_SECONDS", "20")),
        retries=int(os.getenv("METEOPUZZO_RETRIES", "3")),
        retry_delay_seconds=float(os.getenv("METEOPUZZO_RETRY_DELAY_SECONDS", "2.0")),
        output_dir=output_dir or Path(os.getenv("METEOPUZZO_OUTPUT_DIR", "data")),
        trigger_archive_refresh=os.getenv("METEOPUZZO_TRIGGER_ARCHIVE_REFRESH", "true").lower()
        in {"1", "true", "yes"},
    )


def request_with_retry(
    session: requests.Session,
    url: str,
    *,
    timeout_seconds: int,
    retries: int,
    retry_delay_seconds: float,
    logger: logging.Logger,
) -> requests.Response:
    last_error: Exception | None = None
    for attempt in range(1, retries + 1):
        try:
            response = session.get(url, timeout=timeout_seconds)
            response.raise_for_status()
            return response
        except requests.RequestException as exc:
            last_error = exc
            logger.warning("Request attempt %s/%s failed for %s: %s", attempt, retries, url, exc)
            if attempt < retries:
                time.sleep(retry_delay_seconds * attempt)
    raise PipelineError(f"Request failed after {retries} attempts for {url}") from last_error


def trigger_archive_refresh(
    session: requests.Session,
    config: Config,
    logger: logging.Logger,
) -> tuple[bool, str]:
    if not config.trigger_archive_refresh:
        return False, "Archive refresh trigger disabled"

    trigger_url = f"{config.archive_url}?download=si"
    try:
        response = request_with_retry(
            session,
            trigger_url,
            timeout_seconds=config.request_timeout_seconds,
            retries=config.retries,
            retry_delay_seconds=config.retry_delay_seconds,
            logger=logger,
        )
    except PipelineError as exc:
        logger.warning("Archive refresh trigger failed: %s", exc)
        return False, str(exc)

    body = response.text
    if "Dati aggiornati" in body:
        return True, "Archive refresh acknowledged by source"
    if "Download Nuovi Dati" in body:
        return False, "Source returned archive page without refresh acknowledgement"
    return False, "Source returned unexpected archive refresh response"


def normalize_float(value: str | None) -> float | None:
    if value is None:
        return None
    normalized = value.strip().replace(",", ".")
    if not normalized or normalized.upper() == "NULL":
        return None
    return float(normalized)


def normalize_direction(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip().upper()
    if not normalized or normalized == "NULL":
        return None
    if normalized not in CARDINAL_DIRECTIONS:
        raise PipelineError(f"Unexpected wind direction value: {value}")
    return normalized


def parse_observation(row: list[str], timezone: ZoneInfo) -> Observation:
    if len(row) < len(EXPECTED_HEADERS):
        row = row + [""] * (len(EXPECTED_HEADERS) - len(row))
    timestamp = datetime.strptime(f"{row[0].strip()} {row[1].strip()}", "%d/%m/%Y %H:%M").replace(
        tzinfo=timezone
    )
    return Observation(
        timestamp=timestamp,
        temperature_c=normalize_float(row[2]),
        min_temperature_c=normalize_float(row[3]),
        max_temperature_c=normalize_float(row[4]),
        humidity_pct=normalize_float(row[5]),
        dew_point_c=normalize_float(row[6]),
        wind_kmh=normalize_float(row[7]),
        wind_direction=normalize_direction(row[8]),
        gust_kmh=normalize_float(row[9]),
        gust_direction=normalize_direction(row[10]),
        pressure_hpa=normalize_float(row[11]),
        precipitation_mm=normalize_float(row[12]),
        precipitation_intensity_mm=normalize_float(row[13]),
        solar_radiation_wm2=normalize_float(row[14]),
        wet_hours=normalize_float(row[15]),
    )


def parse_csv_payload(payload: str, timezone: ZoneInfo) -> tuple[list[Observation], dict[str, int]]:
    reader = csv.reader(StringIO(payload), delimiter=";")
    rows = list(reader)
    if not rows:
        raise PipelineError("Source returned an empty CSV payload")

    header = [column.strip().strip('"') for column in rows[0]]
    if header != EXPECTED_HEADERS:
        raise PipelineError(f"Unexpected CSV headers: {header}")

    observations: list[Observation] = []
    skipped_footer_rows = 0
    skipped_empty_rows = 0
    seen_timestamps: set[str] = set()

    for row in rows[1:]:
        normalized = [cell.strip().strip('"') for cell in row]
        if not any(normalized):
            skipped_empty_rows += 1
            continue
        first_cell = normalized[0]
        if first_cell in {"Unita di misura", "Temperatura: C"}:
            skipped_footer_rows += 1
            continue
        if len(normalized) < 2 or not normalized[0] or not normalized[1]:
            skipped_footer_rows += 1
            continue

        observation = parse_observation(normalized, timezone)
        timestamp_key = observation.timestamp.isoformat()
        if timestamp_key in seen_timestamps:
            continue
        seen_timestamps.add(timestamp_key)
        observations.append(observation)

    observations.sort(key=lambda item: item.timestamp)
    if not observations:
        raise PipelineError("No valid observations found in CSV payload")

    return observations, {
        "raw_row_count": len(rows),
        "observation_count": len(observations),
        "skipped_footer_rows": skipped_footer_rows,
        "skipped_empty_rows": skipped_empty_rows,
    }


def assert_range(name: str, value: float | None, minimum: float, maximum: float) -> None:
    if value is None:
        return
    if value < minimum or value > maximum:
        raise PipelineError(f"{name}={value} outside expected range [{minimum}, {maximum}]")


def validate_observations(
    observations: list[Observation],
    *,
    now: datetime,
    max_stale_minutes: int,
    minimum_observations: int,
) -> list[dict[str, Any]]:
    if len(observations) < minimum_observations:
        raise PipelineError(
            f"Observation count too low: {len(observations)} < required minimum {minimum_observations}"
        )

    checks: list[dict[str, Any]] = []

    last_observation = observations[-1]
    age_minutes = round((now - last_observation.timestamp).total_seconds() / 60, 1)
    freshness_ok = age_minutes <= max_stale_minutes
    checks.append(
        {
            "name": "freshness",
            "ok": freshness_ok,
            "details": (
                f"Last observation at {last_observation.timestamp.isoformat()} "
                f"({age_minutes} minutes old)"
            ),
        }
    )
    if not freshness_ok:
        raise PipelineError(
            f"Latest observation is stale: {age_minutes} minutes old (threshold {max_stale_minutes})"
        )

    gaps = []
    for previous, current in zip(observations, observations[1:]):
        gap = round((current.timestamp - previous.timestamp).total_seconds() / 60)
        gaps.append(gap)
        if gap <= 0:
            raise PipelineError("Observation timestamps are not strictly increasing")
    checks.append(
        {
            "name": "cadence",
            "ok": True,
            "details": f"Observed max gap {max(gaps) if gaps else 0} minutes",
        }
    )

    for observation in observations:
        assert_range("temperature_c", observation.temperature_c, -40, 60)
        assert_range("min_temperature_c", observation.min_temperature_c, -40, 60)
        assert_range("max_temperature_c", observation.max_temperature_c, -40, 60)
        assert_range("humidity_pct", observation.humidity_pct, 0, 100)
        assert_range("dew_point_c", observation.dew_point_c, -60, 50)
        assert_range("wind_kmh", observation.wind_kmh, 0, 250)
        assert_range("gust_kmh", observation.gust_kmh, 0, 300)
        assert_range("pressure_hpa", observation.pressure_hpa, 850, 1100)
        assert_range("precipitation_mm", observation.precipitation_mm, 0, 500)
        assert_range("precipitation_intensity_mm", observation.precipitation_intensity_mm, 0, 500)
        assert_range("solar_radiation_wm2", observation.solar_radiation_wm2, 0, 1600)
        assert_range("wet_hours", observation.wet_hours, 0, 24)

    checks.append({"name": "ranges", "ok": True, "details": "All numeric values are within expected bounds"})
    return checks


def atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as temp_file:
        temp_file.write(content)
        temp_name = temp_file.name
    Path(temp_name).replace(path)


def write_csv(path: Path, observations: list[Observation]) -> None:
    with NamedTemporaryFile("w", encoding="utf-8", newline="", dir=path.parent, delete=False) as temp_file:
        writer = csv.DictWriter(temp_file, fieldnames=CSV_FIELDNAMES)
        writer.writeheader()
        for observation in observations:
            writer.writerow(observation.to_csv_row())
        temp_name = temp_file.name
    Path(temp_name).replace(path)


def build_series_payload(
    *,
    config: Config,
    generated_at: datetime,
    observations: list[Observation],
) -> dict[str, Any]:
    latest = observations[-1]
    observation_rows = [observation.to_json() for observation in observations]
    return {
        "station": {
            "name": config.station_name,
            "slug": config.station_slug,
            "timezone": config.timezone_name,
            "sourceUrl": config.archive_url,
        },
        "generatedAt": generated_at.isoformat(),
        "lastObservationAt": latest.timestamp.isoformat(),
        "observationCount": len(observations),
        "observations": observation_rows,
        "records": observation_rows,
    }


def build_status_payload(
    *,
    config: Config,
    generated_at: datetime,
    observations: list[Observation],
    checks: list[dict[str, Any]],
    parse_metrics: dict[str, int],
    trigger_ok: bool,
    trigger_details: str,
) -> dict[str, Any]:
    latest = observations[-1]
    age_minutes = round((generated_at - latest.timestamp).total_seconds() / 60, 1)
    warnings = []
    if config.trigger_archive_refresh and not trigger_ok:
        warnings.append(trigger_details)

    status = "ok"
    message = "Dati validi e aggiornati"
    if age_minutes > (config.expected_cadence_minutes * 2):
        status = "degraded"
        message = (
            f"La sorgente e in ritardo di {age_minutes} minuti rispetto alla cadenza attesa di "
            f"{config.expected_cadence_minutes} minuti"
        )
    if age_minutes > config.max_stale_minutes:
        status = "stale"
        message = f"Ultimo dato disponibile vecchio di {age_minutes} minuti"

    return {
        "ok": True,
        "status": status,
        "message": message,
        "generatedAt": generated_at.isoformat(),
        "publishedAt": generated_at.isoformat(),
        "lastObservationAt": latest.timestamp.isoformat(),
        "sourceUpdatedAt": latest.timestamp.isoformat(),
        "observationAgeMinutes": age_minutes,
        "expectedCadenceMinutes": config.expected_cadence_minutes,
        "staleAfterMinutes": config.max_stale_minutes,
        "stale": age_minutes > config.max_stale_minutes,
        "rowCount": len(observations),
        "observationCount": len(observations),
        "triggerArchiveRefresh": {
            "attempted": config.trigger_archive_refresh,
            "ok": trigger_ok,
            "details": trigger_details,
        },
        "metrics": parse_metrics,
        "checks": checks,
        "warnings": warnings,
        "source": {
            "archiveUrl": config.archive_url,
            "lookbackDays": config.lookback_days,
        },
    }


def publish_outputs(
    *,
    config: Config,
    observations: list[Observation],
    series_payload: dict[str, Any],
    status_payload: dict[str, Any],
) -> None:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    write_csv(config.output_dir / "latest.csv", observations)
    atomic_write_text(
        config.output_dir / "series.json",
        json.dumps(series_payload, ensure_ascii=True, indent=2) + "\n",
    )
    atomic_write_text(
        config.output_dir / "status.json",
        json.dumps(status_payload, ensure_ascii=True, indent=2) + "\n",
    )


def run_pipeline(config: Config, logger: logging.Logger) -> None:
    generated_at = datetime.now(config.timezone)
    start_day = (generated_at - timedelta(days=config.lookback_days)).date()
    end_day = generated_at.date()
    csv_url = config.csv_url(start_day, end_day)

    session = requests.Session()
    session.headers.update(
        {
            "User-Agent": "meteopuzzo/2.0 (+https://github.com/skfallin/meteopuzzo)",
            "Accept": "text/csv,text/plain,application/csv,*/*",
        }
    )

    trigger_ok, trigger_details = trigger_archive_refresh(session, config, logger)
    response = request_with_retry(
        session,
        csv_url,
        timeout_seconds=config.request_timeout_seconds,
        retries=config.retries,
        retry_delay_seconds=config.retry_delay_seconds,
        logger=logger,
    )

    content_type = response.headers.get("Content-Type", "")
    if "csv" not in content_type.lower():
        raise PipelineError(f"Unexpected content type for CSV endpoint: {content_type}")

    observations, parse_metrics = parse_csv_payload(response.text, config.timezone)
    checks = validate_observations(
        observations,
        now=generated_at,
        max_stale_minutes=config.max_stale_minutes,
        minimum_observations=max(4, config.lookback_days * 24),
    )
    series_payload = build_series_payload(
        config=config,
        generated_at=generated_at,
        observations=observations,
    )
    status_payload = build_status_payload(
        config=config,
        generated_at=generated_at,
        observations=observations,
        checks=checks,
        parse_metrics=parse_metrics,
        trigger_ok=trigger_ok,
        trigger_details=trigger_details,
    )
    publish_outputs(
        config=config,
        observations=observations,
        series_payload=series_payload,
        status_payload=status_payload,
    )
    logger.info("Published %s observations to %s", len(observations), config.output_dir)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Fetch, validate and publish MeteoProject weather data.")
    parser.add_argument(
        "--output-dir",
        default=None,
        help="Directory where latest.csv, series.json and status.json will be written",
    )
    parser.add_argument(
        "--skip-trigger",
        action="store_true",
        help="Do not hit archivio.php?download=si before downloading the CSV",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    logger = get_logger()
    config = load_config(Path(args.output_dir) if args.output_dir else None)
    if args.skip_trigger:
        config = Config(**{**config.__dict__, "trigger_archive_refresh": False})

    try:
        run_pipeline(config, logger)
    except Exception as exc:
        logger.error("Weather data pipeline failed: %s", exc, exc_info=True)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
