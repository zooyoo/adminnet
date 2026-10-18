# @vben/vsh

当前 pnpm workspace 的 Node.js 辅助 CLI，提供依赖检查、循环依赖检查和发布配置检查。根 `Web/package.json` 已以 `workspace:*` 引入，无需另行全局安装或使用 npm、Yarn 安装。

在 `Web/` 使用现有脚本：

| 根脚本 | 实际 CLI 命令 | 用途 |
| --- | --- | --- |
| `pnpm check:dep` | `vsh check-dep` | 检查依赖 |
| `pnpm check:circular` | `vsh check-circular` | 检查循环依赖 |
| `pnpm publint` | `vsh publint` | 检查包发布配置 |

直接查看当前 CLI 支持情况可执行 `pnpm exec vsh --help`；具体选项以本机输出和 [src/](src/) 为准。旧模板中的 `check-deps`、`scan-circular`、`publish-check` 不是当前命令名。

这些维护检查与应用 lint、类型检查是不同范围。部分检查需要对应外部 CLI 和完整 workspace 环境，命令存在不表示所有包都能在任意机器立即通过。依赖准备与日常应用检查见[前端说明](../../README.md)。
