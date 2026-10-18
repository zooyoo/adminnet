# Admin.NET.Plugin.ReZero

本文件补充[仓库规则](../../../AGENTS.md)，适用于 ReZero 动态 API 的接入、认证拦截和日志。

## 职责与接入

[项目文件](Admin.NET.Plugin.ReZero.csproj) 引用 Core 和 `Rezero.Api`，目标框架为 `net8.0;net10.0`，并声明配置与静态资源的输出、发布复制规则。当前 API 入口的项目引用链未接入本插件；解决方案中的工程条目只表示它参与解决方案管理。

- [Startup.cs](Startup.cs) 读取 [ReZeroOptions](Option/ReZeroOptions.cs) 和数据库选项，配置 ReZero、动态 API 与 AOP，并在请求管道中接入组件。
- [SuperApiAop](Service/SuperApiAop.cs) 继承 `DefaultSuperApiAop`，负责执行前认证、执行成功及异常日志。
- [SysMenuSeedData](SeedData/SysMenuSeedData.cs) 提供菜单种子；启用时核对菜单路由与实际 ReZero 页面、接口入口。

接入时同时核对宿主引用、选项绑定、数据库连接映射、服务注册与管道调用。改动 API 前缀、数据库标识或 `AccessTokenKey` 时，检查界面与客户端的对应配置。

## 认证、数据与日志边界

- `OnExecutingAsync` 先执行 Bearer 认证，再校验请求头中的 JWT，成功后继续基类处理。修改时保留失败分支与调用顺序，不能因动态 API 而跳过认证。
- 当前 AOP 中的认证检查不能单独证明菜单按钮权限、租户隔离和 SQL 数据权限均已生效。动态 API 的数据库与查询配置需逐项核验，尤其不能假设它自动继承 Core 仓储的全局过滤器。
- `OnExecutedAsync` 与 `OnErrorAsync` 使用系统日志类别和 `ScopeContext` 记录请求、用户及结果。调整日志字段时保持成功、失败记录可关联，避免输出令牌、连接凭据或完整敏感参数。
- 变更动态 API、菜单种子或数据库初始化行为时，检查已有数据与重复初始化的影响，区分管理界面的访问权限和生成 API 的调用权限。

## 构建与验收

从 `Admin.NET/` 执行：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Plugins/Admin.NET.Plugin.ReZero/Admin.NET.Plugin.ReZero.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'ReZero 插件构建失败' }
```

现有 `Admin.NET.Test` 未直接引用本插件。新增自动化测试需接入被测项目，覆盖有效与无效令牌、基类调用和日志分支；Mock 只能证明对应拦截逻辑。

真实验收需在显式接入插件的 Web 宿主中，用隔离的 PostgreSQL 核对连接选择、动态查询结果、越权拒绝和日志；涉及管理界面时只验收桌面端。构建成功、菜单出现或 Mock 通过均不能单独记作真实集成通过。
