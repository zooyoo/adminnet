[根目录](../../../../CLAUDE.md) > [Admin.NET](../../../) > [Plugins](../../) > **Admin.NET.Plugin.DingTalk**

# Admin.NET.Plugin.DingTalk

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：DingTalkService 完整接口方法、IDingTalkApi 代理接口、工作流日志同步逻辑 |
| 2026-03-01 | 初始生成 |

---

## 模块职责

钉钉集成插件，提供：
- 钉钉组织架构（部门/用户/角色）同步到系统
- 钉钉工作流（OA 审批流程）集成
- 钉钉消息推送（互动卡片、消息卡片）
- 定时同步 Job

---

## 入口与启动

```csharp
public class Startup : AppStartup { }
```

配置选项：`Option/DingTalkOptions.cs`（`ClientId`、`ClientSecret`）

---

## 对外接口

### DingTalkService

文件：`Service/DingTalkService.cs`

注册方式：`IScoped`（每次请求新实例）

依赖注入：`IDingTalkApi`、`DingTalkOptions`、`SqlSugarRepository<DingTalkWokerflowLog>`

| 方法 | 说明 |
|------|------|
| `GetDingTalkToken()` | 获取企业内部应用 access_token（使用配置的 ClientId/ClientSecret） |
| `GetDingTalkCurrentEmployeesList(access_token, input)` | 获取在职员工列表（分页） |
| `GetDingTalkCurrentEmployeesRosterList(access_token, input)` | 获取员工花名册字段信息 |
| `DingTalkSendInteractiveCards(token, input)` | 给指定用户发送互动卡片（已标记 `[Obsolete]`） |
| `DingTalkCreateAndDeliver(token, input)` | 创建并投放消息卡片（推荐使用） |
| `DingTalkWorkflowProcessInstances(token, input)` | 发起 OA 审批实例 |
| `DingTalkWorkflowProcessInstances(token, instanceId)` | 查询审批实例状态，并同步更新本地 `DingTalkWokerflowLog` 记录 |

工作流日志同步逻辑：查询审批实例时，若本地存在 `Status=RUNNING` 的记录且状态发生变化，自动更新 `Status`、`WorkflowId`、`Result`、`taskId`。

### IDingTalkApi

文件：`Service/IDingTalkApi.cs`

HTTP 代理接口（Furion 远程请求），封装钉钉 OpenAPI：
- `GetDingTalkToken` — 获取 Token
- `GetDingTalkCurrentEmployeesList` — 在职员工列表
- `GetDingTalkCurrentEmployeesRosterList` — 花名册字段
- `DingTalkSendInteractiveCards` — 发送互动卡片（旧）
- `DingTalkCreateAndDeliver` — 创建并投放卡片（新）
- `DingTalkWorkflowProcessInstances` — 发起审批
- `GetProcessInstances` — 查询审批实例
- 部门相关：`GetDingTalkDept`
- 角色相关：`GetDingTalkCurrentRoleList`、`GetDingTalkCurrentRoleSimplelist`

---

## 定时 Job

| Job | 说明 |
|-----|------|
| `SyncDingTalkDeptJob` | 同步钉钉部门到本地 |
| `SyncDingTalkRoleJob` | 同步钉钉角色到本地 |
| `SyncDingTalkUserJob` | 同步钉钉用户到本地 |
| `SyncWokerflowLogJob` | 同步工作流日志状态 |

---

## 数据模型

| 实体 | 说明 |
|------|------|
| `DingTalkDept` | 钉钉部门 |
| `DingTalkUser` | 钉钉用户 |
| `DingTalkRoleUser` | 角色用户关联 |
| `DingTalkWokerflowConfig` | 工作流配置 |
| `DingTalkWokerflowLog` | 工作流日志（instanceId、Status、Result、taskId） |

---

## 相关文件清单

```
Admin.NET.Plugin.DingTalk/
├── Const/DingTalkConst.cs
├── Entity/                     # 5 个实体
├── Enum/DingTalkConversationTypeEnum.cs
├── Job/                        # 4 个同步 Job
├── Option/DingTalkOptions.cs
├── Service/DingTalkService.cs  # 主服务（Token、员工、工作流、消息卡片）
├── Service/IDingTalkApi.cs     # HTTP 代理接口
├── Service/Dto/                # 请求/响应 DTO（25 个文件）
├── GlobalUsings.cs
└── Startup.cs
```
