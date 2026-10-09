# 24 数据库表与字段维护

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 24 项。用户要求使用 PostgreSQL，仅桌面验收。

## 验收

- [x] 可复用连接与表选择，表名和描述可搜索，连接切换清除旧目标，迟到请求不污染当前选择。
- [x] 建表、改表、字段增加、编辑、删除保留原合同；类型、主键、自增、长度、小数位、默认值与备注可反查。
- [x] 原有顺序调整及数据库能力边界核验；建表按用户填写顺序创建字段。原有服务仅对 MySQL 提供物理列重排，PostgreSQL 连接明确返回不支持且结构保持不变；页面按连接能力禁用按钮，不以客户端排序冒充数据库变更。
- [x] 操作确认包含库、表、字段；删除表沿用旧页面禁用策略，失败保留草稿、取消不影响新编辑。
- [x] 未授权账号和匿名调用真实拒绝，不以按钮隐藏代替服务端授权。
- [x] PostgreSQL 隔离测试、生产桌面直达与刷新、明暗主题切换、停机反馈和清理通过。
- [x] 稳定截图视觉复核；已查看建表、字段结构明暗主题及停机草稿截图，未见遮挡、裁切或关键按钮不可达。
- [x] 相关测试、lint、类型、前后端构建通过；桌面截图已实际复核，完整任务完成。

## 验收证据

- 最终真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-e84165d05d6544b3b9bf38582f115295/evidence/database-browser-baseline.json`。`passed: true`、`cleanupPassed: true`，6 个阶段通过，容器已移除，隔离 API 已停止。报告同时记录 PostgreSQL 物理列重排拒绝及结构不变。
- 测试数据库为只绑定 loopback 的独立 `postgres:18` 容器。主库与日志库使用新建 SQLite 保存账号和权限，库表维护操作全部指向独立 PostgreSQL `maintenance`，没有接入开发或生产业务数据库。
- 真实 PostgreSQL API：建表、同名改备注、改表名、字段增加 / 重命名 / 删除、默认值修改和撤销；`information_schema.columns`、主键约束、identity、表备注分别反查。覆盖 `bigint` 自增主键、`varchar(64)`、`numeric(12,3)`、可空、中文备注、中文和带单引号默认值；重复表不覆盖、非法默认值拒绝、字段顺序不支持返回不改变结构。
- 修复 SqlSugar 动态建表将 `bigint` 自增拼成 `serialt`，及 PostgreSQL 混合大小写字段删除未引用名称的问题。PostgreSQL 建表 / 加列 / 改表 / 改字段使用原生引用和事务，失败回滚；未改变旧字段编辑仅改名称、备注、默认值的合同。
- 真实 Edge 生产页面：建表、改表、字段增加 / 编辑 / 删除、取消删除、表名和备注搜索、连接切换清空目标、刷新、明暗主题、操作目标确认。最后停止已核验 marker / PID 的 API，保存真实收到失败，草稿保留、按钮恢复、无新表。
- `TestUser3` 真实拒绝连接、表、字段、类型查询和 7 个写端点，匿名建表拒绝；所有 `sysDatabase` API 不再因菜单未登记权限而默认放行。新增明确菜单权限，存量账号需走既有授权流程。
- 工程：ESLint、类型检查、生产构建通过；Vitest 7 / 7，覆盖重复字段、参数、移动合同、连接切换和会话迟到响应。后端 268 / 268，排除既有 Selenium `UserTest`，不将排除项算通过。最终桌面 Mock 契约 7 / 7，报告位于 `C:/Users/zoyo/AppData/Local/Temp/adminnet-database-ui-xwmgVS/database-contract-baseline.json`，覆盖失败草稿、取消、只读、查询失败禁写和连续模式切换，不能代替真实 API。
- 后端测试采用独立 artifacts 目录并直接运行测试 DLL；`dotnet test` 的命名管道拒绝和默认 exe 锁定未通过停止用户进程解决。设置有效 `TEMP` / `TMP` 后回归通过。Antdv CLI lint 仍只回显参数，不计有效检查；依赖未升级，大 chunk 与 C# 既有警告保留。
- 截图：`24-create-table.png`、`24-columns-light.png`、`24-columns-dark.png`、`24-stopped-service-draft.png` 位于最终真实报告同目录。已查看截图，桌面明暗主题、表格结构、操作栏和停机错误草稿均可读，无明显遮挡或裁切。

## Comments

- 2026-10-09：按用户授权开始第 24 项，不推进 25、26；用户明确改用 PostgreSQL 测试。MySQL 镜像下载已结束，但未创建或运行 MySQL 容器。
- 2026-10-09：本轮真实与契约完成后复核 Skill 经验，追加 Form ID、弹窗销毁和 PostgreSQL 反查经验；截图已查看，顺序调整单独保持未验收。
- 2026-10-10：依据原有 MySQL-only 合同和 PostgreSQL 真实拒绝结果关闭顺序调整验收；不采用涉及索引、约束、依赖、数据与权限保留风险的删表重建方案。提案 24 完成，准备提交并继续 25。
