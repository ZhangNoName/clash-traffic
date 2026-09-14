# 参与贡献

感谢你改进 Clash 流量簿。提交问题前，请先确认问题来自本项目的统计器或界面，而不是 Clash Verge、Mihomo 节点或订阅服务。

## 开发环境

- macOS 13.3 或更高版本，Apple Silicon。
- Python 3.9 或兼容版本。
- Node.js 20.9 或更高版本与 npm。
- 正在运行且启用 Unix socket 的 Clash Verge Rev / Mihomo。

```sh
git clone git@github.com:ZhangNoName/clash-traffic.git
cd clash-traffic

python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m unittest discover -s tests -v

cd frontend
npm ci
npm run test
npm run check
```

开发服务必须使用独立的数据目录和端口，避免接触正式历史：

```sh
python3 build_frontend.py
python3 -m clash_traffic.server --data-dir ./preview-data --port 19799
```

## 提交改动

1. 每个改动聚焦一个明确问题，说明修改前后的行为。
2. 涉及统计口径时，补充字节守恒、时间边界或覆盖率测试。
3. 涉及界面时，检查 850 × 620 的最小窗口、键盘操作和空数据状态。
4. 不提交订阅地址、节点凭据、真实连接记录、数据库、`identity.key`、日志、构建缓存或签名材料。
5. 更新相关 Markdown 文档；生成的离线 HTML 由 `build_docs.py` 更新。

提交 Pull Request 时请写明验证命令、已知限制，以及是否改变数据库、采集口径或隐私边界。

## 安全问题

可能泄露订阅凭据、绕过本机接口限制或暴露访问记录的问题，不要附带真实敏感数据公开提交。请使用 GitHub Security Advisory 私下报告，并提供可脱敏复现步骤。
