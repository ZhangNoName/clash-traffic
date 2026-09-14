export type Preferences = {
  chart_type: "bar" | "line";
  app_mode: "combined" | "separate";
  detail_mode: "summary" | "sources";
};
export type Filters = Preferences & {
  from: string;
  to: string;
  subscription: string;
  app: string;
  node: string;
  granularity: "auto" | "minute" | "quarter" | "hour" | "day";
  group: "app" | "node" | "subscription";
};
export type Point = {
  time: string;
  upload: number;
  download: number;
  coverage: number;
  duration: number;
};
export type Summary = {
  total: {
    upload: number;
    download: number;
    apps: number;
    nodes: number;
    unknown: number;
  };
  daily: Point[];
  series: Point[];
  ranking: { id: string; name: string; upload: number; download: number }[];
  events: { start: number; end: number; kind: string }[];
  granularity: Exclude<Filters["granularity"], "auto">;
  from: string;
  to: string;
  timezone: string;
};
export type Detail = {
  node_key: string;
  node: string;
  subscription_id: string;
  subscription: string;
  app_id: string;
  app: string;
  chain: string;
  attribution: string;
  upload: number;
  download: number;
  source_count: number;
  identity_count: number;
  first_seen: number;
  last_seen: number;
};
export type Details = { rows: Detail[]; count: number; offset: number };
export type Option = { id: string; name: string; override?: string | null };
export type Options = {
  subscriptions: Option[];
  apps: Option[];
  apps_combined: Option[];
  nodes: Option[];
};
export type Status = {
  connected: boolean;
  collector_alive: boolean;
  last_sample?: number;
  created_at?: number;
  csrf: string;
  download_speed: number;
  upload_speed: number;
  totals?: { proxy?: number; excluded?: number; unclassified?: number };
};
export type Storage = {
  bytes: number;
  rows: number;
  oldest: number | null;
  newest: number | null;
  settings: { retention_days: number; max_mb: number };
  last_cleanup?: { at: number; reason: string; rows: number } | null;
};
export const defaults: Preferences = {
  chart_type: "bar",
  app_mode: "combined",
  detail_mode: "summary",
};
const dt = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
export const iso = (ms: number) => dt.format(new Date(ms)).replace(" ", "T");
export const time = (seconds?: number | null) =>
  seconds ? iso(seconds * 1000).replace("T", " ") : "—";
export const stamp = (s: string) =>
  Date.parse(
    s +
      (s.length === 10
        ? "T00:00:00+08:00"
        : s.length === 16
          ? ":00+08:00"
          : ""),
  );
export function period(value: string, now = Date.now()) {
  const today = iso(now).slice(0, 10),
    year = Number(today.slice(0, 4)),
    month = Number(today.slice(5, 7));
  let from = stamp(today),
    to = from + 86400000;
  if (value === "7") from -= 6 * 86400000;
  if (value === "month") {
    from = stamp(today.slice(0, 8) + "01");
    to = Date.UTC(year, month, 1) - 8 * 3600000;
  }
  if (value === "year") {
    from = stamp(`${year}-01-01`);
    to = stamp(`${year + 1}-01-01`);
  }
  return { from: iso(from), to: iso(to) };
}
export function initial(prefs: Preferences = defaults): Filters {
  return {
    ...period("today"),
    ...prefs,
    subscription: "",
    app: "",
    node: "",
    granularity: "auto",
    group: "app",
  };
}
export function validRange(from: string, to: string) {
  return (
    /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(from) &&
    /^\d{4}-\d\d-\d\dT\d\d:\d\d$/.test(to) &&
    stamp(to) - stamp(from) >= 60000 &&
    stamp(to) - stamp(from) <= 366 * 86400000
  );
}
export function readFilters(search: string, prefs: Preferences): Filters {
  const p = new URLSearchParams(search),
    f = initial(prefs);
  for (const k of ["from", "to", "subscription", "app", "node"] as const)
    if (p.has(k)) f[k] = p.get(k)!;
  if (f.from.length === 10) f.from += "T00:00";
  if (f.to.length === 10) f.to = iso(stamp(f.to) + 86400000);
  for (const [key, allowed] of Object.entries({
    chart_type: ["bar", "line"],
    app_mode: ["combined", "separate"],
    detail_mode: ["summary", "sources"],
    granularity: ["auto", "minute", "quarter", "hour", "day"],
    group: ["app", "node", "subscription"],
  })) {
    const v = p.get(key);
    if (v && allowed.includes(v)) Object.assign(f, { [key]: v });
  }
  return f;
}
export function query(
  filters: Filters,
  extra: Record<string, string | number> = {},
) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...filters, ...extra }))
    if (v !== "") p.set(k, String(v));
  return p.toString();
}
export function bytes(value: number) {
  const n = Math.max(0, value || 0),
    i = Math.min(4, n ? Math.floor(Math.log(n) / Math.log(1024)) : 0);
  return `${(n / 1024 ** i).toLocaleString("en-US", { maximumFractionDigits: i ? 2 : 0 })} ${["B", "KB", "MB", "GB", "TB"][i]}`;
}
export function pointInfo(
  p: Point,
  from: string,
  to: string,
  now = Date.now(),
  bucket = 86400,
) {
  const start = Math.max(stamp(p.time), stamp(from)),
    end = Math.min(stamp(p.time) + bucket * 1000, stamp(to));
  const sum = p.upload + p.download,
    future = start > now,
    expected = Math.max(0, (Math.min(end, now) - start) / 1000),
    missing = !p.coverage && !sum;
  return {
    start,
    end,
    sum,
    future,
    missing,
    partial: !missing && p.coverage < expected * 0.98,
    level:
      sum === 0
        ? 0
        : sum < 10 * 1024 ** 2
          ? 1
          : sum < 100 * 1024 ** 2
            ? 2
            : sum < 1024 ** 3
              ? 3
              : 4,
  };
}
export const grains = { minute: 60, quarter: 900, hour: 3600, day: 86400 };
export const grainNames = {
  minute: "分钟",
  quarter: "15 分钟",
  hour: "小时",
  day: "天",
};
export function disambiguate(options: Option[]) {
  return options.map((x) => ({
    ...x,
    label:
      x.name +
      (options.filter((y) => y.name === x.name).length > 1
        ? " · " + x.id.slice(0, 8)
        : ""),
  }));
}

export function chartCeiling(max: number) {
  const unit =
    1024 **
    Math.min(
      4,
      Math.max(0, Math.floor(Math.log(Math.max(1, max)) / Math.log(1024))),
    );
  const raw = Math.max(1, max) / unit / 4,
    magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].find((n) => n * magnitude >= raw) || 10;
  return step * magnitude * 4 * unit;
}
