#!/usr/bin/env python3
"""Build standalone, offline HTML manuals from docs/*.md (Markdown 3.7)."""
from pathlib import Path
import html
import markdown

ROOT = Path(__file__).resolve().parent / 'docs'
TITLES = ['使用文档', '运行文档', '系统说明', '聚合规则']
CSS = '''
:root{font-family:-apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif;color:#283f32;background:#f4f7f4;font-size:17px;line-height:1.8}*{box-sizing:border-box}body{margin:0}header{background:#fff;border-bottom:1px solid #e0e9e2;padding:20px max(24px,calc((100vw - 1100px)/2));display:flex;align-items:center;justify-content:space-between;gap:20px}header strong{white-space:nowrap}nav{display:flex;gap:20px;flex-wrap:wrap}a{color:#17765f;text-underline-offset:4px}header a{text-decoration:none}header a[aria-current]{font-weight:650;color:#214d35}main{max-width:1100px;margin:32px auto;padding:42px 54px;background:white;border:1px solid #e0e9e2;border-radius:20px}h1{font-size:34px;line-height:1.35;margin:0 0 20px;letter-spacing:-.8px}h2{font-size:25px;margin:40px 0 16px;scroll-margin-top:24px}h3{font-size:20px;margin:28px 0 12px}p{margin:14px 0}li{margin:8px 0}table{display:block;max-width:100%;overflow-x:auto;border-collapse:collapse;font-size:16px;margin:22px 0}th,td{border:1px solid #e0e8e1;padding:12px 16px;text-align:left;vertical-align:top}th{background:#f1f6f2;white-space:nowrap}code{font-family:ui-monospace,SFMono-Regular,monospace;font-size:.85em;background:#eff4f0;padding:3px 5px;border-radius:4px;overflow-wrap:anywhere}pre{overflow:auto;background:#eef4ef;border:1px solid #dfebe1;border-radius:12px;padding:22px;line-height:1.6}pre code{padding:0;background:transparent;white-space:pre;overflow-wrap:normal}.toc{background:#f6f9f6;border:1px solid #e5eee6;border-radius:12px;padding:18px 26px;margin:24px 0}.toc ul{padding-left:20px;margin:0}.toc a{text-decoration:none;font-size:16px}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:20px;margin:32px 0}.card{display:block;padding:24px;border:1px solid #dce9df;border-radius:16px;text-decoration:none;background:#f4f9f5}.card strong{display:block;font-size:22px}.card p{font-size:16px;color:#718276;margin:12px 0 0}footer{border-top:1px solid #e3ece5;margin-top:40px;padding-top:20px;font-size:14px;color:#79887c}a:focus-visible{outline:3px solid #5c9977;outline-offset:4px}@media(max-width:800px){header{padding:18px 22px;display:block}nav{margin-top:12px}main{margin:18px;padding:28px 24px}.cards{grid-template-columns:1fr}h1{font-size:28px}}@media print{body{background:white;font-size:11pt}header,.toc{display:none}main{border:0;margin:0;padding:0;max-width:none}h1{font-size:24pt}h2{font-size:17pt;break-after:avoid}h3{break-after:avoid}pre,table{break-inside:avoid}a{color:inherit}table{font-size:10pt}}
'''

def page(title, body):
    links=''.join(f'<a href="{name}.html"'+(' aria-current="page"' if name==title else '')+f'>{name}</a>' for name in TITLES)
    return f'''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{html.escape(title)} · Clash 流量簿</title><style>{CSS}</style></head><body><header><strong><a href="index.html">Clash 流量簿 · 文档</a></strong><nav aria-label="文档导航">{links}</nav></header><main>{body}<footer>版本 0.2.0 · 本文档支持离线阅读与打印 · 2026-09-12</footer></main></body></html>'''

for title in TITLES:
    source=(ROOT/(title+'.md')).read_text()
    for name in TITLES:source=source.replace(f']({name}.md)',f']({name}.html)')
    md=markdown.Markdown(extensions=['tables','fenced_code','toc'],extension_configs={'toc':{'toc_depth':'2'}})
    body=md.convert(source)
    end=body.find('</h1>')+5
    body=body[:end]+md.toc+body[end:]
    (ROOT/(title+'.html')).write_text(page(title,body))
descriptions=['日常查询、时间筛选、归属管理、清理与导出。','安装升级、备份恢复、故障排查与源码构建。','架构、统计口径、数据模型、接口与组件选择。','应用合并、来源区分、日历颜色与导出口径。']
body='<h1>Clash 流量簿，使用与维护</h1><p>从日常查看到系统维护，按需要选择一份文档。</p><div class="cards">'+''.join(f'<a class="card" href="{title}.html"><strong>{title} →</strong><p>{desc}</p></a>' for title,desc in zip(TITLES,descriptions))+'</div><p>文档为独立 HTML，无需联网。可通过浏览器打印菜单保存为 PDF；同目录包含可编辑的 Markdown 原稿。</p>'
(ROOT/'index.html').write_text(page('文档首页',body))
print('Built 5 offline HTML pages in',ROOT)
