# Admin.NET.Application

本文件补充[仓库规则](../../AGENTS.md)，适用于应用扩展与配置层。

## 职责与依赖

这里是自定义业务服务、应用级实体、事件订阅和业务配置的落点。现有 [Admin.NET.Application.csproj](Admin.NET.Application.csproj) 直接引用 `Admin.NET.Core`，目标框架为 `net8.0;net10.0`。`Admin.NET.Web.Core` 再引用本项目，形成宿主的依赖链。

当前项目没有引用 `Admin.NET.Plugin.DingTalk`、`Admin.NET.Plugin.GoView` 或 `Plugins/` 下的其他工程。插件出现在解决方案中不代表会随 API 入口加载；启用时需明确引用关系、配置和启动注册。

## 入口与配置

- [Startup.cs](Startup.cs) 使用 `[AppStartup(100)]`，当前服务注册与管道方法为空，供应用扩展；Web 通用组装见 [Web.Core 规则](../Admin.NET.Web.Core/CLAUDE.md)。
- [DemoOpenApi.cs](OpenApi/DemoOpenApi.cs) 提供开放接口示例，不能据此将普通业务接口改为匿名访问。
- [SysUserEventSubscriber.cs](EventBus/SysUserEventSubscriber.cs) 是用户事件订阅入口；扩展时以实际订阅特性、事件类型和发布端为准。
- [TestViewSysUser.cs](Entity/TestViewSysUser.cs) 是现有视图实体示例。新实体继续按数据所有权选择 Core 中的基类与过滤接口。

`Configuration/` 和 `wwwroot/` 通过项目内容项复制到输出与发布目录。调整文件名、目录或配置节时同时核对复制规则及 [ProjectOptions](../Admin.NET.Web.Core/ProjectOptions.cs) 的绑定。

| 配置文件 | 核对内容 |
| --- | --- |
| `Configuration/App.json` | 监听地址、应用与加密相关配置节 |
| `Configuration/Database.json` | 数据源、租户连接、建表及种子初始化开关 |
| `Configuration/Cache.json`、`Configuration/JWT.json` | 缓存提供者与令牌契约 |
| `Configuration/Upload.json` | 上传约束及文件存储配置 |
| `Configuration/Swagger.json`、`Configuration/Limit.json`、`Configuration/Logging.json` | 文档、限流与日志配置 |

配置文件存在不等于对应集成已启用；以选项绑定和启动注册为准。例如，当前 Web 启动中的 RabbitMQ 事件存储注册被注释，不能仅凭 `EventBus.json` 声称已使用 RabbitMQ。部署配置还可能通过 `docker/app/Configuration/` 挂载替换，应检查实际生效来源。

## 扩展边界与验收

- 新业务服务沿用 Furion 动态 API、现有依赖注入和 DTO 组织方式，保持 Core 的租户、权限、事务及缓存约束；不要为应用功能让 Core 反向依赖本项目。
- 事件订阅需要考虑失败重试与重复投递，避免在缺少幂等保护时重复写入业务数据。
- 配置变更应验证选项绑定和缺省行为；涉及前后端共同使用的契约时同步核对消费端，不在说明中复制密钥或连接凭据。

以下构建命令从 `Admin.NET/` 执行：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Admin.NET.Application/Admin.NET.Application.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'Application 构建失败' }
```

现有 `Admin.NET.Test` 仅直接引用 Core，不能据此宣称本层事件、配置和开放接口已受测试覆盖。新增测试须明确接入被测代码；配置与 API 行为还需通过 Web 入口核验。涉及数据库时遵循仓库的真实 PostgreSQL 验收要求。
