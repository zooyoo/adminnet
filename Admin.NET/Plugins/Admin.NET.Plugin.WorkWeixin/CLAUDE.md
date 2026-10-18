# Admin.NET.Plugin.WorkWeixin

本文件补充[仓库规则](../../../AGENTS.md)，适用于企业微信的出站 HTTP 集成。

## 职责与接入

[项目文件](Admin.NET.Plugin.WorkWeixin.csproj) 引用 Core，目标框架为 `net8.0;net10.0`。插件提供凭证获取、部门、标签与群聊会话的 HTTP 代理，没有独立持久化实体。当前 API 入口的项目引用链未接入本插件，启用前需确认宿主引用和 Furion 的代理发现。

[Startup.cs](Startup.cs) 当前只绑定 [WorkWeixinOptions](Option/WorkWeixinOptions.cs)，请求管道方法为空。新增代理不能仅以这里存在 `Startup` 为由认定已完成注册、配置或验收。

## 接口与调用方责任

| 入口 | 维护范围 |
| --- | --- |
| [IWorkWeixinAuthHttp](Proxy/Auth/IWorkWeixinAuthHttp.cs) | `GetToken` 请求与认证响应 |
| [IDepartmentHttp](Proxy/Department/IDepartmentHttp.cs) | 部门创建、更新、删除、列表与详情 |
| [ITagHttp](Proxy/Tag/ITagHttp.cs) | 标签及标签成员操作 |
| [IWorkWeixinAppChatHttp](Proxy/AppChat/IWorkWeixinAppChatHttp.cs) | 群聊创建、更新、查询与消息发送 |
| [BaseHttpOutput.cs](Utils/BaseHttpOutput.cs) | 公共响应类型 `BaseWorkOutput`、`BaseWorkIdOutput` |

这些接口继承 `IHttpDeclarative`，不是本地 Controller。HTTP 方法、完整路由、Query 参数名和 Body 序列化以具体声明为准；目录名不一定等于命名空间，引用类型时核对声明。

- `GetToken` 当前声明为 `POST`，凭据通过 Query 参数发送。这是现有实现事实，不能据此保证符合目标企业微信接口要求；调整或接入时需核验官方契约和实际响应。
- `CorpId`、`CorpSecret` 来自选项，业务调用需提供 `accessToken`。代理本身不实现集中缓存、刷新和并发协调；调用方按认证响应中的有效期管理 Token，不把固定秒数写成永久约定。
- HTTP 成功不等于业务成功，需检查 `ErrCode`、`ErrMsg` 和业务结果。保持 Newtonsoft.Json 与 System.Text.Json 的字段名映射一致。
- 部门、标签、群聊及消息操作有外部副作用，重试需结合错误码和业务幂等性。日志不得输出凭据、Token 或带认证参数的完整 URL。

## 构建与验收

从 `Admin.NET/` 执行：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Plugins/Admin.NET.Plugin.WorkWeixin/Admin.NET.Plugin.WorkWeixin.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'WorkWeixin 插件构建失败' }
```

`Admin.NET.Test` 当前未直接引用本插件。新增自动化测试时先接入被测项目，用标准 HTTP Mock 验证路由、参数、序列化与错误响应；Mock 通过不能记作企业微信联调通过。

真实验收需在已接入插件的宿主和独立企业微信测试应用中核验 Token 获取、目标操作及失败响应。创建、删除、更新和消息发送仅使用明确的测试部门、标签或群聊，记录实际业务状态，避免重复发送消息。
