# Elsa 3 人工审批、持久化恢复与 Admin.NET 接入边界

## 结论与取证范围

核验样本为 **Elsa 3.9.0**，不是项目版本决策。该版本于 **2026-10-04** 发布，源码提交 `6436609a1a3874d3fea7ccf690897792f5a1f702`；Admin.NET 对照基线为 `152f9d459da83290e178e73f6971a0db2be04179`。[E1]

- **人工等待与人工任务已有原生基础。** 3.9.0 首次发布 `Elsa.UserTasks` 及 EF Core、PostgreSQL 等持久化包，不能笼统说“Elsa 没有原生人工任务”。它支持候选人/组、认领、释放、分派、完成、取消、到期、任务事件、修订与恢复协调；这些不等于本项目七类审批业务语义。[E1][E2][E3]
- **恢复可靠性依赖具体配置。** 书签、实例、变量、任务投影、队列、锁各有机制；UserTasks 默认注册内存存储，EF 工作流提交事务也不是默认打开。使用 PostgreSQL 本身不能证明跨模块或跨业务库原子性。[E4][E5][E6]
- **源码声明覆盖 .NET 8/9/10，Admin.NET 集成仍待运行验证。** 当前入口是 .NET 10，Core/Application/Web.Core 同时面向 net8/net10；依赖图、Npgsql 与 SqlSugar 共存、真实 PostgreSQL 迁移/事务/并发均未验证。[E7][A1]
- **身份与租户必须明确适配。** Admin.NET 部分过滤、数据范围和审计依赖 HTTP 用户；后台恢复不能假定保留原请求的安全上下文。Elsa 默认 claim 名称也不同。[E8][A2][A3][A4]

已选方向为 Elsa 3、AntV X6 自研设计器、自研单据工作台方案 A，以及已有代码单据、工作台生成单据两个入口。请购只是拟建样本。精确版本、宿主、存储、动作语义和在途版本迁移规则仍待 HITL 决策，本文只给事实、候选边界与验证建议。

取证使用官方 release、固定提交源码、上游测试源码、Context7 官方文档索引和本仓源码。**未运行 Elsa、未执行 restore/build、未启动 PostgreSQL、未执行集成或故障恢复测试。** “源码已核实”不表示“运行验收通过”。滚动文档只用于发现概念，精确结论以固定提交为准。

## 证据矩阵

| 议题 | 已核实事实 | 边界与限制 | 证据 |
| --- | --- | --- | --- |
| 人工等待 | `UserTask.ExecuteAsync` 创建含任务物化信息的 bookmark，注册恢复回调；`ResumeAsync` 输出 `UserTaskResult(ActionKey, …)` 后完成活动 | 动作标签不会自动产生退回、撤回或会签业务语义 | [E2] |
| 人工任务 | Manager 提供 Query/Get/Claim/Release/Assign/Complete/Cancel/Timeout；表单、参与者目录、身份和访问策略有扩展接口 | 是否采用新模块尚未决定；默认目录不会读取 Admin.NET 组织 | [E3][E8] |
| 持久化 | `DefaultCommitStateHandler` 提交 bookmarks、日志、变量与实例，并在提交后处理缓冲通知；有 PostgreSQL provider | 必须配置持久 store；变量和活动状态须按实际配置验证，不能把任意本地对象当作可恢复状态 | [E4][E5][E9] |
| 提交事务 | Runtime 默认使用 `NoopWorkflowCommitTransaction`；EF 的 `UseWorkflowCommitTransaction` 默认 false，开启才注册基于 `TransactionScope` 的实现 | 须验证连接参与、provider 和平台支持；不能推导出包含 SqlSugar 或 UserTask 独立事务 | [E5][E6] |
| 重复与并发恢复 | `WorkflowResumer` 按过滤条件取分布式锁后查找书签；`DistributedWorkflowClient` 另有实例锁；UserTask 检查 ExpectedRevision、OperationId、请求 hash | 过滤条件锁不等于所有入口串行；多节点须实际配置跨节点锁，不能声明端到端 exactly-once | [E10][E11][E3] |
| 数据库竞争约束 | EF UserTask Revision 为并发令牌；tenant+materialization、tenant+bookmark、tenant+task+operation 有唯一索引；仓储有事务和并发异常处理 | 保护任务聚合和命令去重，不直接保护业务单据、外部通知或另一数据库副作用 | [E12] |
| 接受与最终完成 | 完成请求先保存 `Completing`/`Accepted` 再调用恢复；书签移除驱动投影终结。协调器补建投影、重试已接受操作或终结已移除书签 | API 接受不等于单据审批已完成；处理中、失败和结果查询需要契约，worker 必须覆盖实际租户 | [E3][E13] |
| 定义与实例版本 | 定义区分逻辑 DefinitionId、实体 Id、Version/Published/Latest；实例持有 DefinitionVersionId；客户端据此加载定义 | 发布新定义不会自动迁移旧实例；旧代码活动也须可执行。表单、单据、工作台版本不是 Elsa 自动统一管理 | [E14] |
| 身份与租户 | 默认 subject=`sub`、tenant=`tenant`；访问策略检查 tenant、permission、任务关系；worker 处理配置的租户集合，否则仅 DefaultTenantId | 要映射 Admin.NET claims、组织角色与权限，明确后台 actor；客户端 tenant 参数不能作为可信上下文 | [E8][E13][A2] |
| PostgreSQL | 有 Runtime/Management provider、专用 UserTasks PostgreSQL 迁移；上游一致性套件能用真实 PostgreSQL 连接串启用 | provider 存在不等于本仓兼容；未配置连接串时相关用例可跳过，SQLite 不能替代验收 | [E9][E15] |

书签默认 `AutoBurn=true`（`CreateBookmarkArgs`），但创建活动可覆盖该值；不能把所有书签都视作一次性。按已移除书签 ID 恢复时，`WorkflowResumer` 查询不到记录会返回空结果，这与业务请求的成功/重复/失效反馈仍需适配。[E10][E17]

这里的“信号”需区分：3.9.0 的 `Event` 活动通过 `WaitForEvent` 等待事件，`PublishEvent` 可以按 CorrelationId 或本实例限定范围；认证 API `/events/{eventName}/trigger` 接受实例/活动范围并要求事件触发权限。它是唤醒机制，不自动建立人工待办或执行单据审批授权。审批命令不能只凭事件名/CorrelationId 公开给前端直接触发。[E18][E19]

## 版本与 .NET / PostgreSQL 限制

本结论不外推至整个 Elsa 3。若选择 3.8.x 或其他版本，需重新核对 UserTasks 包、API、迁移、权限名与恢复实现。3.9.0 release 还记录书签队列租户、EF 租户隔离和变量持久化等修复，须对所选版本回归。[E1]

| 组件 | 固定源码声明 | 仍待验证 |
| --- | --- | --- |
| Elsa 公共 TFM | `src/Directory.Build.props`：net8.0、net9.0、net10.0 | 计划使用的 NuGet 包实际 assets、还原和运行 |
| Elsa net8/net9 依赖组 | EF Core 9.0.17；Npgsql EF provider 9.0.4 | 与本仓依赖图一起还原；面向 net8 不等于使用 EF Core 8 |
| Elsa net10 依赖组 | EF Core 10.0.9；Npgsql EF provider 10.0.2；中央文件另声明 Npgsql 10.0.3 | 最终传递依赖、降级告警、SqlSugar 共存；中央声明不等于每个包实际均加载该驱动 |
| Admin.NET | Entry/Test：net10；Core/Application/Web.Core：net8 + net10；SqlSugarCore 5.1.4.221 | 按每个接入项目/TFM 构建；现有 Test 只引用 Core，不能证明 Web 宿主集成 |
| PostgreSQL | 通用 provider 与 UserTasks 专用 provider/迁移存在 | 大版本、schema/权限/连接拓扑、迁移升级、事务参与和连接池行为 |

依据为 [E7][E9][A1]。没有选定 PostgreSQL 版本或拓扑，也没有修改依赖。

## 七类审批的责任边界

“应用需定义”包括组织规则、单据状态、审计和引擎协调，不意味着每项都要重新实现引擎。可以组合原生 UserTasks，也可以基于书签做受控自定义活动，取舍仍待决策。

| 能力 | 可用基础 | 不能直接推出的业务语义 |
| --- | --- | --- |
| 条件分支 | FlowDecision、表达式和 Flowchart 路由 | 条件 DSL、类型/空值、服务端发布校验、脚本权限、读取提交快照还是实时单据 |
| 会签 | 多个 UserTask 与并行/汇聚编排可作为候选 | 成员快照/动态解析、全员/比例/人数门槛、拒绝优先级、并发终结、剩余任务处置 |
| 或签 | 多候选人认领同一任务，或多个任务竞争汇聚 | “抢先认领一个任务”不同于“多人分别收到任务、任一同意即通过”；其余任务取消与审计仍需定义 |
| 退回 | ActionKey 输出供后续路由 | 上一节点/任意已办节点/发起人、重走范围、会签轮次、重提是否复用实例；完成活动不会自动倒退 |
| 撤回 | 任务 Cancel、工作流取消机制 | 发起人撤回时间窗、业务副作用补偿、当前任务处置、撤回后重提；取消任务不等于撤回单据 |
| 转办 | Assign 改变 assignee，含权限和排除人员检查 | 谁可转办、跨组织规则、原处理人权限/待办/审计、代理关系、与完成请求竞争 |
| 加签 | 应用编排新增人工任务/活动轮次 | 前加/后加/并行加签、会签分母、授权、原任务冻结/恢复和再加签；增加候选人不等于加签 |

`UserTask.ResumeAsync` 只返回结果并结束活动，写入 `Reject`、`Return` 标签不代表原生实现相关审批规则。[E2][E3][E16]

## 恢复一致性：四段链路

1. **单据提交 → 实例建立。** 两类入口均需受控业务关联。可评估 tenant、单据类型、业务主键、提交轮次、单据/表单版本、定义版本等关联字段；字段和存储尚未选定。CorrelationId 可用于关联，不能单独代替业务唯一提交约束和授权。
2. **实例停等 → 任务可见。** 物化信息在书签中，持久化通知构建任务投影；投影可能滞后，协调器修复缺失。查询与监控需允许这一窗口。[E2][E13]
3. **审批命令接受 → 工作流继续。** OperationId/hash 约束命令重放，ExpectedRevision 阻止旧版本操作，`Completing` 是过渡状态。提交后崩溃、恢复失败、书签已消费应各有可观察结果，不能仅凭 HTTP 成功设置业务终态。[E3][E12][E13]
4. **工作流继续 → 业务状态/外部副作用。** 书签消费、任务 CAS 不会自动让 SqlSugar 写入、消息或外部采购动作幂等。应用 outbox/inbox、业务操作键去重、对账重试是候选方案，本文不选定实现。

3.9.0 分布式运行时检查本地锁 provider；跨节点部署需能跨节点协调的锁。仍须验证实际注册、锁失效、连接故障和所有恢复入口。[E11]

EF `TransactionScope` 要核验多个 DbContext/连接的参与方式。未经实测不能声称 PostgreSQL 跨连接/跨库、SqlSugar + EF 原子提交。跨存储或未启用事务时，要明确可重试状态与对账，而不能隐藏不一致窗口。[E5][E6]

## Admin.NET 接入位置与身份边界

| 现有位置 | 已有事实 | 候选接入责任 |
| --- | --- | --- |
| `Admin.NET/Admin.NET.Web.Entry` | net10 入口，引用 Web.Core | 嵌入方案部署/启动、实际运行时镜像、健康检查与退出行为 |
| `Admin.NET/Admin.NET.Web.Core/Startup.cs` | SqlSugar、全局 JWT 与 Web 基础设施注册 | 认证方案/路由冲突、Elsa API 暴露范围、租户解析、中间件顺序；不能自动公开引擎管理端点 |
| `Admin.NET/Admin.NET.Application/Startup.cs` | AppStartup 扩展点，应用层引用 Core | 业务审批适配、两个入口的提交/动作校验；也可评估独立插件，但须显式引用/装配 |
| `Admin.NET/Admin.NET.Core/Service/User/UserManager.cs`、`Const/ClaimConst.cs` | 从 HTTP principal 读取 UserId/TenantId/OrgId，claim 同名 | 映射 Elsa subject/tenant/groups/permissions，查询真实用户、组织和角色关系 |
| `Admin.NET/Admin.NET.Core/SqlSugar/SqlSugarSetup.cs` | 审计依赖 App.User；取得非空 tenant claim 才添加 tenant filter | 后台读写建立显式 tenant、actor 和权限边界，校验业务对象租户 |
| `Admin.NET/Admin.NET.Core/SqlSugar/SqlSugarFilter.cs` | `SetDataScopeFilter` 无 userId 时返回 `DataScopeEnum.All` | 无 HttpContext 的 worker 不能视为天然最小权限，必须限定服务动作的数据访问 |
| `Admin.NET/Admin.NET.Test` | net10、xUnit v3、直接引用 Core | 后续补充 Application/Web 宿主真实集成验证，不能拿现有单元测试替代 |

依据见 [A1]–[A4]。需区分业务发起人/审批人 actor、后台 worker 执行身份、引擎 API 服务身份。业务 actor 用于审计与授权，不应保存/重放过期 JWT 来实现长期恢复。

Elsa tenant scope 与 Admin.NET claim/SqlSugar 过滤是两套机制，不会因同时使用而自动联通。HTTP、队列、定时器、重试和协调器都须进入正确 tenant；UserTasks 的 `WorkerTenantIds` 未设置时回退到 `DefaultTenantId`，不自动遍历 Admin.NET 所有租户。[E8][E13]

## 宿主候选与两类单据

| 候选 | 可保留的边界 | 验证与运行代价 |
| --- | --- | --- |
| 嵌入 Admin.NET | 共部署，适配层直接调用 Elsa；单据仍由 Admin.NET 管理 | TFM/依赖图、DI/路由/鉴权、队列与停机互相影响；同进程不自动共事务或共租户上下文 |
| 独立 Elsa 服务 | 引擎部署、依赖、扩缩容独立；Admin.NET 保留单据与业务授权 | 服务认证、tenant/actor 传播、发布契约、重试幂等、状态同步与可观测；远程接受和业务完成分离 |

是否共 PostgreSQL 实例、独立 schema 或独立库尚未决定；共数据库不自动等于同事务。

已有代码单据应由既有服务/实体处理授权和状态变更；工作台生成单据由未来工作台运行时做同等检查。二者可汇入统一审批适配契约，但 Elsa task data/form reference 不自动替代业务单据。表单版本和任务绑定何时冻结仍待定义；未提交原型和拟建请购不是现成运行能力。

X6 是前端编辑器，最终需要服务端把受支持的业务节点/动作转换为受控且可校验的 Elsa 定义。本文不规定画布映射格式，也不把通用活动目录等同于业务审批能力目录。

## 最小验证建议（全部待验证）

后续先固定候选版本、宿主、PostgreSQL 大版本/拓扑和最小动作语义。可用临时单据，不要求实现生产请购；验证选择不自动成为产品决策。

| 验证 | 最小操作 | 证明结果的观察量 |
| --- | --- | --- |
| TFM/依赖 | 固定包版本，对接入项目分别 net8/net10 restore/build，启动 net10 宿主 | 退出码、实际包图与警告、启动/路由/认证结果；一个 TFM 成功不替代另一个 |
| PostgreSQL 持久化 | 空隔离库迁移 Management/Runtime/UserTasks；创建等待任务，停进程再启动并完成 | 定义版本/实例/书签/任务跨进程保留，命中正确活动，终态一致；记录数据库核验结果 |
| 故障窗口 | 书签持久化后投影前、Accepted 后恢复前、恢复后终态投影前分别中止并重启 | 协调器补建/完成、过渡状态可查、无永久待办；明确需人工修复的情况 |
| 并发重放 | 双进程同时完成；同 OperationId 同内容/不同内容；旧 Revision；同实例不同书签竞争 | 成功/冲突明确、结果稳定、无额外任务/副作用，锁和 DB 约束实际生效 |
| 租户身份 | 两租户同业务键；非候选人/候选人/已分派人/权限失效；无 HttpContext worker | 拒绝越权、跨租户不可见、审计正确；覆盖队列与协调器租户集合 |
| 版本 | v1 停等，发布 v2 再恢复 v1；更改候选表单版本，模拟旧活动不可用 | v1 绑定符合规则；旧版本缺失明确失败，不静默按新含义执行 |
| 两类入口 | 各提交临时单据并重复提交，然后完成审批 | 每个提交轮次关联唯一，业务/实例/任务可对账 |
| 七类语义 | 按确认规则分别验证，含会签拒绝、或签竞争、退回重提、撤回竞争、转办旧人操作、加签分母变化 | 单据、活动轮次、任务集、审计四者一致；无语义定义不能判通过 |

上游入口 `test/unit/Elsa.UserTasks.Persistence.ConformanceTests` 要设置 `ELSA_USERTASKS_TEST_POSTGRES` 才启用 PostgreSQL 用例；README 要求可丢弃数据库，套件会迁移 schema，不能使用业务库。阅读上游测试不证明它们通过，也不能替代宿主、SqlSugar 和业务一致性验证。[E15]

## 仍待决策或验证

- 精确 Elsa 版本、原生 UserTasks 与自定义人工活动/任务服务的边界；3.9.0 新模块需评估成熟度。
- 宿主、PostgreSQL 版本/拓扑、各 store、队列、事务和锁配置。
- 七类动作的授权、时序、聚合、撤销/补偿、审计和处理中反馈。
- 定义、活动代码、表单、单据版本绑定与旧实例升级/保留。
- 组织/角色成员快照或实时解析，tenant 与后台上下文契约。
- 真实运行验证，尤其 PostgreSQL 多连接事务、两个 TFM、双实例竞争、故障恢复与两类单据一致性。

## 第一方证据索引

源码链接固定到被核验提交，release 固定到版本；源码路径在对应 checkout 核对。

[E1]: https://github.com/elsa-workflows/elsa-core/releases/tag/3.9.0
[E2]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Activities/UserTask.cs
[E3]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Services/DefaultUserTaskManager.cs
[E4]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Extensions/ServiceCollectionExtensions.cs
[E5]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Runtime/Services/DefaultCommitStateHandler.cs
[E6]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Persistence.EFCore/Modules/Runtime/WorkflowRuntimePersistenceFeature.cs
[E7]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/Directory.Packages.props
[E8]: https://github.com/elsa-workflows/elsa-core/tree/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Services
[E9]: https://github.com/elsa-workflows/elsa-core/tree/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Persistence.EFCore.PostgreSql
[E10]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Runtime/Services/WorkflowResumer.cs
[E11]: https://github.com/elsa-workflows/elsa-core/tree/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Runtime.Distributed/Services
[E12]: https://github.com/elsa-workflows/elsa-core/tree/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks.Persistence.EFCore
[E13]: https://github.com/elsa-workflows/elsa-core/tree/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks
[E14]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Runtime/Services/LocalWorkflowClient.cs
[E15]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/test/unit/Elsa.UserTasks.Persistence.ConformanceTests/README.md
[E16]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Core/Activities/Flowchart/Activities/FlowDecision.cs
[E17]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Core/Models/CreateBookmarkArgs.cs
[E18]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Runtime/Activities/Event.cs
[E19]: https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Api/Endpoints/Events/TriggerAuthenticated/Endpoint.cs
[A1]: https://github.com/zooyoo/adminnet/tree/152f9d459da83290e178e73f6971a0db2be04179/Admin.NET
[A2]: https://github.com/zooyoo/adminnet/blob/152f9d459da83290e178e73f6971a0db2be04179/Admin.NET/Admin.NET.Core/Service/User/UserManager.cs
[A3]: https://github.com/zooyoo/adminnet/blob/152f9d459da83290e178e73f6971a0db2be04179/Admin.NET/Admin.NET.Core/SqlSugar/SqlSugarSetup.cs
[A4]: https://github.com/zooyoo/adminnet/blob/152f9d459da83290e178e73f6971a0db2be04179/Admin.NET/Admin.NET.Core/SqlSugar/SqlSugarFilter.cs

补充精确入口：

- [目标框架](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/Directory.Build.props)、[UserTasks PostgreSQL 工程](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks.Persistence.EFCore.PostgreSql/Elsa.UserTasks.Persistence.EFCore.PostgreSql.csproj)。
- [EF 提交事务](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Persistence.EFCore/Modules/Runtime/EFCoreWorkflowCommitTransaction.cs)、[Runtime 默认注册](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Runtime/Features/WorkflowRuntimeFeature.cs)。
- [任务协调器](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Services/DefaultUserTaskReconciler.cs)、[任务投影](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Services/DefaultUserTaskProjectionService.cs)、[任务 worker](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/HostedServices/UserTaskWorkers.cs)。
- [任务身份配置](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Options/UserTasksOptions.cs)、[访问策略](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.UserTasks/Services/DefaultUserTaskAccessPolicy.cs)。
- [定义实体](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Management/Entities/WorkflowDefinition.cs)、[实例实体](https://github.com/elsa-workflows/elsa-core/blob/6436609a1a3874d3fea7ccf690897792f5a1f702/src/modules/Elsa.Workflows.Management/Entities/WorkflowInstance.cs)。
- Context7 使用 `/elsa-workflows/elsa-gitbook` 查阅人工等待、持久化与版本相关文档；对应[官方文档仓库](https://github.com/elsa-workflows/elsa-gitbook)为滚动文档，不能作为精确版本验收证据。
特定默认值和兼容范围均以本文固定版本为限，后续升级须重新验证。

## 本次验证记录

仅执行文档事实核对、固定提交源码路径核对、引用完整性和 Git 差异检查。上文全部运行实验仍待执行；研究完成不表示 Elsa 集成或业务审批验收完成。
