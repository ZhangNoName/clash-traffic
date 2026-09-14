"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Layers, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { useTraffic, useDetails } from "./store";
import { Choice, FiltersBar, Pagination, QueryNotice, Rules } from "./controls";
import { api } from "@/lib/api";
import {
  bytes,
  query,
  time,
  type Filters,
  type Detail,
  type Details,
} from "@/lib/model";
function Sources({
  row,
  filters,
  onClose,
}: {
  row: Detail;
  filters: Filters;
  onClose: () => void;
}) {
  const [offset, setOffset] = useState(0),
    f = {
      ...filters,
      app: row.app_id,
      node: row.node_key,
      subscription: row.subscription_id,
      detail_mode: "sources" as const,
      ...(filters.detail_mode === "sources"
        ? { app_mode: "separate" as const }
        : {}),
    };
  const q = useQuery({
    queryKey: ["sources", f, offset],
    queryFn: ({ signal }) =>
      api<Details>("/api/details?" + query(f, { offset }), { signal }),
  });
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-2xl max-h-[88vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{row.app} · 流量来源</DialogTitle>
          <DialogDescription>
            当前范围内该应用、订阅和节点的原始记录组合。
          </DialogDescription>
        </DialogHeader>
        <QueryNotice error={q.error} />
        {q.isPending ? (
          <p role="status">正在读取来源…</p>
        ) : (
          q.data?.rows.map((r, i) => (
            <article className="source-card" key={i}>
              <div className="flex justify-between gap-4">
                <strong>{r.app}</strong>
                <strong>{bytes(r.upload + r.download)}</strong>
              </div>
              <dl>
                <dt>应用编号</dt>
                <dd>{r.app_id}</dd>
                <dt>实际节点</dt>
                <dd>
                  {r.node}
                  <code>{r.node_key}</code>
                </dd>
                <dt>代理链</dt>
                <dd>{r.chain}</dd>
                <dt>订阅归属</dt>
                <dd>
                  {r.subscription} · {r.attribution}
                </dd>
                <dt>记录范围</dt>
                <dd>
                  {time(r.first_seen)} 至 {time(r.last_seen)}
                </dd>
                <dt>传输</dt>
                <dd>
                  ↓ {bytes(r.download)}　↑ {bytes(r.upload)}
                </dd>
              </dl>
            </article>
          ))
        )}
        <Pagination
          count={q.data?.count || 0}
          offset={offset}
          onChange={setOffset}
          disabled={q.isFetching}
        />
        <div className="flex justify-end">
          <Button variant="outline" asChild>
            <Link
              href={
                "/mapping/?" + query(filters, { mapping_node: row.node_key })
              }
            >
              修改订阅归属
              <ArrowUpRight className="size-4" />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
export function DetailsPage() {
  const { filters, preference, csrf, notify } = useTraffic(),
    [page, setPage] = useState({ key: "", offset: 0 }),
    [source, setSource] = useState<{ row: Detail; filters: Filters } | null>(
      null,
    ),
    [rules, setRules] = useState(false);
  const key = query(filters),
    offset = page.key === key ? page.offset : 0,
    q = useDetails(offset),
    data = q.data;
  return (
    <div className="page-stack">
      <FiltersBar />
      <QueryNotice error={q.error} pending={q.isPlaceholderData} />
      <Card className="details-card">
        <CardHeader className="panel-heading">
          <CardTitle>
            流量明细 <Badge variant="secondary">{data?.count || 0}</Badge>
          </CardTitle>
          <div className="flex flex-wrap gap-2">
            <Choice
              label="明细方式"
              value={filters.detail_mode}
              disabled={!csrf}
              onChange={(v) =>
                void preference({
                  detail_mode: v as Filters["detail_mode"],
                }).catch((e) => notify(e.message))
              }
              items={[
                { value: "summary", label: "汇总" },
                { value: "sources", label: "按来源" },
              ]}
            />
            <Button variant="outline" onClick={() => setRules(true)}>
              <Layers className="size-4" />
              聚合规则
            </Button>
            <Button asChild>
              <a href={"/api/export.csv?" + query(filters)}>
                <Download className="size-4" />
                导出
              </a>
            </Button>
          </div>
        </CardHeader>
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>应用</TableHead>
                <TableHead>订阅</TableHead>
                <TableHead>实际节点</TableHead>
                <TableHead className="text-right">下载</TableHead>
                <TableHead className="text-right">上传</TableHead>
                <TableHead className="text-right">合计</TableHead>
                <TableHead>
                  <span className="sr-only">操作</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.rows.map((r, i) => (
                <TableRow
                  key={[
                    r.app_id,
                    r.node_key,
                    r.subscription_id,
                    r.chain,
                    r.attribution,
                    i,
                  ].join(":")}
                >
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <span className="app-avatar">
                        {r.app.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 2)}
                      </span>
                      <span className="font-medium">
                        {r.app}
                        <small className="identity">
                          {r.app_id === "family:openai"
                            ? "应用组合"
                            : r.app_id.slice(0, 8)}
                        </small>
                      </span>
                    </div>
                  </TableCell>
                  <TableCell>
                    {r.subscription_id === "unknown" ? (
                      <Badge variant="outline">{r.subscription}</Badge>
                    ) : (
                      r.subscription
                    )}
                  </TableCell>
                  <TableCell>
                    <span>{r.node}</span>
                    <small className="identity">{r.node_key.slice(0, 8)}</small>
                    {filters.detail_mode === "sources" && (
                      <div className="source-chain">
                        {r.chain}
                        <span>{r.attribution}</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell className="numeric">{bytes(r.download)}</TableCell>
                  <TableCell className="numeric">{bytes(r.upload)}</TableCell>
                  <TableCell className="numeric font-semibold">
                    {bytes(r.upload + r.download)}
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={q.isPlaceholderData || !!q.error}
                      onClick={() =>
                        setSource({ row: r, filters: { ...filters } })
                      }
                    >
                      来源{r.source_count > 1 ? " · " + r.source_count : ""}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {!data?.rows.length && (
                <TableRow>
                  <TableCell
                    colSpan={7}
                    className="h-40 text-center text-muted-foreground"
                  >
                    {q.isPending ? "正在读取…" : "暂无符合条件的记录"}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        <Pagination
          count={data?.count || 0}
          offset={offset}
          onChange={(v) => setPage({ key, offset: v })}
          disabled={q.isPlaceholderData}
        />
      </Card>
      {source && (
        <Sources
          row={source.row}
          filters={source.filters}
          onClose={() => setSource(null)}
        />
      )}
      <Rules open={rules} onOpenChange={setRules} />
    </div>
  );
}
