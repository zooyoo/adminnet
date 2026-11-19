## 1. 使用的框架与整体方案

- **框架**：基于 Furion 扩展（`AddConsoleFormatter`、`AddFileLogging`、`AddDatabaseLogging<T>`、`AddMonitorLogging`）以及 Microsoft.Extensions.Logging；Elasticsearch 客户端使用 `Elastic.Clients.Elasticsearch`。
- **架构模式**：通过 `LoggingSetup.AddLoggingSetup(IServiceCollection)` 集中注册所有日志 Sink；业务代码统一通过 `ILogger` 或 Furion 的 `LoggingMonitorDto` 上下文进行结构化记录，再由管道按 `LogName == CommonConst.SysLogCategoryName` 分流到文件/数据库/Elasticsearch。
- **核心决策**：控制台输出可关闭；文件日志按级别拆分（Information/Warning/Error 三个独立文件）；ES 与数据库写入仅接收框架监控日志（过滤 `LogName`），并依赖配置开关控制各 Sink 启用状态。

## 2. 关键文件与包

| 路径 | 作用 |
|---|---|
| `Admin.NET/Admin.NET.Core/Logging/LoggingSetup.cs` | 日志基础设施注册中心（控制台、文件、数据库、Elasticsearch、监控监听） |
| `Admin.NET/Admin.NET.Core/Logging/DatabaseLoggingWriter.cs` | 将结构化日志持久化到 SQL Server（操作/异常/访问三类表） |
| `Admin.NET/Admin.NET.Core/Logging/ElasticSearchLoggingWriter.cs` | 将操作日志批量索引到 Elasticsearch |
| `Admin.NET/Admin.NET.Core/Logging/ExceptionSanitizer.cs` | 将 `Exception` 投影为可安全序列化的快照，避免 STJ 序列化失败 |
| `Admin.NET/Admin.NET.Core/Logging/LogDataSanitizer.cs` | 对持久化日志中的敏感字段做 JSON 树级脱敏与 Bearer Token 正则替换 |
| `Admin.NET/Admin.NET.Core/Logging/LoggingMonitorDto.cs` | 框架监控数据的结构化 DTO（HTTP 方法、URL、参数、耗时、TraceId、用户声明等） |
| `Admin.NET/Admin.NET.Web.Entry/Program.cs` | 入口层设置全局日志过滤（丢弃 `Microsoft.Hosting`/`Microsoft.AspNetCore`，最低 `Information`），并在 Windows 非服务模式下禁用事件日志 Provider |

## 3. 架构与约定

### 3.1 启动与注册
- 应用启动由 `WebComponent.Load` 调用 Furion 组件机制；`LoggingSetup.AddLoggingSetup` 在 `IServiceCollection` 上注册所有 Sink。
- 控制台输出通过 `App.GetConfig<bool>("Logging:Monitor:ConsoleLog", true)` 控制；文件输出通过 `Logging:File:Enabled`；Elasticsearch 通过 `Logging:ElasticSearch:Enabled`；数据库通过 `Logging:Database:Enabled`。
- 控制台格式化器支持自定义日期格式 `yyyy-MM-dd HH:mm:ss(zzz) dddd` 和 `WriteFilter`。

### 3.2 结构化日志字段
- 框架侧通过 `LoggingMonitorDto` 收集 HTTP 请求上下文（`HttpMethod`、`RequestUrl`、`RemoteIPv4`、`UserAgent`、`AuthorizationClaims`、`TimeOperationElapsedMilliseconds`、`TraceId`、`ThreadId`、`RequestId` 等）。
- 写入 ES 时，`ElasticSearchLoggingWriter` 从 `logMsg.Context["loggingMonitor"]` 反序列化为 `LoggingMonitorDto`，再映射为 `SysLogOp` 实体（含 IP 地理坐标、浏览器/OS、租户ID、用户账号等）后批量 `IndexManyAsync`。
- 写入数据库时，`DatabaseLoggingWriter` 根据 `ActionName` 是否为 `login/loginPhone/logout` 判定为访问日志（`SysLogVis`），有异常则为异常日志（`SysLogEx`），其余为操作日志（`SysLogOp`），分别并行插入三张表。

### 3.3 数据脱敏与安全
- `LogExceptionHandler` 当前已全量注释掉，未作为全局异常处理器生效（仅保留参考实现）。
- `ExceptionSanitizer.Snapshot` 把 `Exception` 投影为 `{type, message, source, stackTrace, innerException}` 匿名对象，递归处理内层异常；`ToJson` 在序列化失败时回退到 `ToString()`，保证“日志宁脏不丢”。
- `LogDataSanitizer` 维护敏感键集合（`password`, `accessToken`, `refreshToken`, `token`, `apiKey`, `secretKey`, `clientSecret`, `authorization`, `cookie`, `connectionString`, `accessKey`, `sign` 等），对 JSON 文本进行递归节点扫描，并对 URL 查询串与 `Bearer <token>` 做正则替换为 `[redacted]`。同时清空 `SysLogDiff` 的 `Sql` 与 `Parameters` 字段，防止历史明文凭据泄露。

### 3.4 级别与过滤策略
- 入口层（`Program.cs`）：丢弃以 `Microsoft.Hosting`、`Microsoft.AspNetCore` 开头的 category，且仅允许 `LogLevel.Information` 及以上。
- 文件 Sink：对每个级别单独注册一个 `AddFileLogging`，`FileNameRule` 按日期命名，`HandleWriteError` 失败时回滚到 `-oops` 后缀文件。
- ES / 数据库 Sink：通过 `WriteFilter = log => log.LogName == CommonConst.SysLogCategoryName` 只接收框架监控日志；ES 额外受 `ConfigConst.SysOpLog` 配置开关控制。

### 3.5 追踪与链路
- 所有 Sink 均开启 `WithTraceId = true`，并通过 `LoggingMonitorDto.TraceId` / `LogMessage.TraceId` 贯穿上下文，用于分布式链路追踪。

## 4. 约定与约束

- **Sink 启停**：控制台、文件、数据库、Elasticsearch 四类输出均由对应 `Logging:*` 配置项控制，未显式开启的 Sink 不会注册。
- **分类规则**：只有 `LogName == CommonConst.SysLogCategoryName` 的日志才会进入数据库与 ES；其他 `ILogger` 调用仅走控制台/文件。
- **操作日志开关**：ES 与数据库写入器内部都读取 `ConfigConst.SysOpLog` 配置决定是否实际持久化操作日志。
- **敏感字段脱敏**：所有持久化到数据库/ES 的 `Message`、`Exception`、`RequestParam`、`ReturnResult`、`RequestUrl` 等字符串字段必须经过 `LogDataSanitizer.Sanitize`；`SysLogDiff` 的 `Sql`、`Parameters` 会被置空。
- **Windows 事件日志**：当运行在 Windows 且不是 Windows Service 时，入口代码显式过滤掉 `EventLogLoggerProvider`，避免普通用户权限导致写入失败。
- **异常日志邮件通知**：数据库写入器收集写库过程中抛出的异常，若 `Logging:NotifyErrorMail` 为真则通过 `IEventPublisher.PublishAsync(CommonConst.SendErrorMail, exceptions)` 触发邮件告警。
- **日志监控属性忽略**：`AddMonitorLogging` 中配置的 `IgnorePropertyNames` 排除 `Byte`、`Password`、`AccessToken`、`RefreshToken`、`ApiKey`、`SecretKey` 等字段；`IgnorePropertyTypes` 排除 `byte[]`，防止二进制/密钥数据落入监控日志。