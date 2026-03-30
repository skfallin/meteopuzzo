from http.server import BaseHTTPRequestHandler

from vercel_api_common import handle_cron_refresh, send_options


class handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        handle_cron_refresh(self)

    def do_POST(self) -> None:
        handle_cron_refresh(self)

    def do_OPTIONS(self) -> None:
        send_options(self)
