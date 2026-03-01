[根目录](../../../../CLAUDE.md) > [Admin.NET](../../../) > [Plugins](../../) > **Admin.NET.Plugin.K3Cloud**

# Admin.NET.Plugin.K3Cloud

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：IK3CloudApi 完整接口方法（登录、保存、提交、审核） |
| 2026-03-01 | 初始生成 |

---

## 模块职责

金蝶 K3Cloud ERP 集成插件，提供：
- K3Cloud 用户认证（ValidateUser）
- 业务单据推送（保存/提交/审核）
- HTTP 代理接口封装（Furion 远程请求）

---

## 入口与启动

```csharp
public class Startup : AppStartup { }
```

配置选项：`Option/K3CloudOptions.cs`

---

## 对外接口

### IK3CloudApi

文件：`Service/IK3CloudApi.cs`

HTTP 客户端名称：`K3Cloud`（`[HttpClientName("K3Cloud")]`）

继承 `IHttpDeclarative`，所有方法均为 HTTP POST，路由为金蝶标准 kdsvc 路径。

| 方法 | 路由 | 说明 |
|------|------|------|
| `ValidateUser(K3CloudLoginInput)` | `AuthService.ValidateUser.common.kdsvc` | 验证用户，返回 `K3CloudLoginOutput`（含 SessionId） |
| `Save<T>(K3CloudBaeInput<T>)` | `DynamicFormService.Save.common.kdsvc` | 保存表单数据，返回推送结果 |
| `Submit<T>(K3CloudBaeInput<T>)` | `DynamicFormService.Submit.common.kdsvc` | 提交表单，返回推送结果 |
| `Audit<T>(K3CloudBaeInput<T>)` | `DynamicFormService.Audit.common.kdsvc` | 审核表单，返回推送结果 |

典型调用流程：
```
1. ValidateUser() — 获取 SessionId
2. Save<T>() — 保存单据草稿
3. Submit<T>() — 提交单据
4. Audit<T>() — 审核单据（可选）
```

---

## 数据模型

无独立实体，通过 HTTP 与 K3Cloud 交互。

DTO：
- `K3CloudLoginInput` — 登录请求（用户名、密码、数据中心 ID 等）
- `K3CloudLoginOutput` — 登录响应（SessionId、错误码）
- `K3CloudBaeInput<T>` — 通用表单请求基类（FormId、Data 泛型）
- `K3CloudPushResultOutput` — 推送结果（Result、MsgCode、Message）

---

## 相关文件清单

```
Admin.NET.Plugin.K3Cloud/
├── Option/K3CloudOptions.cs
├── Service/
│   ├── IK3CloudApi.cs              # HTTP 代理接口（登录、保存、提交、审核）
│   └── Dto/
│       ├── K3CloudLoginInput.cs
│       ├── K3CloudLoginOutput.cs
│       ├── K3CloudBaeInput.cs
│       └── K3CloudPushResultOutput.cs
├── GlobalUsings.cs
└── Startup.cs
```
