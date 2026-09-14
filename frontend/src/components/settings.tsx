"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { HardDrive, Trash2, Save, FolderClock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { DateTimeField, QueryNotice } from "./controls";
import { useTraffic } from "./store";
import { api, post } from "@/lib/api";
import { bytes, time, validRange, type Storage } from "@/lib/model";
export function SettingsPage() {
  const { filters, csrf, refresh, notify } = useTraffic(),
    q = useQuery({
      queryKey: ["storage"],
      queryFn: ({ signal }) => api<Storage>("/api/storage", { signal }),
    });
  const [days, setDays] = useState<string | null>(null),
    [mb, setMb] = useState<string | null>(null),
    [from, setFrom] = useState(filters.from),
    [to, setTo] = useState(filters.to),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmation, setConfirmation] = useState<"save" | "range" | "all" | null>(
      null,
    );
  const data = q.data,
    d = days ?? String(data?.settings.retention_days ?? 180),
    m = mb ?? String(data?.settings.max_mb ?? 256),
    valid =
      /^\d+$/.test(d) &&
      Number(d) <= 3650 &&
      /^\d+$/.test(m) &&
      Number(m) >= 8 &&
      Number(m) <= 8192;
  const execute = async () => {
    setBusy(true);
    setError("");
    try {
      if (confirmation === "save") {
        await post(
          "/api/settings",
          { retention_days: Number(d), max_mb: Number(m) },
          csrf,
        );
        notify("存储设置已保存");
      } else {
        const result = await post<{ deleted_rows: number }>(
          "/api/cleanup",
          { scope: confirmation, confirm: true, from, to },
          csrf,
        );
        notify(`已清理 ${result.deleted_rows} 条分钟汇总`);
      }
      setConfirmation(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-page page-stack">
      <div className="page-heading">
        <h1>存储设置</h1>
        <span>历史记录只保存在本机</span>
      </div>
      <QueryNotice error={q.error} />
      <Card>
        <CardContent className="storage-summary">
          <div className="flex items-center gap-3 text-muted-foreground">
            <HardDrive className="size-5" />
            已用空间
          </div>
          <div className="flex items-end justify-between gap-4">
            <strong>{data ? bytes(data.bytes) : "—"}</strong>
            <span>上限 {data?.settings.max_mb ?? "—"} MB</span>
          </div>
          <div className="storage-meter">
            <i
              style={{
                width:
                  Math.min(
                    100,
                    ((data?.bytes || 0) /
                      ((data?.settings.max_mb || 256) * 1024 ** 2)) *
                      100,
                  ) + "%",
              }}
            />
          </div>
          <p>
            {data?.oldest
              ? `${time(data.oldest)} 至 ${time(data.newest)}`
              : "尚无历史记录"}
          </p>
        </CardContent>
      </Card>
      <Tabs defaultValue="auto">
        <TabsList className="mb-5">
          <TabsTrigger value="auto">自动清理</TabsTrigger>
          <TabsTrigger value="manual">手动清理</TabsTrigger>
        </TabsList>
        <TabsContent value="auto">
          <Card>
            <CardHeader>
              <CardTitle>保留策略</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="retention-days">保留天数</Label>
                  <div className="unit-input">
                    <Input
                      id="retention-days"
                      type="number"
                      min={0}
                      max={3650}
                      value={d}
                      onChange={(e) => setDays(e.target.value)}
                    />
                    <span>天</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    0 表示不按天数清理
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="max-mb">最大空间</Label>
                  <div className="unit-input">
                    <Input
                      id="max-mb"
                      type="number"
                      min={8}
                      max={8192}
                      value={m}
                      onChange={(e) => setMb(e.target.value)}
                    />
                    <span>MB</span>
                  </div>
                  <p className="text-sm text-muted-foreground">8–8192 MB</p>
                </div>
              </div>
              <div className="policy-note">
                <FolderClock className="size-5" />
                过期或超过上限，自动清理最早的历史。
              </div>
              <details className="text-muted-foreground">
                <summary className="cursor-pointer">空间如何计算</summary>
                <p className="mt-3 leading-7">
                  包含数据库和 WAL/SHM，每分钟检查一次。超限后清理至约
                  80%；检查间隔和压缩期间可能暂时超限。程序文件不计入，日志另限约
                  3 MB。
                </p>
              </details>
              <div className="flex justify-end">
                <Button
                  disabled={!valid || !csrf || !data}
                  onClick={() => {
                    setError("");
                    setConfirmation("save");
                  }}
                >
                  <Save className="size-4" />
                  保存设置
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="manual">
          <Card>
            <CardHeader>
              <CardTitle>清理历史</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <p className="text-muted-foreground">
                删除所选时段内全部应用与节点的记录，后台继续采集。
              </p>
              <div className="grid grid-cols-2 gap-5">
                <DateTimeField
                  label="清理开始时间"
                  value={from}
                  onChange={setFrom}
                />
                <DateTimeField
                  label="清理结束时间（不含）"
                  value={to}
                  onChange={setTo}
                />
              </div>
              <div className="flex justify-end">
                <Button
                  variant="outline"
                  disabled={!validRange(from, to) || !csrf}
                  onClick={() => {
                    setError("");
                    setConfirmation("range");
                  }}
                >
                  清理所选时段
                </Button>
              </div>
              <div className="border-t pt-6 flex flex-wrap justify-between items-center gap-4">
                <div>
                  <h3 className="font-semibold">全部历史</h3>
                  <p className="text-muted-foreground mt-2">
                    保留设置和订阅映射
                  </p>
                </div>
                <Button
                  variant="destructive"
                  disabled={!csrf}
                  onClick={() => {
                    setError("");
                    setConfirmation("all");
                  }}
                >
                  <Trash2 className="size-4" />
                  清理全部
                </Button>
              </div>
              <p className="text-sm text-muted-foreground">
                {data?.last_cleanup
                  ? `上次清理 ${time(data.last_cleanup.at)} · ${data.last_cleanup.reason} · ${data.last_cleanup.rows} 条`
                  : "尚无清理记录"}
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
      <AlertDialog
        open={confirmation !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setConfirmation(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmation === "save"
                ? "保存清理策略？"
                : confirmation === "all"
                  ? "清理全部历史？"
                  : "清理指定时段？"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmation === "save"
                ? `保留${Number(d) ? `最近 ${d} 天` : "全部日期"}，空间上限 ${m} MB。保存后立即检查，超出的最早记录将被永久删除。`
                : confirmation === "all"
                  ? "全部统计历史将永久删除，无法恢复。设置和映射保留，后台继续记录。"
                  : `${from.replace("T", " ")} 至 ${to.replace("T", " ")}（结束不含）的全部应用与节点历史将永久删除，不受统计页筛选影响。`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>取消</AlertDialogCancel>
            <Button
              variant={confirmation === "save" ? "default" : "destructive"}
              disabled={busy}
              onClick={() => void execute()}
            >
              {busy ? "正在处理…" : "确认"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
