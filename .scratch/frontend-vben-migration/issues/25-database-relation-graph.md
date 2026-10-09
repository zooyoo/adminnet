# 25 数据库关系图与表查看

Status: ready-for-agent
Execution: completed
Blocked by: 24（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 25 项。用户要求使用 PostgreSQL，仅桌面验收。

## 验收

- [x] 从提案 24 的数据库 / 表选择入口进入关系图，连接和选中表上下文保持一致。
- [x] 后端关系与真实隔离 PostgreSQL 的表、字段和外键结构一致；不从实体导航或客户端猜测关系。
- [x] 复用原 `relation-graph` 引擎，支持节点拖动、缩放、居中 / 适配、节点与连线查看；选中表可定位且详情与结构查询一致。
- [x] 空数据库、无关系数据库和复杂关系可读；加载失败明确展示，旧图不会覆盖新连接或新请求。
- [x] 未授权账号和匿名调用真实拒绝；生产桌面页面可直达、刷新、明暗主题切换，画面非空且可交互。
- [x] PostgreSQL 隔离数据、截图、清理、相关测试、lint、类型、前后端构建通过。

## 验收证据

- 真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-9837a14daffe4a268e711b73390dd750/evidence/database-visual-browser-baseline.json`，`passed: true`、`cleanupPassed: true`。
- 真实报告覆盖 PostgreSQL 三表三外键关系、匿名 / 未授权拒绝、画布高度、节点拖动、连线详情、刷新、明暗主题、无外键、空数据库、停机失败和容器清理。
- 截图：同目录 `25-relation-graph-light.png`、`25-relation-graph-dark.png`，已实际复核节点、字段、连线、图例、工具栏和底部详情均可读。
- 生产契约报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-database-ui-mKa78h/database-contract-baseline.json`，9 项桌面契约通过。
- 工程验证：关系图 Vitest `9 / 9`、前端类型检查、ESLint、生产构建、后端 Core / Web API 构建均通过；`node --check` 通过。

## 设计边界

- 关系只来自所选数据库的真实外键元数据；没有外键的表不绘制虚构连线。
- 当前任务只验收 PostgreSQL；不为其他数据库添加未经验证的关系查询合同。
- 关系图页面作为隐藏的认证路由保留旧 `/develop/database/visual` 地址，入口由新的库表维护页面带入 `configId` 和 `tableName`。

## Comments

- 2026-10-10：提案 24 已提交，开始提案 25。旧页面使用 `relation-graph/vue3`，新应用尚未接入；后端旧接口只读取主库实体导航，不能直接满足隔离 PostgreSQL 的真实结构验收。
- 2026-10-10：完成提案 25。关系接口改为读取所选 PostgreSQL 的真实表、字段和 `pg_constraint` 外键元数据；Vben 页面保留旧地址并接入 `relation-graph 2.2.11`。为避免 `Spin` 包装器高度为零，关系图容器显式建立满高链；节点显式提供宽高和固定坐标。补充节点键盘选择、无关系 / 空数据库、三表三外键和停机失败验收，所有真实与契约证据通过。
