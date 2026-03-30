from http.server import BaseHTTPRequestHandler

from vercel_api_common import handle_health, send_options


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        handle_health(self)

    def do_OPTIONS(self) -> None:
        send_options(self)
