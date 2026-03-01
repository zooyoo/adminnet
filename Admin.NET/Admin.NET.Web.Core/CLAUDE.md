[根目录](../../../CLAUDE.md) > [Admin.NET](../../) > **Admin.NET.Web.Core**

# Admin.NET.Web.Core

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：Startup.cs 完整中间件管道、JWT 事件、事件总线 Redis/RabbitMQ 切换、限流、压缩、定时任务看板登录集成 |
| 2026-03-01 | 初始生成 |

---

## 模块职责

Web 宿主核心层，负责将所有基础设施和中间件组装到 ASP.NET Core 管道中。是整个应用的"配置中心"，不包含业务逻辑。

---

## 入口与启动

```csharp
// Startup.cs — 优先级 int.MaxValue（最后执行，确保所有依赖已注册）
[AppStartup(int.MaxValue)]
public class Startup : AppStartup
```

### ConfigureServices 注册顺序

| 顺序 | 注册项 | 说明 |
|------|--------|------|
| 1 | `AddProjectOptions()` | 项目级选项 |
| 2 | `AddCache()` | 缓存（Memory / Redis） |
| 3 | `AddSqlSugar()` | ORM |
| 4 | `AddJwt<JwtHandler>` | JWT + Signature 双认证；支持 URL `?token=` 参数传递 |
| 5 | `AddCorsAccessor()` | 跨域 |
| 6 | `AddHttpRemote()` | 远程 HTTP 请求 |
| 7 | `AddTaskQueue()` | 任务队列 |
| 8 | `AddSchedule()` | 定时任务（`DbJobPersistence` 持久化 + `JobMonitor` 监视器） |
| 9 | `AddSensitiveDetection()` | 敏感词检测 |
| 10 | `AddControllersWithViews()` | MVC + Newtonsoft.Json + System.Text.Json 双序列化 |
| 11 | `AddOAuth()` | 三方 OAuth 登录 |
| 12 | `AddElasticSearchClients()` | ElasticSearch |
| 13 | `Configure<ForwardedHeadersOptions>` | Nginx 转发头（清空 KnownNetworks/KnownProxies） |
| 14 | `AddInMemoryRateLimiting()` | 内存限流 |
| 15 | `AddEventBus()` | 事件总线（`RetryEventHandlerExecutor` + `EventHandlerMonitor`；Redis 队列可选） |
| 16 | `AddImageSharp()` | 图像处理 |
| 17 | `AddOSSService()` | OSS 对象存储（从 `OSSProvider` 配置读取 Provider） |
| 18 | 文件存储三件套 | `SysFileProviderService`、`OSSServiceManager`（单例）、`MultiOSSFileProvider` |
| 19 | `AddViewEngine()` | 模板引擎 |
| 20 | `AddSignalR()` | 即时通讯（KeepAlive 15s，超时 30s，最大包 10MB） |
| 21 | `AddLoggingSetup()` | 系统日志 |
| 22 | `AddCaptcha()` | 验证码 |
| 23 | `AddConsoleLogo()` | 控制台 Logo |
| 24 | `AddResponseCompression()` | Brotli + Gzip 压缩（HTTPS 启用） |
| 25 | `AddVirtualFileServer()` | 虚拟文件系统 |

### Configure 中间件管道顺序

```
UseResponseCompression
UseForwardedHeaders
UseDeveloperExceptionPage / UseExceptionHandler + UseHsts
[自定义响应头: Admin.NET]
UseImageSharp
UseStaticFiles（含二级目录 VirtualPath 支持）
UseOAuth
UseUnifyResultStatusCodes
UseAppLocalization          ← 必须在 UseRouting 之前
UseRouting
UseCorsAccessor             ← 必须在 UseRouting 和 UseAuthentication 之间
UseAuthentication
UseAuthorization
UseIpRateLimiting
UseClientRateLimiting
UsePolicyRateLimit
UseScheduleUI(/schedule)    ← 定时任务看板，集成 SysAuthService 登录
UseKnife4UI(/kapi)          ← Swagger UI
UseInject(string.Empty)     ← Furion Swagger
UseEndpoints
  ├── MapHubs()             ← SignalR
  └── MapControllerRoute()
```

### 关键配置细节

**JWT 事件**：`OnMessageReceived` 支持从 Query String `?token=xxx` 读取令牌（用于 WebSocket/SignalR 场景）。

**事件总线 Redis 切换**：
```csharp
// Cache.json 中 CacheType == "Redis" 时自动切换
options.ReplaceStorer(sp => new RedisEventSourceStorer(
    sp.GetRequiredService<ICacheProvider>(),
    "adminnet_eventsource_queue", 3000));
```

**定时任务看板登录**：复用 `SysAuthService.SwaggerSubmitUrl()`，临时禁用验证码后调用标准登录流程。

**IP 地址库**：`IpToolSettings.LoadInternationalDbToMemory = true`（内存换速度，+60~70MB）。

**JSON 序列化**：
- `long` 超过 17 位自动转 `string`（防 JS 精度溢出）
- 时间格式：`yyyy-MM-dd HH:mm:ss`
- 禁止 Unicode 转码（`JavaScriptEncoder.Create(UnicodeRanges.All)`）

---

## 对外接口

- `Handlers/JwtHandler.cs`：JWT 令牌验证处理器，实现 Token 黑名单校验、租户切换、用户状态验证
- `ProjectOptions.cs`：项目级选项注册扩展

---

## 关键依赖与配置

```xml
<PackageReference Include="IGeekFan.AspNetCore.Knife4jUI" Version="0.0.16" />
<PackageReference Include="System.Security.Cryptography.Pkcs" Version="10.0.0" />
```

项目引用：`Admin.NET.Application`（间接引用 Core 和插件）

---

## 相关文件清单

```
Admin.NET.Web.Core/
├── Handlers/JwtHandler.cs      # JWT 验证处理器
├── ProjectOptions.cs           # 选项注册
└── Startup.cs                  # 核心 DI 注册 + 中间件管道
```
