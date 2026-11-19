## 1. 总体方案

Admin.NET 后端（.NET 9/10）采用 **Furion** 框架作为宿主，其配置系统建立在 ASP.NET Core `IConfiguration` 之上，并通过 Furion 的 `AppStartup` + `IConfigurableOptions<T>` 机制将 JSON 文件映射为强类型选项对象。入口程序使用 `Serve.Run` 启动 WebApplication，并在自定义 `WebComponent` 中注册日志过滤、Kestrel 限制等运行时参数。

核心思路：
- 应用根目录下的 `appsettings.json` / `appsettings.Development.json` 仅声明 `ConfigurationScanDirectories`，告诉 Furion 去扫描某个目录（默认 `Configuration` 和当前目录）下所有 JSON 文件，按命名空间自动合并到 `IConfiguration`。
- 每个功能域在 `Admin.NET.Admin.NET.Application/Configuration/` 下提供一个同名 JSON（如 `APIJSON.json`、`Alipay.json`、`App.json`、`CDConfig.json`、`Captcha.json`、`CodeGen.json`、`ElasticSearch.json`、`Email.json`），键名与 Option 类的命名空间一致。
- Option 类位于 `Admin.NET.Admin.NET.Core/Option/`，实现 `IConfigurableOptions` 或泛型 `IConfigurableOptions<T>`，部分提供 `PostConfigure(options, configuration)` 用于默认值填充与后处理。

该模式是典型的 .NET Options Pattern + 框架级配置扫描，没有引入第三方配置库（如 Ardalis.Confidential.Configuration、YamlDotNet 等），也不依赖 `.env` 文件。

## 2. 关键文件

- 启动与主机配置：
  - `Admin.NET/Admin.NET.Web.Entry/Program.cs` — 调用 `Serve.Run(RunOptions.Default.AddWebComponent<WebComponent>())`；`WebComponent.Load` 中设置 Windows 事件日志过滤、日志级别过滤、Kestrel 超时与请求体大小限制。
  - `Admin.NET/Admin.NET.Web.Entry/appsettings.json` — 定义 `$schema` 指向 Furion schema，并声明 `ConfigurationScanDirectories: ["Configuration", ""]`。
  - `Admin.NET/Admin.NET.Web.Entry/appsettings.Development.json` — 开发环境覆盖，同样声明扫描目录。
  - `Admin.NET/Admin.NET.Application/Startup.cs` — `[AppStartup(100)]` 标记，继承 `AppStartup`，保留空的 `ConfigureServices` / `Configure` 供扩展点。

- 配置 JSON 文件（位于 `Admin.NET/Admin.NET.Application/Configuration/`）：
  - `App.json` — 应用全局设置：`Urls`、`AllowedHosts`、`AppSettings`、`DynamicApiControllerSettings`、`FriendlyExceptionSettings`、`StaticContentTypeMappings`、`LocalizationSettings`、`CorsAccessorSettings`、`JobSchedule`、`SnowId`、`Cryptogram`（含 SM2 公私钥、密码强度正则）。
  - `APIJSON.json` — APIJSON 角色权限表与列白名单。
  - `Alipay.json`、`Email.json`、`ElasticSearch.json`、`Captcha.json`、`CodeGen.json`、`CDConfig.json` 等——各子系统配置。

- 选项模型（位于 `Admin.NET/Admin.NET.Core/Option/`，示例）：
  - `DbConnectionOptions.cs` — `DbConnectionOptions : IConfigurableOptions<DbConnectionOptions>`，含 `EnableConsoleSql`、`SuperAdminIgnoreIDeletedFilter`、`List<DbConnectionConfig> ConnectionConfigs`；`PostConfigure` 将未设置的 `ConfigId` 回填为 `SqlSugarConst.MainConfigId`。
  - `CacheOptions.cs` — `CacheOptions : IConfigurableOptions<CacheOptions>`，含 `Prefix`、`CacheType`、`RedisOption Redis`；`PostConfigure` 对 `Prefix` 做空字符串归一化。
  - 其他选项类：`APIJSONOptions`、`AlipayOptions`、`WechatOptions`、`UploadOptions`、`OSSProviderOptions`、`ClusterOptions`、`CDConfigOptions`、`CodeGenOptions`、`CryptogramOptions` 等，均实现 `IConfigurableOptions` 或泛型版本。

- Docker 与部署配置：
  - `docker/docker-compose.yml` — 通过 volume `- ./app/Configuration/:/app/Configuration/` 将外部挂载的配置目录注入容器，命令为 `/bin/bash -c "/app/wait-for-it.sh mysql:3306 -t 120 && dotnet Admin.NET.Web.Entry.dll --content-root /app/wwwroot"`，说明运行时配置文件由部署侧以卷形式注入。
  - `docker/docker/mysql/mysql.cnf`、`docker/docker/redis/redis.conf`、`docker/docker/nginx/conf/nginx.conf` — 基础设施组件自身配置。

## 3. 架构与约定

### 3.1 配置加载链路

1. `Program.cs` → `Serve.Run(...)` 创建 `WebApplicationBuilder`。
2. Furion 读取 `appsettings.json` / `appsettings.{Environment}.json`。
3. 解析 `ConfigurationScanDirectories`，递归扫描指定目录下的所有 `.json` 文件。
4. 将每个 JSON 文件的顶层键名与 `IConfigurableOptions` 类型进行匹配，绑定到对应 Option 实例。
5. 调用各 Option 上的 `PostConfigure` 完成默认值、校验与派生字段计算。

### 3.2 分层组织

- **应用级配置**：`Admin.NET.Admin.NET.Application/Configuration/` 下的 JSON，描述业务能力开关、外部服务连接、路由策略、加密密钥等。
- **选项模型**：`Admin.NET.Admin.NET.Core/Option/` 下的 C# 类，定义配置的结构、类型、可选性与 `PostConfigure` 逻辑。
- **运行时覆盖**：`appsettings.json` 中的 `ConfigurationScanDirectories` 允许生产环境与开发环境切换扫描路径，配合 Docker 的 volume 挂载，使同一镜像在不同部署环境使用不同配置集。

### 3.3 设计决策

- 不使用环境变量直接注入业务配置，而是集中放在 JSON 文件中；环境变量仅用于基础设施（MySQL、Redis、MinIO、TDengine 等在 `docker-compose.yml` 的 `environment` 段）。这从 `docker-compose.yml` 的 `environment` 列表可得到印证。
- 敏感信息（如 `App.json` 中的 `Cryptogram.PublicKey/PrivateKey`、`Alipay.json` 中的支付密钥）以明文存储在源码仓库中，未见加密存储或 secrets manager 集成。
- 多数据库连接通过 `DbConnectionOptions.ConnectionConfigs` 数组承载，支持多租户隔离方式（`TenantTypeEnum.Id` 等）。
- 插件配置通过 `AppSettings.ExternalAssemblies: ["plugins"]` 声明，配合 `ConfigurationScanDirectories` 扫描插件目录。

## 4. 约定与约束

- **配置 JSON 必须声明 Furion schema**：现有所有 `*.json` 配置均以 `"$schema": "https://gitee.com/dotnetchina/Furion/raw/v4/schemas/v4/furion-schema.json"` 开头，便于 IDE 提示。
- **配置项命名与 Option 类型一致**：JSON 顶层键名需与 `IConfigurableOptions` 实现类的命名空间/类型名匹配，否则无法被自动绑定。
- **扫描目录必须在 appsettings 中显式声明**：`appsettings.json` 与 `appsettings.Development.json` 均显式写出 `ConfigurationScanDirectories: ["Configuration", ""]`；未在列表中出现的目录不会被扫描。
- **需要后处理的字段应实现 PostConfigure**：`DbConnectionOptions.PostConfigure` 与 `CacheOptions.PostConfigure` 展示了强制默认值的模式；新增 Option 时若存在必填/派生字段，应在 `PostConfigure` 中补齐。
- **Docker 部署时 Configuration 目录需以卷挂载**：`docker-compose.yml` 将宿主的 `./app/Configuration/` 映射到容器的 `/app/Configuration/`，运行时才获得实际配置；镜像内不包含业务配置 JSON。
- **CI/CD 构建时需排除 appsettings**：`CDConfig.example` 中 `ExcludeFiles` 包含 `"appsettings*.json"`，表明打包产物不应包含应用级配置，避免将开发配置误发布。
- **日志与 Kestrel 参数不通过配置 JSON**：`Program.cs` 的 `WebComponent.Load` 中硬编码了日志过滤规则与 Kestrel `KeepAliveTimeout`、`RequestHeadersTimeout`、`MaxRequestBodySize = null`，这些运行时行为不在 JSON 配置中暴露。

## 5. 适用范围

本配置系统主要适用于 `Admin.NET.Admin.NET.Application` 与 `Admin.NET.Admin.NET.Core` 后端模块；前端 `Web/` 目录（Vue/Vite/pnpm workspace）有独立的构建与运行时配置体系（`vite.config.ts`、`package.json`、`.npmrc` 等），不在本卡片范围内。