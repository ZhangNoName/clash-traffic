"use client";
import { useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpRight,
  BarChart3,
  TrendingUp,
} from "lucide-react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Choice, FiltersBar, QueryNotice } from "./controls";
import { useSummary, useTraffic } from "./store";
import {
  bytes,
  chartCeiling,
  period,
  pointInfo,
  stamp,
  iso,
  grains,
  grainNames,
  disambiguate,
  type Summary,
  type Point,
  type Filters,
} from "@/lib/model";

function Metrics({ data }: { data?: Summary }) {
  return (
    <section className="metrics-grid" aria-label="流量摘要">
      {[
        {
          label: "代理总流量",
          value: data ? data.total.upload + data.total.download : 0,
          icon: null,
        },
        { label: "下载", value: data?.total.download || 0, icon: ArrowDown },
        { label: "上传", value: data?.total.upload || 0, icon: ArrowUp },
      ].map(({ label, value, icon: Icon }, i) => (
        <Card
          key={label}
          className={i === 0 ? "metric-card primary-metric" : "metric-card"}
        >
          <CardContent>
            <div className="metric-label">
              {Icon && (
                <Icon
                  className={
                    "size-5 " + (i === 1 ? "text-primary" : "text-violet-500")
                  }
                />
              )}{" "}
              {label}
            </div>
            {data ? (
              <div className="metric-value">
                {bytes(value).split(" ")[0]}
                <span>{bytes(value).split(" ")[1]}</span>
              </div>
            ) : (
              <Skeleton className="mt-5 h-12 w-36" />
            )}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}
export function TrafficCalendar({
  data,
  disabled = false,
}: {
  data: Summary;
  disabled?: boolean;
}) {
  const { setFilters } = useTraffic(),
    [hover, setHover] = useState("");
  if (data.daily.length < 28) return null;
  const months = new Map<string, Point[]>();
  for (const p of data.daily) {
    const m = p.time.slice(0, 7);
    months.set(m, [...(months.get(m) || []), p]);
  }
  const year = months.size > 1,
    last = data.daily.at(-1)!.time.slice(0, 4),
    first = data.daily[0].time.slice(0, 4),
    title = year
      ? `${first === last ? first : first + "–" + last} · 每日流量`
      : `${first} 年 ${Number(data.daily[0].time.slice(5, 7))} 月`;
  return (
    <Card className="calendar-card">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>{title}</CardTitle>
        <span className="text-sm text-muted-foreground">点击日期查看当天</span>
      </CardHeader>
      <CardContent>
        <div className={year ? "year-grid" : "month-grid"}>
          {Array.from(months, ([month, points]) => (
            <section className="heat-month" key={month}>
              {year && <h3>{Number(month.slice(5))} 月</h3>}
              <div className="heat-grid">
                {["一", "二", "三", "四", "五", "六", "日"].map((d) => (
                  <span className="weekday" key={d}>
                    {d}
                  </span>
                ))}
                {Array.from(
                  {
                    length:
                      (new Date(
                        points[0].time.slice(0, 10) + "T12:00:00Z",
                      ).getUTCDay() +
                        6) %
                      7,
                  },
                  (_, i) => (
                    <span key={"blank" + i} />
                  ),
                )}
                {points.map((p) => {
                  const x = pointInfo(p, data.from, data.to),
                    description = `${p.time.slice(0, 10)} · ${x.future ? "未到达" : x.missing ? "无采集记录" : bytes(x.sum) + (x.partial ? " · 部分记录" : "")} · 下载 ${bytes(p.download)} / 上传 ${bytes(p.upload)}`;
                  return (
                    <button
                      type="button"
                      className={
                        "heat-day " +
                        (x.future
                          ? "future"
                          : x.missing
                            ? "unrecorded"
                            : "heat-" + x.level)
                      }
                      key={p.time}
                      title={description}
                      aria-label={description}
                      disabled={x.future || disabled}
                      onMouseEnter={() => setHover(description)}
                      onFocus={() => setHover(description)}
                      onClick={() =>
                        setFilters({
                          from: p.time.slice(0, 10) + "T00:00",
                          to: iso(stamp(p.time) + 86400000),
                          granularity: "hour",
                        })
                      }
                    >
                      <span>
                        {Number(p.time.slice(8, 10))}
                        {x.partial ? " ◦" : ""}
                      </span>
                      {!year && (
                        <strong>
                          {x.future ? "—" : x.missing ? "无记录" : bytes(x.sum)}
                        </strong>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
        <div className="heat-legend">
          {["0", "< 10 MB", "10–100 MB", "100 MB–1 GB", "≥ 1 GB"].map(
            (label, i) => (
              <span key={label}>
                <i className={"heat-" + i} />
                {label}
              </span>
            ),
          )}
          <span>
            <i className="unrecorded" />
            无记录
          </span>
          <span>◦ 部分记录</span>
        </div>
        <p className="heat-caption" aria-live="polite">
          {hover || "颜色表示已记录的上传与下载总量。"}
        </p>
      </CardContent>
    </Card>
  );
}
type PlotPoint = Point & {
  label: string;
  up: number | null;
  down: number | null;
  coverageLabel: string;
};
function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: readonly { payload: PlotPoint }[];
}) {
  if (!active || !payload?.[0]) return null;
  const p = payload[0].payload;
  return (
    <div className="chart-tooltip">
      <strong>{p.time.slice(0, 16).replace("T", " ")}</strong>
      <span>下载 {bytes(p.download)}</span>
      <span>上传 {bytes(p.upload)}</span>
      <span className="text-muted-foreground">{p.coverageLabel}</span>
    </div>
  );
}
function Trend({ data, disabled }: { data: Summary; disabled: boolean }) {
  const { filters: f, setFilters, preference, csrf, notify } = useTraffic(),
    [chosen, setChosen] = useState<string | null>(null);
  const plots: PlotPoint[] = data.series.map((p) => {
    const v = pointInfo(
      p,
      data.from,
      data.to,
      Date.now(),
      grains[data.granularity],
    );
    return {
      ...p,
      label:
        data.granularity === "day"
          ? p.time.slice(5, 10).replace("-", "/")
          : p.time.slice(11, 16),
      up: v.future || v.missing ? null : p.upload,
      down: v.future || v.missing ? null : p.download,
      coverageLabel: v.future
        ? "未到达"
        : v.missing
          ? "无采集记录"
          : v.partial
            ? "部分记录"
            : "有采集记录",
    };
  });
  const current =
    plots.find((p) => p.time === chosen) ||
    plots.reduce(
      (a, b) => (a.upload + a.download > b.upload + b.download ? a : b),
      plots[0],
    );
  const currentInfo = current
    ? pointInfo(
        current,
        data.from,
        data.to,
        Date.now(),
        grains[data.granularity],
      )
    : null;
  const max = chartCeiling(
    Math.max(1, ...plots.map((p) => p.upload + p.download)),
  );
  return (
    <Card className="trend-card">
      <CardHeader className="panel-heading">
        <CardTitle>流量趋势</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <div className="chart-legend">
            <span>
              <i />
              下载
            </span>
            <span>
              <i />
              上传
            </span>
          </div>
          <Choice
            label="图表类型"
            value={f.chart_type}
            disabled={!csrf}
            onChange={(v) =>
              void preference({ chart_type: v as Filters["chart_type"] }).catch(
                (e) => notify(e.message),
              )
            }
            items={[
              { value: "bar", label: "柱状图" },
              { value: "line", label: "折线图" },
            ]}
          />
          <Choice
            label="趋势粒度"
            value={f.granularity}
            onChange={(v) =>
              setFilters({ granularity: v as Filters["granularity"] })
            }
            items={[
              { value: "auto", label: "自动粒度" },
              ...Object.entries(grainNames).map(([value, label]) => ({
                value,
                label: "按" + label,
              })),
            ]}
          />
        </div>
      </CardHeader>
      <CardContent>
        <div className="chart-scroll">
          <div
            className="traffic-chart"
            style={{
              minWidth: plots.length > 40 ? plots.length * 18 : undefined,
            }}
            aria-label={"流量" + (f.chart_type === "bar" ? "柱状图" : "折线图")}
          >
            <ResponsiveContainer width="100%" height={285}>
              <ComposedChart
                data={plots}
                margin={{ top: 12, right: 12, left: 0, bottom: 8 }}
                onClick={(e) => {
                  if (!disabled && e?.activeLabel) {
                    const p = plots.find((x) => x.time === e.activeLabel);
                    if (p) setChosen(p.time);
                  }
                }}
                accessibilityLayer
              >
                <CartesianGrid vertical={false} stroke="#e8eee9" />
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) =>
                    data.granularity === "day"
                      ? String(v).slice(5, 10).replace("-", "/")
                      : String(v).slice(11, 16)
                  }
                  tickLine={false}
                  axisLine={false}
                  minTickGap={25}
                  tick={{ fill: "#758278", fontSize: 13 }}
                />
                <YAxis
                  tickFormatter={bytes}
                  domain={[0, max]}
                  ticks={[0, 0.25, 0.5, 0.75, 1].map((v) => v * max)}
                  tickLine={false}
                  axisLine={false}
                  width={76}
                  tick={{ fill: "#758278", fontSize: 13 }}
                />
                <Tooltip
                  content={<ChartTooltip />}
                  cursor={{ fill: "#17765f08" }}
                />
                {f.chart_type === "bar" ? (
                  <>
                    <Bar
                      dataKey="down"
                      name="下载"
                      fill="#38836a"
                      stackId="traffic"
                      maxBarSize={32}
                      isAnimationActive={false}
                    />
                    <Bar
                      dataKey="up"
                      name="上传"
                      fill="#a797cd"
                      stackId="traffic"
                      maxBarSize={32}
                      radius={[3, 3, 0, 0]}
                      isAnimationActive={false}
                    />
                  </>
                ) : (
                  <>
                    <Line
                      type="linear"
                      dataKey="down"
                      name="下载"
                      stroke="#38836a"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                    <Line
                      type="linear"
                      dataKey="up"
                      name="上传"
                      stroke="#a797cd"
                      strokeWidth={2.5}
                      dot={{ r: 3 }}
                      activeDot={{ r: 5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  </>
                )}
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
        <div className="chart-detail">
          {current && (
            <>
              <select
                aria-label="查看时段"
                className="period-select"
                value={current.time}
                disabled={disabled}
                onChange={(e) => setChosen(e.target.value)}
              >
                {plots.map((p) => (
                  <option key={p.time} value={p.time}>
                    {p.time.slice(5, 16).replace("T", " ")}
                  </option>
                ))}
              </select>
              <span>↓ {bytes(current.download)}</span>
              <span>↑ {bytes(current.upload)}</span>
              <span className="text-muted-foreground">
                {current.coverageLabel}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled || currentInfo?.future}
                onClick={() => {
                  if (currentInfo)
                    setFilters({
                      from: iso(currentInfo.start),
                      to: iso(currentInfo.end),
                      granularity:
                        data.granularity === "day"
                          ? "hour"
                          : data.granularity === "hour"
                            ? "minute"
                            : data.granularity,
                    });
                }}
              >
                查看时段
                <ArrowUpRight className="size-4" />
              </Button>
            </>
          )}
        </div>
        {!data.total.upload && !data.total.download && (
          <p className="mt-3 text-center text-muted-foreground">
            当前范围暂无流量记录
          </p>
        )}
      </CardContent>
    </Card>
  );
}
function Ranking({ data, disabled }: { data: Summary; disabled: boolean }) {
  const { filters, setFilters } = useTraffic();
  const max = Math.max(1, ...data.ranking.map((r) => r.upload + r.download)),
    names = disambiguate(data.ranking);
  return (
    <Card className="ranking-card">
      <CardHeader>
        <CardTitle>流量排行</CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs
          value={filters.group}
          onValueChange={(v) => setFilters({ group: v as Filters["group"] })}
        >
          <TabsList className="w-full mb-5">
            <TabsTrigger value="app">应用</TabsTrigger>
            <TabsTrigger value="subscription">订阅</TabsTrigger>
            <TabsTrigger value="node">节点</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="rank-list">
          {data.ranking.length ? (
            data.ranking.map((r, i) => (
              <button
                key={r.id}
                className="rank-row"
                disabled={disabled}
                onClick={() => setFilters({ [filters.group]: r.id })}
              >
                <span className="app-avatar">
                  {r.name.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2)}
                </span>
                <span className="rank-body">
                  <span className="rank-title">
                    <span>{names[i].label}</span>
                    <strong>{bytes(r.upload + r.download)}</strong>
                  </span>
                  <span className="rank-track">
                    <i style={{ width: (r.download / max) * 100 + "%" }} />
                    <i style={{ width: (r.upload / max) * 100 + "%" }} />
                  </span>
                </span>
              </button>
            ))
          ) : (
            <p className="empty-state">暂无排行</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
export function Overview() {
  const q = useSummary();
  return (
    <div className="page-stack">
      <FiltersBar />
      <QueryNotice error={q.error} pending={q.isPlaceholderData} />
      <Metrics data={q.data} />
      {q.data ? (
        <>
          <TrafficCalendar
            data={q.data}
            disabled={q.isPlaceholderData || !!q.error}
          />
          {q.data.total.unknown > 0 && (
            <p className="quality-note">
              {bytes(q.data.total.unknown)}{" "}
              的订阅归属待确认，可在归属管理中指定。
            </p>
          )}
          <div className="analysis-grid">
            <Trend data={q.data} disabled={q.isPlaceholderData || !!q.error} />
            <Ranking
              data={q.data}
              disabled={q.isPlaceholderData || !!q.error}
            />
          </div>
        </>
      ) : (
        <Skeleton className="h-96 w-full rounded-2xl" />
      )}
    </div>
  );
}
