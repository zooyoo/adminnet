# @vben/turbo-run

workspace 内的交互式脚本选择工具。它发现具备目标脚本的包，供用户选择，再交给 Turbo 执行。根 `Web/package.json` 已通过 `workspace:*` 引入本工具，无需另行安装。

从 `Web/` 查看帮助或运行目标脚本：

```powershell
$ErrorActionPreference = 'Stop'
pnpm exec turbo-run --help
pnpm exec turbo-run dev
```

候选包来自当前 workspace 的实际 `package.json`；交互式终端需要能接收用户选择。选定包必须定义对应脚本，具体参数与执行方式以 [src/](src/) 和本机 `--help` 为准。

当前 Admin.NET 根 `pnpm dev`、`pnpm build` 直接选择 `@vben/web-antdv-next`，日常开发不经过本交互工具。不要沿用上游模板中的 `@vben/app`、`@vben/admin`、`@vben/website` 示例作为本仓库应用。

应用命令、环境版本和构建输出见[前端说明](../../README.md)。
