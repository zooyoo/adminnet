# 第 47 项隔离清理复现

本项已完成隔离副本的清理和可发布构建验证，主工作区的 770 个旧文件仍保留。第 41 项真实视频按用户指令暂缓，第 46 项整体尚未闭票，因此本项状态为已验范围通过。

固定基线为 `3f381c3633880462a0903301a1c74136c7e5e1f0`，本地回退引用为 `proposal-47-recovery-3f381c363`。`cleanup47-plan.json` 列出全部删除路径及原始 SHA256、7 个无消费者 catalog 和 4 份部署配置备份摘要。准备脚本先检查自有临时目录、owner 和全清单哈希，再删除；重复执行只接受同一清单的已准备副本，不修改主工作区。

以下 PowerShell 7 命令从仓库根目录执行；Node、pnpm launcher 和 store 路径按本机环境赋值。

```powershell
$ErrorActionPreference = 'Stop'
# 创建新的自有 worktree，并应用固定清单。
& pwsh -NoProfile -File .scratch/frontend-vben-migration/create-cleanup47-worktree.ps1 -NodePath $node
if ($LASTEXITCODE -ne 0) { throw 'Candidate preparation failed' }
$ctl = Get-Content .scratch/frontend-vben-migration/cleanup47-control.tmp.json -Raw -Encoding UTF8 | ConvertFrom-Json
# 后续 pnpm 命令在 $ctl.root/Web 中执行。
& $node $pnpm install --frozen-lockfile --offline --store-dir $store
& $node $pnpm lint
& $node $pnpm check:type
& $node $pnpm exec vitest run apps/web-antdv-next/src
# 每条原生命令执行后均检查 $LASTEXITCODE，非零即停止。
```

在原仓库根目录运行 `node .scratch/frontend-vben-migration/build-cleanup47-dependency-evidence.mjs <候选副本绝对路径>`，使用真实 Vite 构建并记录静态与动态模块、包及产物哈希。应没有 Element Plus、Ant Design Vue、Naive UI、TDesign、VXE 等旧 UI 包，且保留 Antdv Next、MQTT、EZUIKit、Office、PDF、富文本引擎。

后端命令为 `dotnet build <候选副本>/Admin.NET/Admin.NET.sln -c Release -m:1 -nr:false --artifacts-path <候选副本>/cleanup47-backend-artifacts`。测试 apphost 位于 `bin/Admin.NET.Test/release_net10.0`，分别执行 `--filter-class Admin.NET.Test.CodeGen.*` 和 `--filter-class Admin.NET.Test.Menu.*`。保留 xUnit v3 apphost，不与主工作区构建输出共享。

将安装结果和检查退出码写入候选副本的 `cleanup47-evidence/install-result.json`、`frontend-checks.json`，然后在原仓库运行 `prepare-cleanup47-browser-baseline.mjs` 和生成的 `run-cleanup47-browser-baseline.mjs 5157`。浏览器脚本读取当前控制文件，核实清理状态，使用副本 Web/dist、Release API、真实 PostgreSQL 和两份 Nginx 配置；HTTP/TLS、登录、文件、SignalR、调度看板 SSE 及独立资源清理必须全部通过。脚本仅访问自有 loopback 环境。

当前证据：冻结离线安装 pnpm 11.16.0、51 个文件 473 项前端回归、145 项后端 Release 回归、完整手写 lint、类型检查、前后端构建和 13 个真实浏览器阶段均通过。Vite 8.3.0 的依赖图包含 13390 个模块、242 个包、351 个输出 chunk。自动生成 SDK 由生成链及 TypeScript 验证，不套用手写文件排序规则。

调度看板由 Furion 4.9.9.92 的 `UseScheduleUI` 提供，不能通过查找独立 Sundial.dll 判断是否保留；本轮以真实独立登录和 `/schedule/api/check-change` 事件作为运行证据。

详见 `cleanup47-acceptance.json`。主清理、整体闭票与外部生产切换均未执行，正式证书和生产环境也未访问。
