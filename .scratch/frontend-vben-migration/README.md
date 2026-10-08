# 第 01 项隔离联调基线

这些脚本是进行中的验收工具，不代表第 01 项已经完成。进度以 `progress.md` 和 `issues/01-real-login-position-baseline.md` 为准。

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

继续第 01 项未勾选验收条件，不能开始第 02 项或把基线报告当作提案完成。第 01 项完全验收后才更新总进度并创建新会话。当前工具目录未提供 `create_thread`，因此尚未创建下一会话。
