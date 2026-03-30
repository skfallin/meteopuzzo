from __future__ import annotations

import json
import os
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler
from typing import Any

from meteopuzzo_backend import RefreshFailedError, RefreshInProgressError, SnapshotUnavailableError
from meteopuzzo_runtime import get_runtime_backend


def send_json(
    request_handler: BaseHTTPRequestHandler,
    payload: dict[str, Any],
    *,
    status: HTTPStatus = HTTPStatus.OK,
) -> None:
    body = json.dumps(payload, ensure_ascii=True, indent=2).encode("utf-8")
    request_handler.send_response(status)
    request_handler.send_header("Content-Type", "application/json; charset=utf-8")
    request_handler.send_header("Content-Length", str(len(body)))
    request_handler.send_header("Cache-Control", "no-store")
    request_handler.send_header("X-Content-Type-Options", "nosniff")
    _append_cors_headers(request_handler)
    request_handler.end_headers()
    request_handler.wfile.write(body)


def send_options(request_handler: BaseHTTPRequestHandler) -> None:
    request_handler.send_response(HTTPStatus.NO_CONTENT)
    request_handler.send_header("X-Content-Type-Options", "nosniff")
    _append_cors_headers(request_handler)
    request_handler.end_headers()


def discard_request_body(request_handler: BaseHTTPRequestHandler) -> None:
    content_length = int(request_handler.headers.get("Content-Length", "0") or 0)
    if content_length:
        request_handler.rfile.read(content_length)


def _append_cors_headers(request_handler: BaseHTTPRequestHandler) -> None:
    allow_origin = os.getenv("METEOPUZZO_ALLOW_ORIGIN", "").strip()
    if not allow_origin:
        return

    request_handler.send_header("Access-Control-Allow-Origin", allow_origin)
    request_handler.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    request_handler.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")


def handle_health(request_handler: BaseHTTPRequestHandler) -> None:
    backend = get_runtime_backend()
    send_json(request_handler, backend.live_payload())


def handle_dashboard(request_handler: BaseHTTPRequestHandler) -> None:
    backend = get_runtime_backend()
    try:
        payload = backend.dashboard_snapshot()
        send_json(
            request_handler,
            {
                **backend.live_payload(snapshot=payload),
                "series": payload["series"],
                "status": payload["status"],
            },
        )
    except SnapshotUnavailableError as exc:
        send_json(
            request_handler,
            {
                **backend.live_payload(),
                "error": str(exc),
            },
            status=HTTPStatus.SERVICE_UNAVAILABLE,
        )


def handle_refresh(request_handler: BaseHTTPRequestHandler) -> None:
    backend = get_runtime_backend()
    discard_request_body(request_handler)

    try:
        payload = backend.refresh_live()
        send_json(
            request_handler,
            {
                **backend.live_payload(snapshot=payload),
                "series": payload["series"],
                "status": payload["status"],
                "refresh": payload["refresh"],
            },
        )
    except RefreshInProgressError as exc:
        send_json(
            request_handler,
            {
                **backend.live_payload(),
                "error": str(exc),
            },
            status=HTTPStatus.ACCEPTED,
        )
    except RefreshFailedError as exc:
        body: dict[str, Any] = {
            **backend.live_payload(snapshot=exc.snapshot),
            "error": str(exc),
            "refresh": {
                "ok": False,
                "state": "failed",
                "message": str(exc),
                "progress": exc.progress,
            },
        }
        if exc.snapshot is not None:
            body["series"] = exc.snapshot["series"]
            body["status"] = exc.snapshot["status"]
        send_json(request_handler, body, status=HTTPStatus.BAD_GATEWAY)


def handle_cron_refresh(request_handler: BaseHTTPRequestHandler) -> None:
    discard_request_body(request_handler)

    expected_secret = os.getenv("CRON_SECRET", "").strip()
    if expected_secret:
        auth_header = request_handler.headers.get("Authorization")
        if auth_header != f"Bearer {expected_secret}":
            send_json(
                request_handler,
                {"ok": False, "error": "Unauthorized cron request"},
                status=HTTPStatus.UNAUTHORIZED,
            )
            return

    backend = get_runtime_backend()
    try:
        payload = backend.refresh_live()
        send_json(
            request_handler,
            {
                "ok": True,
                "message": "Scheduled refresh completed",
                "refresh": payload["refresh"],
                "status": payload["status"],
            },
        )
    except RefreshInProgressError:
        send_json(
            request_handler,
            {
                "ok": True,
                "skipped": True,
                "message": "Refresh already in progress",
            },
            status=HTTPStatus.ACCEPTED,
        )
    except RefreshFailedError as exc:
        send_json(
            request_handler,
            {
                "ok": False,
                "error": str(exc),
                "progress": exc.progress,
            },
            status=HTTPStatus.BAD_GATEWAY,
        )
