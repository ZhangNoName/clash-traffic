"""Read-only Mihomo transport, source attribution, and delta accounting.

No subscription URLs, proxy credentials, destinations or raw connections are
written to disk. A keyed identity digest distinguishes otherwise identical names.
"""
import hashlib
import hmac
import http.client
import json
import plistlib
import socket
from datetime import datetime
from pathlib import Path

import yaml


class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__("localhost", timeout=3)
        self.path = str(path)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)


class Mihomo:
    def __init__(self, path):
        self.path = path

    def get(self, endpoint):
        if endpoint not in ("/connections", "/proxies", "/version"):
            raise ValueError("Unsupported read endpoint")
        client = UnixHTTP(self.path)
        try:
            client.request("GET", endpoint)
            response = client.getresponse()
            if response.status != 200:
                raise OSError("Mihomo returned HTTP %s" % response.status)
            return json.loads(response.read(32 * 1024 * 1024))
        finally:
            client.close()


def read_yaml(path):
    with Path(path).open(encoding="utf-8") as stream:
        obj = yaml.safe_load(stream)
    return obj if isinstance(obj, dict) else {}


def digest(key, value):
    return hmac.new(key, json.dumps(value, sort_keys=True, ensure_ascii=False,
                                 default=str).encode(), hashlib.sha256).hexdigest()[:32]


def identity(proxy, key):
    # Only endpoints with concrete server identity are considered verifiable.
    if not proxy.get("server") or not proxy.get("type"):
        return None
    fields = ("type", "server", "port", "uuid", "password", "cipher", "username",
              "private-key", "public-key", "pre-shared-key")
    return digest(key, {k: str(proxy[k]) for k in fields if k in proxy})


NON_PROXY = {"direct", "reject", "rejectdrop", "pass", "compatible", "selector",
             "urltest", "fallback", "loadbalance", "relay"}


class Attribution:
    def __init__(self, base, key):
        self.base, self.key = Path(base), key
        self.types, self.runtime, self.members = {}, {}, {}
        self.subscriptions, self.active, self.providers = {}, "", {}
        self.app_cache = {}

    def refresh(self, proxies):
        # Build a replacement index completely before publishing it.
        manifest = read_yaml(self.base / "profiles.yaml")
        runtime_doc = read_yaml(self.base / "clash-verge.yaml")
        subscriptions, members, providers = {}, {}, {}
        for item in manifest.get("items", []):
            if item.get("type") not in ("remote", "local") or not item.get("file"):
                continue
            uid = str(item["uid"])
            subscriptions[uid] = str(item.get("name") or uid)
            path = (self.base / "profiles" / item["file"]).resolve()
            if not path.is_relative_to((self.base / "profiles").resolve()):
                continue
            try:
                doc = read_yaml(path)
            except (OSError, yaml.YAMLError):
                continue
            for proxy in doc.get("proxies") or []:
                if not isinstance(proxy, dict):
                    continue
                fp = identity(proxy, self.key)
                if fp:
                    members.setdefault(fp, set()).add(uid)
            for name, spec in (doc.get("proxy-providers") or {}).items():
                # Provider URLs remain in memory and are never serialized.
                if isinstance(spec, dict) and spec.get("url"):
                    providers.setdefault((name, str(spec["url"])), set()).add(uid)
        runtime = {p["name"]: identity(p, self.key)
                   for p in runtime_doc.get("proxies") or []
                   if isinstance(p, dict) and "name" in p}
        provider_sources = {}
        for name, spec in (runtime_doc.get("proxy-providers") or {}).items():
            if isinstance(spec, dict) and spec.get("url"):
                provider_sources[name] = providers.get((name, str(spec["url"])), set())
        self.types = {name: str(p.get("type", "")).lower().replace("-", "")
                      for name, p in proxies.get("proxies", {}).items()}
        self.runtime, self.members = runtime, members
        self.subscriptions, self.active = subscriptions, str(manifest.get("current") or "")
        self.providers = provider_sources

    def app(self, metadata):
        path = metadata.get("processPath") or ""
        process = metadata.get("process") or ""
        cache_key = (path, process)
        if cache_key in self.app_cache:
            return self.app_cache[cache_key]
        if ".app/" in path:
            root = path.split(".app/", 1)[0] + ".app"
            name, bundle = Path(root).stem, root
            try:
                with open(Path(root) / "Contents/Info.plist", "rb") as f:
                    info = plistlib.load(f)
                name = info.get("CFBundleDisplayName") or info.get("CFBundleName") or name
                bundle = info.get("CFBundleIdentifier") or root
            except (OSError, ValueError, plistlib.InvalidFileException):
                pass
            result = (digest(self.key, bundle), str(name))
        elif process:
            result = (digest(self.key, path or process), process)
        else:
            result = ("unknown", "未知应用")
        if len(self.app_cache) > 2048:
            self.app_cache.clear()
        self.app_cache[cache_key] = result
        return result

    def resolve(self, connection):
        chain = connection.get("chains") or []
        nodes = [n for n in chain if self.types.get(n) and self.types[n] not in NON_PROXY]
        if not nodes:
            if any(n in ("DIRECT", "REJECT", "REJECT-DROP", "PASS") or
                   self.types.get(n) in ("direct", "reject", "rejectdrop", "pass") for n in chain):
                return None, "excluded"
            return None, "unclassified"
        # A multi-hop chain is one billable observation, not one copy per hop.
        node = " → ".join(nodes)
        fps = [self.runtime.get(n) for n in nodes]
        candidates = set()
        for fp in fps:
            if fp:
                candidates.update(self.members.get(fp, set()))
        evidence = "节点配置匹配"
        if not candidates:
            for provider in connection.get("providerChains") or []:
                candidates.update(self.providers.get(provider, set()))
            evidence = "Provider 来源匹配"
        # Only prefer the active profile for a single-hop match. Mixed chains
        # must not pretend to identify one billing subscription.
        sid = "unknown"
        if len(nodes) == 1 and self.active in candidates:
            sid = self.active
        elif len(candidates) == 1 and (len(nodes) == 1 or all(fp and self.members.get(fp) == candidates for fp in fps)):
            sid = next(iter(candidates))
        if len(nodes) > 1 and sid == "unknown":
            evidence = "多跳来源待确认"
        elif sid == "unknown":
            evidence = "归属待确认"
        node_key = digest(self.key, {"profile": self.active, "nodes": nodes,
                                    "identity": fps, "providers": connection.get("providerChains") or []})
        app_id, app_name = self.app(connection.get("metadata") or {})
        return {"node_key": node_key, "node": node, "subscription_id": sid,
                "subscription": self.subscriptions.get(sid, "归属待确认"),
                "app_id": app_id, "app": app_name,
                "chain": " → ".join(reversed(chain)), "attribution": evidence}, "proxy"


def start_timestamp(connection):
    try:
        return datetime.fromisoformat(connection["start"].replace("Z", "+00:00")).timestamp()
    except (KeyError, TypeError, ValueError):
        return None


def split_minutes(start, end, upload, download):
    """Distribute a <=5s observation over clock buckets, conserving every byte."""
    if end <= start:
        return []
    result, cursor, allocated_up, allocated_down = [], start, 0, 0
    while cursor < end:
        minute = int(cursor // 60) * 60
        boundary = min(end, minute + 60)
        fraction = (boundary - start) / (end - start)
        up = upload if boundary == end else int(upload * fraction)
        down = download if boundary == end else int(download * fraction)
        result.append((minute, up - allocated_up, down - allocated_down))
        allocated_up, allocated_down, cursor = up, down, boundary
    return result


class DeltaEngine:
    def __init__(self, resolver, max_gap=5):
        self.resolver, self.max_gap = resolver, max_gap
        self.previous, self.last_time = {}, None

    def consume(self, snapshot, now):
        elapsed = now - self.last_time if self.last_time is not None else None
        continuous = elapsed is not None and 0 < elapsed <= self.max_gap
        totals = {"proxy": 0, "excluded": 0, "unclassified": 0,
                  "upload": 0, "download": 0, "resets": 0, "closed": 0}
        rows, current = [], {}
        for connection in snapshot.get("connections") or []:
            cid = connection.get("id")
            if not cid or cid in current:
                continue
            up, down = int(connection.get("upload", 0)), int(connection.get("download", 0))
            if up < 0 or down < 0:
                continue
            previous = self.previous.get(cid)
            if previous:
                _, _, info, category = previous
            else:
                info, category = self.resolver.resolve(connection)
            current[cid] = (up, down, info, category)
            totals[category] += 1
            if not continuous:
                continue  # First observation / sleep / outage: establish baseline.
            if previous:
                if up < previous[0] or down < previous[1]:
                    totals["resets"] += 1
                    continue
                delta_up, delta_down, began = up - previous[0], down - previous[1], self.last_time
            else:
                started = start_timestamp(connection)
                if started is None or not self.last_time <= started <= now:
                    continue  # Never assign an old connection's lifetime to today.
                delta_up, delta_down, began = up, down, started
            if category != "proxy" or not (delta_up or delta_down):
                continue
            totals["upload"] += delta_up
            totals["download"] += delta_down
            for minute, du, dd in split_minutes(began, now, delta_up, delta_down):
                if du or dd:
                    rows.append(dict(info, minute=minute, upload=du, download=dd))
        totals["closed"] = len(self.previous.keys() - current.keys()) if continuous else 0
        gap = (self.last_time, now) if elapsed is not None and not continuous else None
        coverage = (self.last_time, now) if continuous else None
        self.previous, self.last_time = current, now
        return rows, totals, coverage, gap
