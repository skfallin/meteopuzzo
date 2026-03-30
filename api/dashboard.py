from http.server import BaseHTTPRequestHandler

from vercel_api_common import handle_dashboard, send_options


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        handle_dashboard(self)

    def do_OPTIONS(self) -> None:
        send_options(self)
