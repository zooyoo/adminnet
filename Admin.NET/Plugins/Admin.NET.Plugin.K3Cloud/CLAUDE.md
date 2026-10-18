# Admin.NET.Plugin.K3Cloud

本文件补充[仓库规则](../../../AGENTS.md)，适用于金蝶 K3Cloud 的 HTTP 集成。

## 职责与接入

本插件封装认证与业务单据的保存、提交、审核请求。[项目文件](Admin.NET.Plugin.K3Cloud.csproj) 引用 Core，目标框架为 `net8.0;net10.0`。它虽在 `Admin.NET.sln` 中，但当前 Web 入口的项目引用链未接入本插件；启用前需明确宿主引用、Furion 启动发现与配置来源。

- [Startup.cs](Startup.cs) 绑定 [K3CloudOptions](Option/K3CloudOptions.cs)，并注册名为 `K3Cloud` 的 HttpClient，基地址来自 `K3Cloud:Url`。
- [IK3CloudApi](Service/IK3CloudApi.cs) 使用 Furion `IHttpDeclarative` 与 `[HttpClientName("K3Cloud")]`，是出站 HTTP 代理，不是直接暴露给前端的 Controller。
- `Service/Dto/` 定义登录、表单请求与响应。`K3CloudBaeInput<T>` 是源码现有名称，引用时保持一致。

## 外部契约

`IK3CloudApi` 当前提供 `ValidateUser`、`Save<T>`、`Submit<T>`、`Audit<T>`，均以 POST 调用各自的 `.common.kdsvc` 地址。修改时以方法上的完整路由、Body 类型和回调签名为准，不从接口名称推测可用操作。

- 登录与单据请求的回调类型不同；修改代理或调用方时核对请求头、会话与 Cookie 的传递，不假设拿到 SessionId 后其他请求就已建立会话。
- HTTP 请求成功不等于金蝶业务成功。调用方需检查登录与业务响应中的状态和错误信息，区分认证失败、表单校验失败及传输失败。
- 保存、提交和审核具有不同业务副作用，不能统一无条件重试。需要重试时明确幂等依据与已执行状态，避免重复生成或推进单据。
- FormId、字段映射和具体操作支持范围由目标金蝶环境决定；不得用本插件的通用 DTO 推测不存在的接口契约。

## 构建与验收

从 `Admin.NET/` 执行插件构建：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Plugins/Admin.NET.Plugin.K3Cloud/Admin.NET.Plugin.K3Cloud.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'K3Cloud 插件构建失败' }
```

`Admin.NET.Test` 当前未直接引用本插件。新增自动化测试时需先接入被测项目，可用标准 HTTP Mock 验证路由、请求体、回调与错误映射；该结果不能记作金蝶联调通过。

真实联调需先将插件接入宿主，在独立金蝶测试环境验证认证、目标表单与失败响应，再按已授权的测试单据验证保存、提交或审核后的状态。验证记录应区分本地 Mock、真实 HTTP 往返和金蝶业务状态核验，不在文档或日志中记录凭据。
