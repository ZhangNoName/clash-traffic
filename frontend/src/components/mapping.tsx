"use client";
import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Choice } from "./controls";
import { useTraffic } from "./store";
import { post } from "@/lib/api";
import { disambiguate } from "@/lib/model";
export function MappingPage() {
  const { options, csrf, refresh, notify } = useTraffic(),
    [node, setNode] = useState(""),
    [sid, setSid] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!options?.nodes.length) return;
    const requested = new URLSearchParams(location.search).get("mapping_node");
    const selected =
      options.nodes.find((n) => n.id === (requested || node)) ||
      options.nodes[0];
    if (!node) {
      setNode(selected.id);
      setSid(selected.override || "");
    }
  }, [options, node]);
  const save = async () => {
    setBusy(true);
    setError("");
    try {
      await post(
        "/api/override",
        { node_key: node, subscription_id: sid || null },
        csrf,
      );
      refresh();
      notify("归属已更新，历史与后续统计同步生效");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="settings-page page-stack">
      <div className="page-heading">
        <h1>订阅归属</h1>
        <span>为已记录的节点指定订阅</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>归属管理</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label>已记录节点</Label>
            <Choice
              className="w-full"
              label="选择已记录节点"
              value={node}
              disabled={busy || !options?.nodes.length}
              items={disambiguate(options?.nodes || []).map((n) => ({
                value: n.id,
                label: n.label + " · " + n.id.slice(0, 8),
              }))}
              onChange={(v) => {
                setNode(v);
                setSid(options?.nodes.find((n) => n.id === v)?.override || "");
              }}
            />
            {node && <p className="identity break-all">节点编号 {node}</p>}
          </div>
          <div className="space-y-2">
            <Label>订阅归属</Label>
            <Choice
              className="w-full"
              label="订阅归属"
              value={sid}
              disabled={busy}
              items={[
                { value: "", label: "自动识别（恢复原始归属）" },
                ...(options?.subscriptions || []).map((s) => ({
                  value: s.id,
                  label: s.name,
                })),
              ]}
              onChange={setSid}
            />
          </div>
          <p className="text-muted-foreground leading-7">
            修改作用于这个节点身份的全部历史与后续统计。选择“自动识别”可撤销覆盖，流量字节不会改变。
          </p>
          {!options?.nodes.length && (
            <p>尚无已记录节点，产生代理流量后即可管理。</p>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end">
            <Button
              disabled={busy || !csrf || !node}
              onClick={() => void save()}
            >
              {busy ? "保存中…" : "保存归属"}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
