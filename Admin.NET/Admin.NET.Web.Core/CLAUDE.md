# Admin.NET.Web.Core

本文件补充[仓库规则](../../AGENTS.md)，适用于 Web 层的服务注册、请求管道、认证处理与序列化契约。

## 职责与入口

本项目将 Core 的基础设施与 Application 扩展组装到 ASP.NET Core 宿主中。直接项目引用为 `Admin.NET.Application`，经其依赖 Core；插件是否加载由实际引用与启动配置决定。当前目标框架为 `net8.0;net10.0`，以 [项目文件](Admin.NET.Web.Core.csproj) 为准。

- [Startup.cs](Startup.cs) 使用 `[AppStartup(int.MaxValue)]`，包含 `ConfigureServices` 和 `Configure`。
- [ProjectOptions.cs](ProjectOptions.cs) 的 `AddProjectOptions` 绑定项目选项及限流配置。
- [JwtHandler.cs](Handlers/JwtHandler.cs) 处理黑名单、令牌和按钮权限检查；改认证行为时同时核对 Core 的登录、退出及在线用户逻辑。
- 可执行宿主位于 [Web.Entry](../Admin.NET.Web.Entry/CLAUDE.md)，本项目没有独立启动入口。

## 组装与请求边界

修改 `Startup` 时查看相邻注册和中间件，不把文档中的简表当作完整调用顺序。

- `AddProjectOptions` 在缓存、SqlSugar 和认证注册之前。默认认证通过 `AddJwt<JwtHandler>(enableGlobalAuthorize: true)` 开启全局授权，并注册开放接口的 Signature 认证；新增公开入口须保留明确的授权设计。
- JWT 接收事件支持查询参数 `token`；`/hubs` 路径额外接受 SignalR 的 `access_token`。调整代理前缀或 Hub 路由时要检查这条认证路径，避免将 SignalR 参数约定误写成所有 API 的通用约定。
- 本地化在 `UseRouting` 之前，CORS 在路由与认证之间，随后为认证、授权和限流。转发头在前部处理，修改代理部署时同步核对客户端 IP、限流和访问日志。
- 私有上传文件的检查位于 ImageSharp 与静态文件之前；私有文件应经受认证的下载、预览 API 访问。不能通过调整静态文件或图片缓存顺序绕过可见性检查。
- 调度看板路径为 `/schedule`，登录复用现有认证服务。OpenAPI 由 `UseInject` 接入，Scalar 的 `/sapi` 映射受 `AppSettings:InjectSpecificationDocument` 控制；修改文档入口时以当前注册为准。
- `UseEndpoints` 映射 Hub 和 MVC 路由。新增路径或改变 `VirtualPath` 时需同步检查前端请求与反向代理。

## 序列化与可选基础设施

当前 MVC 使用 `AddJsonOptions` 配置 System.Text.Json，包含日期、长整数、枚举及 DataTable 等转换器；SignalR JSON 协议复用配置的序列化选项。不能因为 Core 中存在 Newtonsoft.Json 辅助类就声称 MVC 默认使用双序列化。

跨端契约需要保留日期格式、长整数转字符串策略和空值行为；调整转换器时核对 DTO 与客户端生成类型，而非只比较 C# 类型。

缓存选为 Redis 时，事件总线会替换为 `RedisEventSourceStorer`；RabbitMQ 的替换代码当前被注释。OSS、日志、验证码、调度和文件存储也在本层注册，配置项存在不等于外部服务已连接成功。

## 构建与验收

从 `Admin.NET/` 执行：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Admin.NET.Web.Core/Admin.NET.Web.Core.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'Web.Core 构建失败' }
```

管道改动需通过 Web.Entry 核验成功与拒绝路径：例如有效、过期或退出后的令牌，匿名与受保护接口，跨域预检，以及受影响的 Hub、文件或文档路由。序列化改动核对实际响应，不能仅凭编译通过判断兼容。

现有测试项目直接引用 Core；对本层的宿主行为需明确测试宿主与依赖准备情况。数据库集成采用隔离的真实 PostgreSQL，涉及界面的流程只验收桌面端，Mock 结论与真实联调结论分开记录。
