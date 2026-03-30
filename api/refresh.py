from http import HTTPStatus
from http.server import BaseHTTPRequestHandler

from vercel_api_common import handle_refresh, send_json, send_options


class handler(BaseHTTPRequestHandler):
    def do_POST(self) -> None:
        handle_refresh(self)

    def do_GET(self) -> None:
        send_json(self, {"ok": False, "error": "Use POST for /api/refresh"}, status=HTTPStatus.METHOD_NOT_ALLOWED)

    def do_OPTIONS(self) -> None:
        send_options(self)
