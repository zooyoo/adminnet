# 编号提案隔离联调基线

这些脚本是可重复的隔离验收工具，脚本存在不等于任务完成。进度和证据以 `progress.md` 及对应 `issues/` 文件为准。

## 运行

在仓库根目录使用 PowerShell 7.5 或以上版本：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Admin.NET/Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj -c Debug --no-restore
if ($LASTEXITCODE -ne 0) { throw 'Backend build failed.' }
Push-Location Web
try {
    corepack pnpm build
    if ($LASTEXITCODE -ne 0) { throw 'Frontend build failed.' }
}
finally {
    Pop-Location
}
& .scratch/frontend-vben-migration/start-isolated-api.ps1 -Port 5017 -CrudFixture
```

记录脚本输出的 `Runtime` 目录；新建的主库、日志库、配置和证据只保存在该目录中。服务仅监听 loopback；不要将其暴露给其他机器。脚本不复制开发数据库和开发认证配置，JWT 密钥随机生成。种子账号及密码来自仓库种子代码，仅用于新建隔离库，不写入报告。

```powershell
$ErrorActionPreference = 'Stop'
$runtime = '替换为本次输出的完整 Runtime 目录'
node .scratch/frontend-vben-migration/run-position-baseline.mjs $runtime
if ($LASTEXITCODE -ne 0) { throw 'Real CRUD baseline failed.' }
& .scratch/frontend-vben-migration/stop-isolated-api.ps1 -RuntimeRoot $runtime
```

`-CrudFixture` 为该次 CRUD 场景关闭隔离库的图形验证码；不带此开关会保留原始验证码配置。不能把关闭验证码的登录结果当作验证码验收。浏览器脚本使用已安装的 Playwright、Edge 和 Node.js `node:sqlite`，启动临时端口服务提供 `Web/dist` 并代理到本次隔离 API；不拦截或伪造业务响应。

浏览器脚本最后执行真实停机场景，会通过 `stop-isolated-api.ps1` 关闭本次 API，验证桌面和手机保存失败时的草稿与数据库状态。因此每次完整验收应创建新的隔离运行，不复用上轮已停止的服务。脚本中途失败时，仍需运行停止命令释放可能存活的 API。报告的 `baselinePassed` 只表示已编写场景通过，`proposalComplete` 保持 `false`，剩余要求记录在 `pending` 中。

## 清理

默认停止服务但保留数据库和证据。归档所需证据后，显式使用 `-RemoveRuntime` 删除该次临时目录。脚本检查目录父级、名称、marker、进程名称和启动时间，拒绝对不匹配的目标停止或递归删除。

```powershell
$ErrorActionPreference = 'Stop'
& .scratch/frontend-vben-migration/stop-isolated-api.ps1 -RuntimeRoot $runtime -RemoveRuntime
```

## 接续

第 01、02 项已经验收，下一项为 03。按最新用户要求逐项更新进度、提交代码、保存交接记录后继续，不以创建新会话为前置条件。

## 缓存验收

生产前端构建后，用 `-CrudFixture` 创建新的隔离 API，再运行：

```powershell
$ErrorActionPreference = 'Stop'
node .scratch/frontend-vben-migration/run-cache-baseline.mjs $runtime --contracts
if ($LASTEXITCODE -ne 0) { throw 'Cache baseline failed.' }
```

脚本使用真实种子地址 `/platform/cache`，验证桌面和手机读写、权限拒绝；可选 `--contracts` 在相同生产产物上运行 Mock 契约，报告明确区分两类证据。最后主动停止本次隔离 API，验证停机反馈，因此不可直接复用已完成运行的服务。中途失败仍需执行停止脚本。

若默认后端输出被用户调试进程占用，使用 `dotnet build -o <独立临时目录>`，向启动脚本传入 `-BuildRoot <独立临时目录>`；不得为验收终止用户调试服务。
