"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ChartNoAxesColumnIncreasing,
  LayoutDashboard,
  ListFilter,
  Network,
  Settings2,
  Info,
  ArrowDown,
  ArrowUp,
} from "lucide-react";
import { useTraffic } from "./store";
import { bytes, query } from "@/lib/model";
const links = [
  { href: "/", label: "流量总览", icon: LayoutDashboard, id: "overview" },
  { href: "/details/", label: "流量明细", icon: ListFilter, id: "details" },
  { href: "/mapping/", label: "归属管理", icon: Network, id: "manage" },
  { href: "/settings/", label: "存储设置", icon: Settings2, id: "settings" },
  { href: "/about/", label: "统计说明", icon: Info, id: "about" },
];
export function Shell({ children }: { children: React.ReactNode }) {
  const path = usePathname(),
    { filters, status, error, notice, ready } = useTraffic();
  const live = !!(
    status?.connected &&
    status.collector_alive &&
    status.last_sample &&
    Date.now() / 1000 - status.last_sample < 8
  );
  return (
    <div className="app-shell">
      <a href="#main" className="sr-only focus:not-sr-only">
        跳转到内容
      </a>
      <aside className="sidebar">
        <Link href={ready ? "/?" + query(filters) : "/"} className="brand">
          <span className="brand-mark">
            <ChartNoAxesColumnIncreasing />
          </span>
          <span>Clash 流量簿</span>
        </Link>
        <nav aria-label="主导航">
          {links.map(({ href, label, icon: Icon, id }) => (
            <Link
              key={href}
              id={id}
              href={ready ? href + "?" + query(filters) : href}
              prefetch
              className={
                "nav-item " +
                (path.replace(/\/$/, "") === href.replace(/\/$/, "")
                  ? "active"
                  : "")
              }
              aria-current={
                path.replace(/\/$/, "") === href.replace(/\/$/, "")
                  ? "page"
                  : undefined
              }
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <div className="sidebar-status">
          <div className="flex items-center gap-2">
            <i className={"status-dot " + (live ? "online" : "")} />
            <span>{live ? "记录中" : status ? "采集暂停" : "连接中"}</span>
          </div>
          {live && (
            <div className="speed-readout">
              <span>
                <ArrowDown />
                {bytes(status?.download_speed || 0)}/s
              </span>
              <span>
                <ArrowUp />
                {bytes(status?.upload_speed || 0)}/s
              </span>
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <span className="status-dot online" />
          仅统计代理流量
        </div>
      </aside>
      <main id="main" className="main-content">
        {error && (
          <div className="error-banner" role="alert">
            {error}
          </div>
        )}
        {ready ? (
          children
        ) : (
          <div className="page-stack" role="status">
            <div className="h-24 rounded-xl bg-muted animate-pulse" />
            <div className="h-40 rounded-xl bg-muted animate-pulse" />
            <div className="h-80 rounded-xl bg-muted animate-pulse" />
            <span className="sr-only">正在读取本机统计…</span>
          </div>
        )}
      </main>
      <a
        id="export"
        href={ready ? "/api/export.csv?" + query(filters) : "/api/export.csv"}
        hidden
        tabIndex={-1}
      >
        导出明细
      </a>
      {notice && (
        <div role="status" className="app-toast">
          {notice}
        </div>
      )}
      {!ready && (
        <span className="sr-only" role="status">
          正在初始化应用
        </span>
      )}
    </div>
  );
}
