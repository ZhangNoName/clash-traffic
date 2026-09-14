import argparse
import fcntl
import json
import logging
from logging.handlers import RotatingFileHandler
import os
import secrets
import signal
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from .core import Attribution, DeltaEngine, Mihomo
from .storage import Store
from .web_assets import WebAssets

LOG = logging.getLogger("clash-traffic")
DEFAULT_DATA = Path.home() / "Library/Application Support/ClashTraffic"
DEFAULT_VERGE = Path.home() / "Library/Application Support/io.github.clash-verge-rev.clash-verge-rev"


class Collector(threading.Thread):
    def __init__(self, store, client, resolver, stop, interval=1):
        super().__init__(name="collector", daemon=True)
        self.store, self.client, self.resolver, self.stop = store, client, resolver, stop
        self.interval, self.engine = interval, DeltaEngine(resolver)
        self.status = {"connected": False, "started_at": time.time(), "last_sample": None,
                       "message": "正在连接 Clash Verge", "interval": interval, "totals": {}}
        old = store.state("status", {})
        if old.get("last_sample"):
            store.event(old["last_sample"], self.status["started_at"], "记录服务重新启动，未补算离线流量")

    def run(self):
        next_refresh = 0
        next_maintenance = 0
        while not self.stop.is_set():
            began = time.monotonic()
            try:
                if began >= next_refresh:
                    self.resolver.refresh(self.client.get("/proxies"))
                    next_refresh = began + 5
                snapshot = self.client.get("/connections")
                if not isinstance(snapshot.get("connections"), (list, type(None))):
                    raise ValueError("Invalid connection response")
                now = time.time()
                rows, totals, coverage, gap = self.engine.consume(snapshot, now)
                elapsed = (coverage[1] - coverage[0]) if coverage else None
                self.status.update(connected=True, last_sample=now, message="正在采集 · 连接快照统计",
                                   totals=totals, upload_speed=totals["upload"] / elapsed if elapsed else 0,
                                   download_speed=totals["download"] / elapsed if elapsed else 0)
                self.store.record(rows, coverage, gap, self.status, self.resolver.subscriptions)
                if began >= next_maintenance:
                    self.store.maintain()
                    next_maintenance = began + 60
            except Exception as error:
                # Never log response/config contents or credentials.
                self.status.update(connected=False, upload_speed=0, download_speed=0,
                                   message="Clash 未连接或配置暂不可读，正在重试")
                try:
                    with self.store.connect() as db:
                        self.store.write_state(db, "status", self.status)
                except Exception:
                    LOG.error("Database write failed")
                LOG.warning("Collection unavailable (%s)", type(error).__name__)
                self.stop.wait(3)
            self.stop.wait(max(0, self.interval - (time.monotonic() - began)))


class Server(ThreadingHTTPServer):
    daemon_threads = True


def handler(store, collector, csrf, port):
    assets = Path(__file__).parent / "static"
    frontend = WebAssets(assets / "ui")
    allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def send(self, body, content_type="application/json; charset=utf-8", status=200, download=False):
            if not isinstance(body, bytes):
                body = json.dumps(body, ensure_ascii=False).encode()
            self.send_response(status)
            self.send_header("Content-Type", content_type)
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.send_header("X-Content-Type-Options", "nosniff")
            self.send_header("Referrer-Policy", "no-referrer")
            self.send_header("Content-Security-Policy", f"default-src 'self'; script-src {frontend.script_sources}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'")
            if download:
                self.send_header("Content-Disposition", 'attachment; filename="clash-traffic.csv"')
            self.end_headers()
            try:
                self.wfile.write(body)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def valid_host(self):
            if self.headers.get("Host") not in allowed_hosts:
                self.send({"error": "仅支持本机访问"}, status=403)
                return False
            return True

        def do_GET(self):
            if not self.valid_host():
                return
            url = urlparse(self.path)
            params = {k: v[-1] for k, v in parse_qs(url.query).items()}
            try:
                if url.path == "/api/status":
                    status = dict(collector.status)
                    status["collector_alive"] = collector.is_alive()
                    status["created_at"] = store.state("created_at")
                    status["csrf"] = csrf
                    status["sampling_notice"] = "快照采样可能遗漏短连接和连接结束前的末尾流量；不是机场账单。"
                    return self.send(status)
                if url.path == "/api/preferences":
                    return self.send(store.preferences())
                if url.path == "/api/options":
                    return self.send(store.options())
                if url.path == "/api/storage":
                    return self.send(store.storage_info())
                if url.path == "/api/summary":
                    return self.send(store.summary(params))
                if url.path == "/api/details":
                    return self.send(store.details(params))
                if url.path == "/api/export.csv":
                    return self.send(store.export(params), "text/csv; charset=utf-8", download=True)
                resource = frontend.get(url.path)
                if resource:
                    path, mime = resource
                    return self.send(path.read_bytes(), mime + "; charset=utf-8")
                files = {"/": ("index.html", "text/html"), "/app.js": ("app.js", "text/javascript"),
                         "/style.css": ("style.css", "text/css"), "/favicon.svg": ("favicon.svg", "image/svg+xml")}
                for vendor_name, vendor_mime in [("flatpickr.min.js", "text/javascript"), ("zh.js", "text/javascript"), ("flatpickr.min.css", "text/css")]:
                    name = "vendor/flatpickr/" + vendor_name
                    files["/" + name] = (name, vendor_mime)
                if url.path in files:
                    name, mime = files[url.path]
                    return self.send((assets / name).read_bytes(), mime + "; charset=utf-8")
                self.send({"error": "页面不存在"}, status=404)
            except ValueError as error:
                self.send({"error": str(error)}, status=400)
            except Exception:
                LOG.exception("Local API request failed")
                self.send({"error": "读取数据失败，请重试"}, status=500)

        def do_POST(self):
            if not self.valid_host():
                return
            if self.headers.get("Origin") not in {"http://" + h for h in allowed_hosts} or not secrets.compare_digest(self.headers.get("X-CSRF-Token", ""), csrf):
                return self.send({"error": "请求校验失败，请刷新页面"}, status=403)
            if self.path not in ("/api/override", "/api/settings", "/api/cleanup", "/api/preferences"):
                return self.send({"error": "未知操作"}, status=404)
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if not 0 < size <= 4096:
                    raise ValueError("请求大小不合法")
                data = json.loads(self.rfile.read(size))
                if self.path == "/api/preferences":
                    return self.send(store.save_preferences(data))
                if self.path == "/api/settings":
                    store.save_settings(data)
                    store.maintain()
                    return self.send(store.storage_info())
                if self.path == "/api/cleanup":
                    if data.get("confirm") is not True:
                        raise ValueError("请确认清理范围")
                    return self.send(store.cleanup(data))
                node, sid = data.get("node_key"), data.get("subscription_id")
                if not isinstance(node, str) or (sid is not None and not isinstance(sid, str)):
                    raise ValueError("无效归属")
                store.set_override(node, sid)
                self.send({"ok": True})
            except (ValueError, TypeError, AttributeError) as error:
                self.send({"error": str(error)}, status=400)

    return Handler


def main():
    parser = argparse.ArgumentParser(description="Clash Verge 本地代理流量统计")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--verge-dir", type=Path, default=DEFAULT_VERGE)
    parser.add_argument("--socket", default="/tmp/verge/verge-mihomo.sock")
    parser.add_argument("--port", type=int, default=19797)
    args = parser.parse_args()
    os.umask(0o077)
    args.data_dir.mkdir(parents=True, exist_ok=True)
    lock = (args.data_dir / "collector.lock").open("w")
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise SystemExit("流量记录服务已运行，不能重复启动。")
    key_path = args.data_dir / "identity.key"
    if not key_path.exists():
        key_path.write_bytes(secrets.token_bytes(32))
    logging.basicConfig(level=logging.WARNING, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[RotatingFileHandler(args.data_dir / "service.log", maxBytes=1024*1024, backupCount=2)])
    store = Store(args.data_dir / "traffic.sqlite3")
    stop = threading.Event()
    collector = Collector(store, Mihomo(args.socket), Attribution(args.verge_dir, key_path.read_bytes()), stop)
    server = Server(("127.0.0.1", args.port), handler(store, collector, secrets.token_urlsafe(32), args.port))

    def shutdown(*unused):
        stop.set()
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)
    collector.start()
    try:
        server.serve_forever(poll_interval=0.3)
    finally:
        stop.set()
        collector.join(timeout=8)
        server.server_close()
        lock.close()


if __name__ == "__main__":
    main()
