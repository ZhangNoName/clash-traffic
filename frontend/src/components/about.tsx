"use client";
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useTraffic, useSummary } from "./store";
import { Rules } from "./controls";
import { time } from "@/lib/model";
export function AboutPage() {
  const { status } = useTraffic(),
    q = useSummary(),
    [rules, setRules] = useState(false);
  return (
    <div className="settings-page page-stack">
      <div className="page-heading">
        <h1>统计说明</h1>
        <span>了解数据从哪里来</span>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>本机代理流量账本</CardTitle>
        </CardHeader>
        <CardContent className="prose-copy">
          <p>
            首次记录 {time(status?.created_at)} · 当前{" "}
            {status?.totals?.proxy || 0} 条代理连接，已排除{" "}
            {status?.totals?.excluded || 0} 条直连 / 拦截。
          </p>
          <h3>只计算真正经过代理节点的流量</h3>
          <p>
            依据每条连接的实际代理链识别，排除
            DIRECT、REJECT。应用辅助进程尽可能归并到所属应用；多跳连接只计一次，不代表各跳的计费用量。
          </p>
          <h3>采样记录，不是完整账单</h3>
          <p>
            每秒读取活动连接，记录上传、下载累计值的差额。极短连接和连接结束前最后一段可能遗漏，也不包含所有协议开销或机场倍率。已建立连接沿用首次识别结果，配置每
            5 秒刷新。
          </p>
          <h3>没有记录的时段不能当作零用量</h3>
          <p>
            首次启动建立基线，不补算已有流量。休眠、中断超过 5
            秒或重启后重建基线，缺失流量不推算。采集覆盖描述记录器工作时间，不代表字节完整率。单次增量跨分钟时按时间比例分配。
          </p>
          <h3>应用与订阅都有可追溯的来源</h3>
          <p>
            用运行配置与节点身份匹配订阅，无法确定时标为“归属待确认”。应用合并仅改变查询显示，原始身份保留；浏览器访问
            ChatGPT 网站仍归浏览器。
          </p>
          <Button variant="outline" onClick={() => setRules(true)}>
            查看聚合规则
          </Button>
          <h3>数据保存在本机</h3>
          <p>
            不保存访问域名、IP、订阅地址、节点密码或原始连接，不上传云端。历史从开始采集时积累，可配置保留期限与空间上限。
          </p>
          <h3>最近采集事件</h3>
          {q.data?.events.length ? (
            q.data.events.map((e, i) => (
              <p key={i}>
                {time(e.start)} → {time(e.end)}
                <br />
                {e.kind}
              </p>
            ))
          ) : (
            <p>当前统计范围暂无中断记录。</p>
          )}
          <div className="border-t pt-5 flex flex-wrap gap-4">
            {["使用文档", "运行文档", "系统说明", "聚合规则"].map((title) => (
              <a
                key={title}
                href={"/manual/" + title + ".html"}
                target="_blank"
                rel="noreferrer"
              >
                {title} ↗
              </a>
            ))}
          </div>
        </CardContent>
      </Card>
      <Rules open={rules} onOpenChange={setRules} />
    </div>
  );
}
