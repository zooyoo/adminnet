# Admin.NET.Web.Entry

本文件补充[仓库规则](../../AGENTS.md)，适用于 API 宿主与发布入口。

## 职责与依赖

[Admin.NET.Web.Entry.csproj](Admin.NET.Web.Entry.csproj) 是 `net10.0` 的可执行 Web 项目，直接引用 `Admin.NET.Web.Core`。依赖方向为 Entry → Web.Core → Application → Core；位于解决方案中的插件仍需显式接入这条依赖链。

[Program.cs](Program.cs) 通过 `Serve.Run`、`RunOptions.Default` 和 `AddWebComponent<WebComponent>` 启动宿主，并配置 Windows Service 支持。`WebComponent.Load` 处理日志过滤与 Kestrel 限制；服务注册和请求管道见 [Web.Core 规则](../Admin.NET.Web.Core/CLAUDE.md)。

## 运行与发布边界

- 监听地址需联合检查 Application 的 `Configuration/App.json`、开发启动配置和部署环境；以进程实际监听地址为准，不把开发端口当作所有环境的固定端口。
- 日志有 `Program.cs` 中的自定义过滤谓词，排查缺失日志时同时检查该谓词与日志配置，不能只改配置级别就假设框架日志会恢复。
- Kestrel 的请求大小、超时限制与反向代理、上传业务校验共同生效。`MaxRequestBodySize = null` 不代表所有大小或类型的文件都会被业务接受。
- `wwwroot/` 包含服务端静态资源、模板与运行期文件。前端独立构建到 `Web/dist/`；是否由本宿主托管，需以部署方式为准。
- 项目文件控制 IP 数据库、更新脚本、模板等资源复制；`wwwroot/avatar/` 和 `wwwroot/upload/` 有发布排除规则。发布前核对所需资源，运行期上传数据另行持久化，不能把它们当作可重建构建产物。
- 当前 [Dockerfile](Dockerfile) 仍以 ASP.NET Core 6 运行时为基础镜像，与本项目的 .NET 10 不匹配；[Docker 说明](../../docker/README.md) 列出 Compose 的其他待对齐项，不能直接将旧模板视为已验收的发布方案。

## 构建与验收

以下命令从 `Admin.NET/` 执行，按改动选择构建或发布：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'Web.Entry 构建失败' }
dotnet publish Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj -c Release -f net10.0
if ($LASTEXITCODE -ne 0) { throw 'Web.Entry 发布失败' }
```

需要运行验证时使用 `dotnet run --project Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj`，并按场景准备配置与依赖。检查启动日志、实际监听地址、受影响的认证 API 和资源访问；启动成功与发布成功不能替代业务验收。

数据库联调使用隔离的真实 PostgreSQL；前后端流程遵循仓库的桌面端验收要求。仅修改说明时核对项目文件、路径与命令即可，无需为文档启动服务。
