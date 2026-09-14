"use client";
import { useState } from "react";
import { zhCN } from "date-fns/locale";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ArrowUpRight,
  LoaderCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useTraffic } from "./store";
import {
  period,
  validRange,
  disambiguate,
  type Option,
  type Filters,
} from "@/lib/model";

export function Choice({
  label,
  value,
  onChange,
  items,
  disabled = false,
  className = "",
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  items: { value: string; label: string }[];
  disabled?: boolean;
  className?: string;
}) {
  return (
    <Select
      value={value || "__all"}
      onValueChange={(v) => onChange(v === "__all" ? "" : v)}
      disabled={disabled}
    >
      <SelectTrigger
        aria-label={label}
        className={"h-11! bg-white " + className}
      >
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        {items.map((x) => (
          <SelectItem value={x.value || "__all"} key={x.value}>
            {x.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
export function DateTimeField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const day = value.slice(0, 10),
    [open, setOpen] = useState(false),
    d = new Date(
      Number(day.slice(0, 4)),
      Number(day.slice(5, 7)) - 1,
      Number(day.slice(8, 10)),
    );
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            className="h-12 w-full justify-start font-normal"
            aria-label={label}
          >
            <CalendarDays className="mr-2 size-4" />
            {day.replaceAll("-", " / ")}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-0">
          <Calendar
            mode="single"
            locale={zhCN}
            labels={{
              labelMonthDropdown: () => "月份",
              labelYearDropdown: () => "年份",
              labelPrevious: () => "上个月",
              labelNext: () => "下个月",
              labelDayButton: (date, modifiers) =>
                `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日${modifiers.selected ? "，已选择" : ""}${modifiers.today ? "，今天" : ""}`,
            }}
            formatters={{
              formatMonthDropdown: (date) => `${date.getMonth() + 1}月`,
            }}
            selected={d}
            defaultMonth={d}
            captionLayout="dropdown"
            startMonth={new Date(2020, 0)}
            endMonth={new Date(2100, 11)}
            onSelect={(date) => {
              if (date) {
                onChange(
                  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${value.slice(11) || "00:00"}`,
                );
                setOpen(false);
              }
            }}
          />
        </PopoverContent>
      </Popover>
      <Input
        aria-label={label + "时分"}
        type="time"
        step={60}
        value={value.slice(11, 16)}
        onChange={(e) => {
          if (e.target.value) onChange(day + "T" + e.target.value);
        }}
        className="h-11"
      />
    </div>
  );
}
export function FiltersBar() {
  const {
      filters: f,
      setFilters,
      options,
      reset,
      ready,
      csrf,
      preference,
      notify,
    } = useTraffic(),
    [open, setOpen] = useState(false),
    [from, setFrom] = useState(f.from),
    [to, setTo] = useState(f.to);
  const active = ["today", "7", "month", "year"].find((k) => {
    const p = period(k);
    return p.from === f.from && p.to === f.to;
  });
  const optionItems = (entries: Option[], label: string, value: string) => [
    { value: "", label },
    ...disambiguate(entries).map((x) => ({ value: x.id, label: x.label })),
    ...(value && !entries.some((x) => x.id === value)
      ? [{ value, label: "历史筛选 · " + value.slice(0, 8) }]
      : []),
  ];
  const opts = options || {
    subscriptions: [],
    apps: [],
    apps_combined: [],
    nodes: [],
  };
  return (
    <section className="filters-block" aria-label="筛选统计范围">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="range-tabs">
          {[
            ["today", "今天"],
            ["7", "近 7 天"],
            ["month", "本月"],
            ["year", "本年"],
          ].map(([key, label]) => (
            <Button
              key={key}
              variant={active === key ? "secondary" : "ghost"}
              aria-pressed={active === key}
              disabled={!ready}
              onClick={() =>
                setFilters({ ...period(key), granularity: "auto" })
              }
            >
              {label}
            </Button>
          ))}
          <Button
            variant={!active ? "secondary" : "ghost"}
            onClick={() => {
              setFrom(f.from);
              setTo(f.to);
              setOpen(true);
            }}
            disabled={!ready}
          >
            自定义
          </Button>
        </div>
        <Button
          variant="ghost"
          onClick={reset}
          disabled={!ready}
          className="text-muted-foreground"
        >
          重置筛选
        </Button>
      </div>
      <div className="filter-grid">
        <Choice
          label="应用归并"
          value={f.app_mode}
          disabled={!ready || !csrf}
          onChange={(v) =>
            void preference({ app_mode: v as Filters["app_mode"] }).catch((e) =>
              notify(e.message),
            )
          }
          items={[
            { value: "combined", label: "合并 ChatGPT / Codex" },
            { value: "separate", label: "应用分别统计" },
          ]}
        />
        <Choice
          label="订阅筛选"
          value={f.subscription}
          onChange={(subscription) => setFilters({ subscription })}
          items={optionItems(
            [...opts.subscriptions, { id: "unknown", name: "归属待确认" }],
            "全部订阅",
            f.subscription,
          )}
        />
        <Choice
          label="应用筛选"
          value={f.app}
          onChange={(app) => setFilters({ app })}
          items={optionItems(
            f.app_mode === "combined" ? opts.apps_combined : opts.apps,
            "全部应用",
            f.app,
          )}
        />
        <Choice
          label="节点筛选"
          value={f.node}
          onChange={(node) => setFilters({ node })}
          items={optionItems(opts.nodes, "全部节点", f.node)}
        />
      </div>
      {!active && (
        <div className="text-sm text-muted-foreground">
          {f.from.replace("T", " ")} 至 {f.to.replace("T", " ")} ·
          北京时间，结束不含
        </div>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>自定义统计范围</DialogTitle>
            <DialogDescription>
              北京时间，精确到分钟，最多 366 天。
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-5 py-4">
            <DateTimeField label="开始时间" value={from} onChange={setFrom} />
            <DateTimeField
              label="结束时间（不含）"
              value={to}
              onChange={setTo}
            />
          </div>
          {!validRange(from, to) && (
            <p role="alert" className="text-destructive">
              结束需晚于开始，范围为 1 分钟至 366 天。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              取消
            </Button>
            <Button
              disabled={!validRange(from, to)}
              onClick={() => {
                setFilters({ from, to, granularity: "auto" });
                setOpen(false);
              }}
            >
              应用范围
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
export function Pagination({
  count,
  offset,
  onChange,
  disabled = false,
}: {
  count: number;
  offset: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-5 py-4 text-sm text-muted-foreground">
      <span>
        {count
          ? `${offset + 1}–${Math.min(offset + 50, count)} / ${count} 条`
          : "暂无记录"}
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label="上一页"
          disabled={disabled || offset === 0}
          onClick={() => onChange(Math.max(0, offset - 50))}
        >
          <ChevronLeft className="size-4" />
          上一页
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-label="下一页"
          disabled={disabled || offset + 50 >= count}
          onClick={() => onChange(offset + 50)}
        >
          下一页
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}
export function QueryNotice({
  error,
  pending,
}: {
  error?: Error | null;
  pending?: boolean;
}) {
  if (error)
    return (
      <div role="alert" className="error-banner">
        {error.message}。请检查筛选条件或本机服务。
      </div>
    );
  if (pending)
    return (
      <div
        role="status"
        className="flex items-center gap-2 text-sm text-muted-foreground"
      >
        <LoaderCircle className="size-4 animate-spin" />
        正在更新统计，暂时显示上次结果。
      </div>
    );
  return null;
}
export function Rules({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>流量如何聚合</DialogTitle>
          <DialogDescription>
            显示方式可切换，原始记录始终保留。
          </DialogDescription>
        </DialogHeader>
        <div className="prose-copy">
          <h3>同一应用，少一点重复</h3>
          <p>
            汇总按应用身份、订阅和节点身份合计。不同代理链折叠进来源；同名但编号不同的应用或节点继续分开。
          </p>
          <h3>ChatGPT / Codex，可合可分</h3>
          <p>
            合并模式只匹配 ChatGPT、codex、ChatGPT Computer
            Use（忽略大小写和两端空格）。这是查看规则，不表示它们是同一进程。Chrome
            及无头浏览器保持独立。
          </p>
          <h3>来源可以核对</h3>
          <p>
            切换“应用分别统计”查看原始身份；点击来源查看完整编号、代理链和归属依据。来源数不是连接数。归并不增加或删除流量。
          </p>
          <h3>颜色与覆盖</h3>
          <p>
            日历统计上传与下载之和。斜纹表示无记录，◦
            表示部分记录；未来日期禁用。图表采样可能遗漏极短连接，覆盖率不代表完整账单。
          </p>
          <a
            className="inline-flex items-center gap-1 text-primary"
            href="/manual/聚合规则.html"
            target="_blank"
            rel="noreferrer"
          >
            阅读完整聚合规则
            <ArrowUpRight className="size-4" />
          </a>
        </div>
      </DialogContent>
    </Dialog>
  );
}
