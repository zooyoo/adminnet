[根目录](../../../../CLAUDE.md) > [Admin.NET](../../../) > [Plugins](../../) > **Admin.NET.Plugin.ApprovalFlow**

# Admin.NET.Plugin.ApprovalFlow

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫 ApprovalFlowService.cs，补充接口详情、流程结构、编码规则 |
| 2026-03-01 | 初始生成 |

---

## 模块职责

审批流插件，提供轻量级工作流引擎能力：
- 审批流程定义（节点、条件、分支，以 JSON 存储）
- 审批表单定义（表单字段、路由，以 JSON 存储）
- 审批记录追踪
- 与系统用户/机构集成

---

## 入口与启动

```csharp
// Startup.cs — 插件启动类
public class Startup : AppStartup { }
```

中间件：`Middleware/ApprovalFlowMiddleware.cs`

---

## 对外接口

### ApprovalFlowService

文件：`Service/ApprovalFlow/ApprovalFlowService.cs`

API 分组：`ApprovalFlowConst.GroupName`，Order = 100

依赖：`SqlSugarRepository<ApprovalFlow>`

| 方法 | HTTP | 说明 |
|------|------|------|
| `Page(ApprovalFlowInput)` | POST | 分页查询审批流，支持关键字/编码/名称/备注过滤 |
| `Add(AddApprovalFlowInput)` | POST | 新增审批流，编码为空时自动生成（日期+序号格式） |
| `Update(UpdateApprovalFlowInput)` | POST | 更新审批流（忽略空列） |
| `Delete(DeleteApprovalFlowInput)` | POST | 假删除（`FakeDeleteAsync`） |
| `GetDetail(QueryByIdApprovalFlowInput)` | GET | 按 ID 获取审批流详情 |
| `GetInfo(code)` | GET | 按编码获取审批流信息 |
| `GetList(ApprovalFlowInput)` | GET | 获取全部审批流列表 |
| `FlowList(code)` | GET | 获取审批流结构（反序列化 `FlowJson` + `FormJson`） |
| `FormRoutes()` | GET | 获取所有审批流的表单路由列表 |

### SysApprovalService

文件：`Service/SysApproval/`

| 服务 | 说明 |
|------|------|
| `SysApprovalService` | 审批操作（同意/拒绝/撤回/查询） |

---

## 流程数据结构

审批流定义以 JSON 字符串存储在 `ApprovalFlow.FlowJson` 和 `ApprovalFlow.FormJson` 字段中：

```csharp
// FlowJson 反序列化为
ApprovalFlowItem  // 流程节点结构（节点、条件、分支）

// FormJson 反序列化为
ApprovalFormItem  // 表单结构（字段定义、路由）
ApprovalFormItem.Route  // 表单对应的前端路由路径
```

编码自动生成规则（`LastCode` 方法）：
```
{prefix}{yyMMdd}{当天序号:d2}
// 例：20260301 当天第1条 → "260301 01"
```

---

## 数据模型

| 实体 | 说明 |
|------|------|
| `ApprovalFlow` | 流程定义（Code、Name、FlowJson、FormJson、Remark） |
| `ApprovalFlowRecord` | 流程实例记录 |
| `ApprovalForm` | 审批表单定义 |
| `ApprovalFormRecord` | 表单填写记录 |

枚举：`FlowTypeEnum`（流程类型）

---

## 测试与质量

- 缺口：无独立测试文件，依赖 Core 层测试基础设施
- 建议补充：流程创建/审批/撤回的集成测试

---

## 常见问题 (FAQ)

**Q: 如何新增一个审批流程？**
调用 `POST /approvalFlow/add`，`FlowJson` 和 `FormJson` 传入对应的 JSON 结构字符串。

**Q: 如何获取某个流程的节点结构？**
调用 `GET /approvalFlow/flowList?code={code}`，返回反序列化后的 `FlowJson` 和 `FormJson` 对象。

**Q: 编码如何自动生成？**
新增时不传 `Code` 字段，系统自动生成 `yyMMdd + 当天序号` 格式的编码。

---

## 相关文件清单

```
Admin.NET.Plugin.ApprovalFlow/
├── Const/ApprovalFlowConst.cs          # 常量（API 分组名等）
├── Entity/                             # 4 个实体（ApprovalFlow、Record、Form、FormRecord）
├── Enum/FlowTypeEnum.cs                # 流程类型枚举
├── Middleware/ApprovalFlowMiddleware.cs # 中间件
├── SeedData/SysMenuSeedData.cs         # 菜单种子数据
├── Service/
│   ├── ApprovalFlow/
│   │   └── ApprovalFlowService.cs      # 流程定义 CRUD + 结构查询
│   └── SysApproval/                    # 审批操作服务
├── GlobalUsings.cs
└── Startup.cs
```
