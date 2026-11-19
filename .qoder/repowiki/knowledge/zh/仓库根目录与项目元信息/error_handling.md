## 1. 采用的系统与框架

后端基于 **Furion**（ASP.NET Core 扩展框架），通过 `AddInjectWithUnifyResult<AdminResultProvider>()` 启用统一响应封装；全局异常由 ASP.NET Core 的 `UseExceptionHandler("/Home/Error")` 兜底。业务层不直接抛 `Exception`，而是通过 `Oops.Oh(...)` 抛出携带错误码的语义化异常；前端通过 `requestClient.post/get(..., { silentError: true })` 抑制默认弹窗，自行消费 `response.data.result`。

## 2. 关键文件与包

- 错误码定义：`Admin.NET/Admin.NET.Core/Enum/ErrorCodeEnum.cs`（带 `[ErrorCodeType]`、`[ErrorCodeItemMetadata]` 的属性枚举）
- 业务异常入口：`Oops.Oh(...)`（在 Service / Utils / SqlSugarRepository 等处被大量调用）
- 全局异常中间件：`Admin.NET/Admin.NET.Web.Core/Startup.cs`（`UseDeveloperExceptionPage` / `UseExceptionHandler("/Home/Error")`）
- 日志脱敏与异常快照：`Admin.NET/Admin.NET.Core/Logging/ExceptionSanitizer.cs`、`LogDataSanitizer.cs`、`LoggingSetup.cs`
- 事件总线未处理异常：`Startup.cs` 中 `options.UnobservedTaskExceptionHandler` 回调
- 常量中的错误相关键：`Const/CommonConst.cs`（`SendErrorMail`）、`Const/ConfigConst.cs`（`SysErrorMail`）、`Const/CacheConst.cs`（`KeyPasswordErrorTimes`）
- 前端 API 模板：`Web/apps/web-antdv-next/src/api/**/*.ts` 与 `Web.Entry/wwwroot/template/api.ts.vm`（统一使用 `silentError: true`）

## 3. 架构与约定

### 3.1 后端：ErrorCodeEnum + Oops.Oh

- 所有可面向用户的业务错误以 `ErrorCodeEnum` 中的条目表达，每个成员附带 `[ErrorCodeItemMetadata("中文描述")]`，如 `D1000`（账号或密码不正确）、`D1016`（没有权限）等。
- 业务代码通过 `throw Oops.Oh(ErrorCodeEnum.Dxxxx)` 或 `throw Oops.Oh("文本消息")` 中断流程，而不是抛裸 `Exception`。Service 层（如 `SysAuthService`、`SysUserService`、`SysDictTypeService`、`SysDatabaseService`、`SqlSugarRepository`、`CommonUtil` 等）广泛采用这一模式。
- 部分内部校验仍直接抛 `ArgumentException` / `ArgumentNullException` / `ArgumentOutOfRangeException`（如 `CommonValidationAttribute`、`DataMaskAttribute`、`ElasticSearchClientFactory`），这类属于参数校验类异常，不属于业务错误码体系。
- APIJSON 子系统（`SelectTable.cs`、`IdentityService.cs`）仍直接 `throw new Exception(...)`，是历史遗留路径，尚未迁移到 `Oops.Oh`。

### 3.2 统一响应与全局异常

- Startup 注册 `.AddInjectWithUnifyResult<AdminResultProvider>()`，使 Controller 返回值统一为 `{ code, message, result }` 结构；前端模板生成的 SDK 始终访问 `.data.result`。
- 非开发环境通过 `app.UseExceptionHandler("/Home/Error")` 将未捕获异常重定向至 `/Home/Error`；开发环境走 `UseDeveloperExceptionPage`。
- 自定义全局异常处理器 `LogExceptionHandler`（位于 `Admin.NET.Core/Logging/LogExceptionHandler.cs`）当前被注释掉，实际日志落库由 `LoggingSetup` + `ExceptionSanitizer` 承担。

### 3.3 日志与敏感信息脱敏

- `ExceptionSanitizer` 把 `Exception` 投影为可安全序列化的快照（type/message/source/stackTrace/innerException 递归），避免反射成员导致序列化失败。
- `LogDataSanitizer` 维护一组敏感字段名集合，对持久化日志和返回给前端的日志数据进行脱敏。
- 事件总线配置了 `UnobservedTaskExceptionHandler`，将所有未观察到的异步异常记录到 `Log.Error`。

### 3.4 前端错误处理

- 所有生成的 API 调用都传入 `{ signal, silentError: true }`，关闭默认的 Axios 错误提示，由页面级 try/catch 或组件状态自行展示错误。
- 模板 `api.ts.vm` 对导出/导入等二进制接口额外设置 `responseType: 'arraybuffer'`，并对非 ArrayBuffer 响应 `throw new Error('文件响应格式无效')`。
- 业务侧还常见显式校验，如 `codegen-preview.vue` 中对下载 URL 的正则校验失败后抛 `new Error('生成文件下载地址无效')`。

## 4. 约定与约束（描述性）

- 业务层应通过 `Oops.Oh(ErrorCodeEnum.xxx)` 表达用户可见错误；纯参数校验可使用标准 `ArgumentException` / `ArgumentNullException`。
- 新增业务错误需先在 `ErrorCodeEnum` 中添加枚举项并附 `[ErrorCodeItemMetadata]` 描述，再在调用处引用，而非散落的字符串字面量——这是 ErrorCodeEnum 上 `[ErrorCodeType]` 标记所表达的契约。
- API 返回体统一遵循 `AdminResultProvider` 约定的 `{ code, message, result }` 结构，前端一律从 `.data.result` 取值。
- 生产环境的未捕获异常统一经 `UseExceptionHandler("/Home/Error")` 处理，不在 Controller 内自行 catch 后返回错误对象（业务错误应通过 `Oops.Oh` 抛出）。
- 日志写入前必须经过 `ExceptionSanitizer` / `LogDataSanitizer`，防止异常对象或敏感字段破坏日志管道。
- 事件总线的异步异常必须通过 `UnobservedTaskExceptionHandler` 捕获并记录，不能任其静默丢失。
- 前端 API 调用模板强制使用 `silentError: true`，页面如需提示应由自身逻辑触发，禁止依赖 Axios 默认弹窗。

## 5. 已知不一致点

- APIJSON 子系统（`SelectTable.cs`、`IdentityService.cs`、`SysCacheService.cs`）仍直接 `throw new Exception(...)`，未接入 `ErrorCodeEnum` 与 `Oops.Oh`，是本次扫描中发现的例外路径。
- `LogExceptionHandler` 实现已存在但被注释，说明全局异常处理器曾计划接管但未启用，当前依赖 Furion 注入的 `AdminResultProvider` 与 ASP.NET Core 内置异常中间件共同兜底。
- 常量文件中多处出现 `*Error*` 命名（`SysErrorMail`、`SendErrorMail`、`KeyPasswordErrorTimes`），它们属于错误相关的配置/缓存键，并非错误类型本身。