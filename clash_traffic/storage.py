import csv
import io
import json
import sqlite3
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

TZ = ZoneInfo("Asia/Shanghai")


SCHEMA = """
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
CREATE TABLE IF NOT EXISTS usage (
 minute INTEGER NOT NULL, node_key TEXT NOT NULL, node TEXT NOT NULL,
 subscription_id TEXT NOT NULL, subscription TEXT NOT NULL,
 app_id TEXT NOT NULL, app TEXT NOT NULL, chain TEXT NOT NULL,
 attribution TEXT NOT NULL, upload INTEGER NOT NULL, download INTEGER NOT NULL,
 PRIMARY KEY(minute,node_key,subscription_id,app_id,chain,attribution)
);
CREATE INDEX IF NOT EXISTS usage_time ON usage(minute);
CREATE TABLE IF NOT EXISTS coverage (minute INTEGER PRIMARY KEY, seconds REAL NOT NULL);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY, start REAL NOT NULL, end REAL NOT NULL, kind TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_time ON events(start,end);
CREATE TABLE IF NOT EXISTS subscriptions (id TEXT PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS overrides (
 node_key TEXT PRIMARY KEY, subscription_id TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL);
PRAGMA user_version=1;
"""


class Store:
    def __init__(self, path):
        self.path = str(path)
        self.lock = threading.RLock()
        with self.connect() as db:
            db.executescript(SCHEMA)

    @contextmanager
    def connect(self):
        with self.lock:
            db = sqlite3.connect(self.path, timeout=10)
            db.row_factory = sqlite3.Row
            db.execute("PRAGMA busy_timeout=10000")
            try:
                with db:
                    yield db
            finally:
                db.close()

    def record(self, rows, coverage, gap, status, subscriptions):
        with self.connect() as db:
            for row in rows:
                db.execute("""INSERT INTO usage VALUES
                (:minute,:node_key,:node,:subscription_id,:subscription,:app_id,:app,
                 :chain,:attribution,:upload,:download)
                ON CONFLICT(minute,node_key,subscription_id,app_id,chain,attribution)
                DO UPDATE SET upload=upload+excluded.upload,download=download+excluded.download""", row)
            if coverage:
                cursor, end = coverage
                while cursor < end:
                    minute = int(cursor // 60) * 60
                    stop = min(end, minute + 60)
                    db.execute("""INSERT INTO coverage VALUES(?,?) ON CONFLICT(minute)
                               DO UPDATE SET seconds=MIN(60,seconds+excluded.seconds)""", (minute, stop - cursor))
                    cursor = stop
            if gap:
                db.execute("INSERT INTO events(start,end,kind) VALUES(?,?,?)", (*gap, "采集中断，已重新建立基线"))
            for sid, name in subscriptions.items():
                db.execute("INSERT INTO subscriptions VALUES(?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name", (sid, name))
            self.write_state(db, "status", status)
            db.execute("INSERT OR IGNORE INTO state VALUES('created_at',?)", (json.dumps(status["started_at"]),))

    @staticmethod
    def write_state(db, key, value):
        db.execute("INSERT INTO state VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                   (key, json.dumps(value, ensure_ascii=False)))

    def state(self, key, default=None):
        with self.connect() as db:
            row = db.execute("SELECT value FROM state WHERE key=?", (key,)).fetchone()
            return json.loads(row[0]) if row else default

    def event(self, start, end, kind):
        with self.connect() as db:
            db.execute("INSERT INTO events(start,end,kind) VALUES(?,?,?)", (start, end, kind))

    def set_override(self, node_key, sid):
        with self.connect() as db:
            if not db.execute("SELECT 1 FROM usage WHERE node_key=? LIMIT 1", (node_key,)).fetchone():
                raise ValueError("节点不存在")
            if sid is None:
                db.execute("DELETE FROM overrides WHERE node_key=?", (node_key,))
            else:
                if not db.execute("SELECT 1 FROM subscriptions WHERE id=?", (sid,)).fetchone():
                    raise ValueError("请选择已有订阅")
                db.execute("INSERT INTO overrides VALUES(?,?) ON CONFLICT(node_key) DO UPDATE SET subscription_id=excluded.subscription_id", (node_key, sid))

    @staticmethod
    def app_expressions(params):
        mode = params.get("app_mode", "combined")
        if mode not in ("combined", "separate"):
            raise ValueError("无效应用归并方式")
        match = "LOWER(TRIM(u.app)) IN ('chatgpt','codex','chatgpt computer use')"
        if mode == "combined":
            return (f"CASE WHEN {match} THEN 'family:openai' ELSE u.app_id END",
                    f"CASE WHEN {match} THEN 'ChatGPT / Codex' ELSE u.app END")
        return "u.app_id", "u.app"

    def preferences(self):
        return {"chart_type": "bar", "app_mode": "combined", "detail_mode": "summary", **self.state("preferences", {})}

    def save_preferences(self, data):
        allowed = {"chart_type": ("bar", "line"), "app_mode": ("combined", "separate"),
                   "detail_mode": ("summary", "sources")}
        if not isinstance(data, dict) or any(k not in allowed or v not in allowed[k] for k, v in data.items()):
            raise ValueError("无效显示偏好")
        with self.connect() as db:
            row = db.execute("SELECT value FROM state WHERE key='preferences'").fetchone()
            prefs = json.loads(row[0]) if row else {}
            prefs.update(data)
            self.write_state(db, "preferences", prefs)
        return self.preferences()

    def options(self):
        aid, name = self.app_expressions({})
        with self.connect() as db:
            return {
                "apps_combined": [dict(r) for r in db.execute(f"SELECT {aid} id,MAX({name}) name FROM usage u GROUP BY {aid} ORDER BY name")],
                "subscriptions": [dict(r) for r in db.execute("SELECT id,name FROM subscriptions ORDER BY name")],
                "apps": [dict(r) for r in db.execute("SELECT app_id id,MAX(app) name FROM usage GROUP BY app_id ORDER BY name")],
                "nodes": [dict(r) for r in db.execute("""SELECT u.node_key id,MAX(u.node) name,
                    MAX(o.subscription_id) override FROM usage u LEFT JOIN overrides o USING(node_key)
                    GROUP BY u.node_key ORDER BY name""")],
            }

    @staticmethod
    def period(params):
        today = datetime.now(TZ).date()
        try:
            first_value, last_value = params.get("from", str(today)), params.get("to", str(today))
            first = datetime.fromisoformat(first_value).replace(tzinfo=TZ)
            last = datetime.fromisoformat(last_value).replace(tzinfo=TZ)
            if "T" not in last_value:
                last += timedelta(days=1)  # Legacy date-only queries are inclusive.
        except ValueError:
            raise ValueError("日期格式应为 YYYY-MM-DDTHH:MM")
        if first.second or last.second or first.microsecond or last.microsecond:
            raise ValueError("统计查询精确到分钟")
        if not 60 <= (last - first).total_seconds() <= 366 * 86400:
            raise ValueError("查询范围须为 1 分钟至 366 天，结束时间不包含在内")
        return first, last

    def _base(self, params):
        first, last = self.period(params)
        aid, aname = self.app_expressions(params)
        clauses, values = ["u.minute>=?", "u.minute<?"], [first.timestamp(), last.timestamp()]
        for field, expression in [("subscription", "COALESCE(o.subscription_id,u.subscription_id)"),
                                  ("app", aid), ("node", "u.node_key")]:
            if params.get(field):
                clauses.append(expression + "=?")
                values.append(params[field])
        query = f"""SELECT u.*,{aid} display_app_id,{aname} display_app,COALESCE(o.subscription_id,u.subscription_id) sid,
                   COALESCE(s.name,u.subscription) sub_name,
                   CASE WHEN o.node_key IS NOT NULL THEN '手动指定' ELSE u.attribution END source
                   FROM usage u LEFT JOIN overrides o USING(node_key)
                   LEFT JOIN subscriptions s ON s.id=o.subscription_id WHERE """ + " AND ".join(clauses)
        return query, values, first, last

    def summary(self, params):
        query, values, first, last = self._base(params)
        cte = "WITH selected AS (" + query + ") "
        grouping = params.get("group", "app")
        if grouping not in ("app", "node", "subscription"):
            raise ValueError("无效分组")
        gid, gname = {"app": ("display_app_id", "display_app"), "node": ("node_key", "node"),
                      "subscription": ("sid", "sub_name")}[grouping]
        with self.connect() as db:
            total = dict(db.execute(cte + """SELECT COALESCE(SUM(upload),0) upload,
                COALESCE(SUM(download),0) download,COUNT(DISTINCT display_app_id) apps,
                COUNT(DISTINCT node_key) nodes,
                COALESCE(SUM(CASE WHEN sid='unknown' THEN upload+download ELSE 0 END),0) unknown
                FROM selected""", values).fetchone())
            ranking = [dict(r) for r in db.execute(cte + f"""SELECT {gid} id,MAX({gname}) name,
                SUM(upload) upload,SUM(download) download FROM selected GROUP BY {gid}
                ORDER BY SUM(upload+download) DESC LIMIT 50""", values)]
            minutes = list(db.execute(cte + "SELECT minute,SUM(upload) upload,SUM(download) download FROM selected GROUP BY minute", values))
            coverage = list(db.execute("SELECT * FROM coverage WHERE minute>=? AND minute<?", (first.timestamp(), last.timestamp())))
            events = [dict(r) for r in db.execute("SELECT start,end,kind FROM events WHERE end>=? AND start<? ORDER BY start DESC LIMIT 50", (first.timestamp(), last.timestamp()))]
        requested = params.get("granularity", "auto")
        choices = {"minute": 60, "quarter": 900, "hour": 3600, "day": 86400}
        if requested not in (*choices, "auto"):
            raise ValueError("无效统计粒度")
        granularity = requested if requested != "auto" else ("hour" if last - first <= timedelta(days=2) else "day")
        seconds = choices[granularity]
        if (last - first).total_seconds() / seconds > 400:
            raise ValueError("当前粒度超过 400 个时段，请缩短范围或选择更大的统计粒度")
        step = timedelta(seconds=seconds)
        series, by_key = [], {}
        cursor = self.floor_bucket(first, seconds)
        while cursor < last:
            point = {"time": cursor.isoformat(), "upload": 0, "download": 0, "coverage": 0,
                     "duration": (min(cursor + step, last) - max(cursor, first)).total_seconds()}
            series.append(point)
            by_key[cursor.timestamp()] = point
            cursor += step
        for row in minutes:
            point = by_key[self.floor_bucket(datetime.fromtimestamp(row["minute"], TZ), seconds).timestamp()]
            point["upload"] += row["upload"]
            point["download"] += row["download"]
        for row in coverage:
            by_key[self.floor_bucket(datetime.fromtimestamp(row["minute"], TZ), seconds).timestamp()]["coverage"] += row["seconds"]
        daily = {}
        cursor = first.replace(hour=0, minute=0)
        while cursor < last:
            end = cursor + timedelta(days=1)
            daily[cursor.timestamp()] = {"time": cursor.isoformat(), "upload": 0, "download": 0,
                "coverage": 0, "duration": (min(end, last) - max(cursor, first)).total_seconds()}
            cursor = end
        for row in minutes:
            point = daily[self.floor_bucket(datetime.fromtimestamp(row["minute"], TZ), 86400).timestamp()]
            point["upload"] += row["upload"]
            point["download"] += row["download"]
        for row in coverage:
            daily[self.floor_bucket(datetime.fromtimestamp(row["minute"], TZ), 86400).timestamp()]["coverage"] += row["seconds"]
        return {"total": total, "ranking": ranking, "series": series, "daily": list(daily.values()), "events": events,
                "granularity": granularity,
                "timezone": "Asia/Shanghai", "from": first.isoformat(), "to": last.isoformat()}

    @staticmethod
    def floor_bucket(dt, seconds):
        midnight = dt.replace(hour=0, minute=0, second=0, microsecond=0)
        return midnight + timedelta(seconds=int((dt - midnight).total_seconds() // seconds) * seconds)

    def settings(self):
        return self.state("settings", {"retention_days": 180, "max_mb": 256})

    def save_settings(self, data):
        days, mb = data.get("retention_days"), data.get("max_mb")
        if type(days) is not int or not 0 <= days <= 3650:
            raise ValueError("保留天数须为 0 至 3650；0 表示不按天数清理")
        if type(mb) is not int or not 8 <= mb <= 8192:
            raise ValueError("最大空间须为 8 至 8192 MB")
        with self.connect() as db:
            self.write_state(db, "settings", {"retention_days": days, "max_mb": mb})

    def disk_size(self):
        return sum(p.stat().st_size for p in (Path(self.path), Path(self.path + "-wal"), Path(self.path + "-shm")) if p.exists())

    def storage_info(self):
        with self.connect() as db:
            data = dict(db.execute("SELECT COUNT(*) rows,MIN(minute) oldest,MAX(minute) newest FROM usage").fetchone())
        return dict(data, bytes=self.disk_size(), settings=self.settings(),
                    last_cleanup=self.state("last_cleanup"))

    def compact(self):
        with self.lock:
            db = sqlite3.connect(self.path, timeout=10, isolation_level=None)
            try:
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                db.execute("VACUUM")
                db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
            finally:
                db.close()

    def cleanup(self, params):
        all_data = params.get("scope") == "all"
        if params.get("scope") not in ("all", "range"):
            raise ValueError("无效清理范围")
        if not all_data:
            first, last = self.period(params)
        with self.connect() as db:
            if all_data:
                count = db.execute("SELECT COUNT(*) FROM usage").fetchone()[0]
                for table in ("usage", "coverage", "events"):
                    db.execute("DELETE FROM " + table)
            else:
                bounds = (first.timestamp(), last.timestamp())
                count = db.execute("SELECT COUNT(*) FROM usage WHERE minute>=? AND minute<?", bounds).fetchone()[0]
                for table in ("usage", "coverage"):
                    db.execute("DELETE FROM " + table + " WHERE minute>=? AND minute<?", bounds)
                db.execute("DELETE FROM events WHERE start>=? AND end<=?", bounds)
            self.write_state(db, "last_cleanup", {"at": time.time(), "reason": "手动清理", "rows": count})
        self.compact()
        return {"deleted_rows": count, "storage": self.storage_info()}

    def maintain(self, now=None):
        now = now if now is not None else time.time()
        settings = self.settings()
        removed = 0
        with self.connect() as db:
            if settings["retention_days"]:
                cutoff = now - settings["retention_days"] * 86400
                removed += db.execute("DELETE FROM usage WHERE minute<?", (cutoff,)).rowcount
                db.execute("DELETE FROM coverage WHERE minute<?", (cutoff,))
                db.execute("DELETE FROM events WHERE end<?", (cutoff,))
        limit = settings["max_mb"] * 1024 * 1024
        if removed or self.disk_size() > limit:
            self.compact()
        # Upper bound is checked once per minute. Compact at 80% after reaching
        # the cap to avoid repeated pruning. Never delete settings or mappings.
        if self.disk_size() > limit:
            target = limit * 0.8
            for _ in range(40):
                with self.connect() as db:
                    bounds = db.execute("SELECT MIN(minute),MAX(minute) FROM (SELECT minute FROM usage UNION SELECT minute FROM coverage)").fetchone()
                    if bounds[0] is None:
                        db.execute("DELETE FROM events")
                        cutoff = None
                    else:
                        cutoff = bounds[0] + max(60, int((bounds[1] - bounds[0]) * 0.15))
                        removed += db.execute("DELETE FROM usage WHERE minute<=?", (cutoff,)).rowcount
                        db.execute("DELETE FROM coverage WHERE minute<=?", (cutoff,))
                        db.execute("DELETE FROM events WHERE end<=?", (cutoff + 60,))
                self.compact()
                if self.disk_size() <= target or cutoff is None:
                    break
        if removed:
            with self.connect() as db:
                self.write_state(db, "last_cleanup", {"at": now, "reason": "保留期限或空间上限", "rows": removed})
        return removed

    def details(self, params, export=False):
        query, values, _, _ = self._base(params)
        mode = params.get("detail_mode", "summary")
        if mode not in ("summary", "sources"):
            raise ValueError("无效明细方式")
        sources = """SELECT node_key,MAX(node) node,sid subscription_id,MAX(sub_name) subscription,
            app_id,MAX(app) app,display_app_id,MAX(display_app) display_app,
            chain,source attribution,SUM(upload) upload,SUM(download) download,
            MIN(minute) first_seen,MAX(minute) last_seen
            FROM selected GROUP BY node_key,sid,app_id,display_app_id,chain,source"""
        cte = "WITH selected AS (" + query + "), sources AS (" + sources + ") "
        group = ("""SELECT node_key,MAX(node) node,subscription_id,MAX(subscription) subscription,
            display_app_id app_id,MAX(display_app) app,'' chain,'' attribution,
            SUM(upload) upload,SUM(download) download,COUNT(*) source_count,
            COUNT(DISTINCT app_id) identity_count,MIN(first_seen) first_seen,MAX(last_seen) last_seen
            FROM sources GROUP BY node_key,subscription_id,display_app_id"""
            if mode == "summary" else "SELECT *,1 source_count,1 identity_count FROM sources")
        try:
            offset = max(0, int(params.get("offset", 0)))
        except ValueError:
            raise ValueError("无效分页")
        with self.connect() as db:
            count = db.execute(cte + "SELECT COUNT(*) FROM (" + group + ")", values).fetchone()[0]
            sql = cte + "SELECT * FROM (" + group + ") ORDER BY upload+download DESC,node_key,app_id,chain,attribution"
            if not export:
                sql += " LIMIT 50 OFFSET ?"
                values = values + [offset]
            rows = [dict(r) for r in db.execute(sql, values)]
        return {"rows": rows, "count": count, "offset": offset}

    def export(self, params):
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow(["应用", "订阅", "节点", "代理链路", "归属依据", "上传字节", "下载字节", "总字节", "应用编号", "节点编号", "来源数", "首次记录", "末次记录", "应用归并", "明细方式"])
        def safe(value):
            # Prevent spreadsheet formula interpretation of imported node names.
            return "'" + value if value and value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")) else value
        for row in self.details(params, export=True)["rows"]:
            writer.writerow([safe(row[k]) for k in ("app", "subscription", "node", "chain", "attribution")] +
                            [row["upload"], row["download"], row["upload"] + row["download"], safe(row["app_id"]),
                             safe(row["node_key"]), row["source_count"],
                             datetime.fromtimestamp(row["first_seen"], TZ).isoformat(),
                             datetime.fromtimestamp(row["last_seen"], TZ).isoformat(),
                             params.get("app_mode", "combined"), params.get("detail_mode", "summary")])
        return ("\ufeff" + output.getvalue()).encode("utf-8")
