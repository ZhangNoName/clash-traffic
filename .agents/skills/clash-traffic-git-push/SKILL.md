---
name: clash-traffic-git-push
description: Commit and push changes in the clash-traffic repository using macOS Apple Git. Use when the user asks to commit, push, sync, or publish clash-traffic changes to its configured GitHub origin.
---

# Clash Traffic Git 提交与推送

在 `clash-traffic` 仓库中提交或推送时，显式使用 macOS 原生 Git `/usr/bin/git`，不要依赖 `PATH` 解析 Git，也不要使用 `gh` 代替 Git 提交或推送。

## 提交

1. 用 `/usr/bin/git status --short --branch` 和 `/usr/bin/git diff` 检查修改范围。
2. 确认待提交内容中没有意外的密钥、环境变量或无关文件。
3. 使用 `/usr/bin/git add <明确的文件路径>` 暂存目标文件。
4. 除非用户指定其他语言或提交信息，使用中文 commit message：

   ```sh
   /usr/bin/git commit -m '<中文提交信息>'
   ```

## 推送

用户明确要求推送或同步后，直接使用下面的命令，避免本机全局 `pre-push` 钩子拦截：

```sh
/usr/bin/git -c http.version=HTTP/1.1 push --no-verify -u origin HEAD
```

- `--no-verify` 只作用于本次推送，不修改或禁用全局钩子配置。
- `http.version=HTTP/1.1` 只作用于本次命令，用于避免 Apple Git 经本机代理访问 GitHub 时出现 TLS 连接错误。
- 不使用 `git reset --hard` 或 `git push --force`。
- 如果远端拒绝推送、分支发生分叉或命令仍失败，停止并汇报，不自动 merge、rebase、reset 或强推。

## 核验

推送完成后运行：

```sh
/usr/bin/git status --short --branch
/usr/bin/git ls-remote --heads origin HEAD
```

确认当前分支已跟踪远端、工作区状态符合预期，并汇报远端仓库与提交哈希。
