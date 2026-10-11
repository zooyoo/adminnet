# 提案 34：动态插件管理

Status: ready-for-agent
Execution: completed

来源：doc/frontend-vben-tickets-draft.md 第 34 项。用户要求仅桌面验收、隔离 PostgreSQL、真实生产构建浏览器及 API。按现有插件合同迁移，不新增未经现有实现支持的插件协议。

## 范围与验收

- [x] 核对旧界面、SysPlugin 服务、DTO、权限与真实动态加载路径，建立功能对应。
- [x] 维护插件信息、程序集及原有代码配置；保留已有实际提供的增删改查与状态行为。
- [x] 在授权隔离环境实际编译、加载和执行测试插件，并验证删除或卸载后的既有行为。
- [x] 成功、校验、权限不足、适用租户隔离、编译/加载错误和服务失败均有真实证据。
- [x] PostgreSQL 持久化反查、数据及进程清理通过。
- [x] 相关单元测试、类型检查、lint、生产构建与桌面明暗稳定截图分别核验。
- [x] 更新功能对应、进度及交接记录后独立提交本项代码。

## 恢复依据

历史两个提案 33 成员曾被复用派发本项后中止。现已保持归档，后端仅完成读取/查询，前端仅完成读取/组件资料准备；不能将这些视为本项已完成。当前主会话接手，不复用旧成员。

历史收尾提交 ea98c1877：35 项回归通过，实时宿主与业务证据绑定的正式 CLI 返回 reviewed-clear、退出码 0、blockers=[]。7 条历史失败/中止处置保留原始 outcome，18 个直接子会话归档且停止。证据位于 .scratch/proposal-agent-lifecycle/business-review.json 与 reconciled-cli-audit.json。

## 源码核对与实施进度

第 20 轮已核对：

- 旧页面 `Web/src/views/system/plugin/index.vue` 提供按名称/租户查询、分页、新增、编辑、删除及修改记录，按钮沿用 sysPlugin:page/add/update/delete。
- 编辑器保留 Name、AssemblyName（可空）、OrderNo、Status、Remark、CsharpCode。旧 Monaco 初始化没有回填已有代码；新实现需保证原文重开。
- 现有 DTO AddPluginInput 继承 SysPlugin，UpdatePluginInput 继承 AddPluginInput，DeletePluginInput 只有 ID。实体 Name64、AssemblyName512、Remark128，CsharpCode 必填。
- SysPluginService 提供 Page/Add/Update/Delete 与公开 CompileAssembly/RemoveAssembly；LoadAllAssembly 在 OnlineUserJob 中调用。当前 Add/Update/LoadAll 不按 Status 区分，Update 先移除旧程序集再编译，可能在编译失败时损失旧运行接口；租户与更新字段边界仍需补齐。
- 新应用目前只有生成的插件 SDK，没有业务页面。
- 已修改 RoutePermissionUtil：sysPlugin:* 必须显式授权，保留现有超管例外，不新增权限映射或放宽编译接口。JwtHandler 在未显式授权时先拒绝，不再落到“菜单未登记即放行”分支。
- 后端 Test 项目 net10.0 构建通过，RoutePermissionUtilTests 60/60、0 跳过；新增插件 page/add/update/delete/compileAssembly/removeAssembly 与大小写用例共 7 项。输出位于本功能目录 plugin-test-build，日志 plugin-test-build.log、plugin-route-permission-tests.log；未运行任何数据库或浏览器验收。

第 21 轮增量：

- 新增 PluginContracts，校验分页、名称/程序集/备注长度、代码非空和状态枚举；新增实体只允许业务字段，忽略请求伪造的主键及创建审计字段，CsharpCode 原文保留。
- 普通用户查询显式限定当前租户；新增拒绝跨租户，更新/删除先查询并确认归属；更新拒绝改变租户，写入只允许业务及服务端更新审计字段，WHERE 显式包含主键和原租户。程序集名称全局判重，功能名称按租户判重。
- 更新先编译新代码，成功后再移除数据库中旧程序集名称；不使用请求传入名称卸载。禁用插件不发布，启动只加载启用记录。此时仍有数据库持久化/运行时发布失败回滚和并发一致性待实现，不宣称完整原子恢复。
- Test 项目构建通过；PluginContractTests 12 项 + RoutePermissionUtilTests 60 项 = 72/72，0 跳过。PluginContractTests 含 PostgreSQL SQL 生成检查（未建立数据库连接），覆盖原文保留、伪造字段、参数边界、租户、主键与白名单条件。日志 plugin-contract-tests.log。

第 26 轮增量：

- 新增 PluginMutation，以单进程 SemaphoreSlim 串行协调新增、更新、删除、直接编译/移除和启动加载。查询与编译准备在取得锁后进行，避免旧读取覆盖后续变更；不宣称多实例同步。
- 新增/更新/删除使用数据库事务：先保存，再发布，再提交；保存失败仅回滚数据库，发布或提交失败同时恢复原运行程序集，恢复失败聚合原始异常并继续尝试另一项清理。
- 从 ApplicationPartManager 获取实际 AssemblyPart 快照；更新与删除恢复原程序集对象，不通过重编译旧代码冒充恢复。新增程序集若与现有 MVC 部件同名则拒绝。启动加载也参与互斥，跳过已注册名称，避免重复注册。
- 最终 Test 项目构建通过，79/79、0 跳过；新增 7 个故障/并发协调测试覆盖 begin/save/publish/commit 失败、回滚失败仍恢复运行时、失败释放锁。当前是委托故障注入测试，不是实际 PostgreSQL 事务和 MVC 路由恢复验收。
- 本轮保留限制：提交应答丢失、进程崩溃、路由发布期间的并发 HTTP 请求、多实例运行和直接编译/移除端点的完整租户及恢复边界尚未核验；不能宣称跨数据库与 MVC 的原子事务。

第 27 轮增量：

- 新增 PluginRuntimeTests，实例化已安装 Furion 4.9.9.92 的实际运行时提供器，通过公开接口操作真实 ApplicationPartManager。动态生成最小控制器验证替换成功、提交异常恢复原程序集实例、MVC 控制器发现、方法返回 34、卸载后控制器为空和变更通知触发。
- 初次构建因 Furion 实现类 internal 失败，测试改用反射实例化实际实现；首次运行又发现 AssemblyBuilder 包装器不等于类型所属运行程序集，修正测试样本以返回真实 Assembly，保留 Same 实例断言。最终构建与 81/81 测试通过，0 跳过。
- 直接 CompileAssembly 发布失败时补偿移除本次程序集，清理失败聚合原异常。直接移除的目标限制、租户边界及失败恢复仍待补齐。
- 新增测试使用 Reflection.Emit 和真实 MVC/Furion 内存部件，不是 C# 编译器验收、HTTP 路由调用或 PostgreSQL 事务测试；尚不能宣称浏览器真实闭环通过。

第 28 轮增量：

- 直接 CompileAssembly 校验非空代码及程序集名称长度；在当前锁内记录成功发布临时程序集的租户归属，并检查所有租户持久化记录的名称，避免覆盖禁用插件。
- 直接 RemoveAssembly 查询可访问的持久化插件，或从进程内临时程序集登记中读取租户；未知归属、无效租户与普通用户跨租户均拒绝，超管也不能按名称移除没有插件归属的宿主程序集。移除以实际 Assembly 快照执行，失败后恢复原对象，成功后清除临时登记。
- 最终 Test 构建通过；88/88、0 跳过，新增 7 项归属合同测试。该结果仍不代表真实 HTTP 接口和 PostgreSQL 验收。
- 仍需直接端点真实授权/数据验证、移除通知失败注入测试及临时程序集生命周期验证；进程内登记不跨实例持久化。

第 29 轮增量：

- 新增实际 Furion.App.CompileCSharpClassCode 测试：编译最小 C# 控制器，发布到真实 MVC/Furion 部件；无效 C# 编译抛错后旧控制器仍可发现并返回“插件34”；卸载后发现列表为空。
- 显式释放编译句柄后再发现并调用原程序集，核对与 SysPluginService 使用 using 返回后的生命周期一致；Same 断言保留，未以名称相同替代实例一致。
- 最终构建通过，89/89、0 跳过，日志 plugin-contract-tests.log。当前覆盖真实编译器和内存 MVC 部件，不包含实际 HTTP、数据库持久化或浏览器。

第 30 轮增量：

- 新增新应用 `api/system/plugin.ts`，沿用 sysPlugin/page/add/update/delete，支持 AbortSignal 与 silentError；不暴露额外直接执行按钮。
- 新增编辑草稿合同：从列表原文回填 CsharpCode，保留长字符串 ID、当前记录租户、0 排序和禁用状态；草稿与原记录隔离，只提交业务字段，不夹带审计字段。
- 输入校验覆盖必填、Name64/AssemblyName512/Remark128、32 位整数排序及状态；不复制旧界面“代码少于100字符即拒绝”的启发式限制，实际合法性由后端编译器判断。
- Vitest 实际安装版本 4.1.11，10/10 草稿合同测试通过；三个新增 TS 文件 ESLint 通过（首轮修正联合类型排序）；应用 vue-tsc --noEmit --skipLibCheck 通过；Prettier 已运行，保留现有 jsxBracketSameLine 弃用提示，不改工具配置。
- 尚未新增 index.vue 页面及路由映射，UI/API 实际联调与浏览器验收不计完成。日志 plugin-frontend-unit.log、plugin-frontend-eslint.log、plugin-frontend-typecheck.log。

第 31 轮增量：

- 新增 PluginSession，查询/保存/删除分别维护取消控制器，检查身份、会话版本、请求代次和当前页面激活状态；离页或身份/权限变化清除列表、草稿、确认对象与通知，迟到结果不能回填。
- 保存防重、保存期间禁止切换编辑对象，成功后重查列表；请求失败不推断服务器未提交，保留草稿并提示核对。删除取消不发请求，删除失败保留确认对象，删除末页最后一条时回退页码。
- 前端插件测试 17/17（草稿 10 + 会话竞态 7）；ESLint 方法排序修正后通过；应用 vue-tsc 通过。实际浏览器仍未接入。

第 32 轮增量：

- 新增 index.vue 插件管理页面，使用已查询的 Antdv-Next 1.5.2（安装与锁文件一致）组件：列表、租户/名称筛选、分页、增改编辑器、删除确认、错误和成功反馈、修改记录。
- 接入 PluginSession 的 mounted/activated/deactivated/dispose 与身份/权限监听；租户选项独立代次核对，身份变化后旧返回不得回填。失败输入汇总可聚焦并链接字段。
- 新增 plugin-route.ts 并接入菜单归一化，保留 /platform/plugin 与旧组件指向 /system/plugin；别名去重并保留自定义菜单元数据。
- 前端 20/20（草稿10、竞态7、路由3）通过，新增页面/路由/菜单 ESLint 与应用 vue-tsc 通过。Antdv CLI lint 仅回显 Parsed args，不计有效验收。
- 尚缺原 Monaco 编辑能力（当前暂为 Antdv TextArea）、生产构建、桌面实际布局/视觉和真实 API 交互验证。不能以类型通过或存在页面关闭本项。

第 35 轮增量：

- 使用仓库 pnpm 11.16.0 为目标应用安装 monaco-editor 0.55.1 固定版本；package.json 增加 1 行，锁文件增加 25 行，未升级其他现有依赖。
- 新增 code-editor.vue 并接入插件弹窗，按需导入 ESM editor API、C# 基本语言高亮和 Vite editor worker；主题随 usePreferences.isDark 变化，保存期间只读。关闭弹窗卸载 editor、model 和内容监听；异步加载后检查组件是否仍存活。
- 首次类型检查因 Monaco exports 子路径省略 .js 失败，修正后应用 typecheck 通过；最终 ESLint 和生产构建通过。编辑器加载失败保留原文并提供文本编辑及重试。
- 生命周期、原文换行保持、键盘焦点、worker 加载和明暗视觉尚需真实浏览器验证；当前未将这些推断为通过。

第 36 轮增量：

- 新增生产代理桌面 Mock 合同 runner、配置及 plugin-contract.spec.ts，使用已安装 Edge，拒绝未声明 API，请求上游仅指向本机不可用端口。
- 最终 1/1 浏览器合同通过：登录生产页面、Monaco 可见、未编辑代码 CRLF 原文提交、业务失败反馈、真实键盘编辑进入请求、取消后编辑器 DOM 消失、再次打开原文恢复；代理关闭通过。
- 前两次失败：隐藏 textarea 聚焦后输入未进入模型；根据实际错误快照改用带“C# 代码”名称的 textbox，并等待错误汇总聚焦。经验已更新 real-browser-baseline/references/lessons.md。
- 本结果是 Mock API 合同，不代表真实编译/数据库/HTTP 鉴权或视觉验收；资源释放只验证 DOM 消失，尚未测量 worker/model 残留。日志 plugin-desktop-contract.log。

下一步：补齐浏览器其余 CRUD/权限/明暗视觉与错误场景，执行直接接口真实测试、隔离 PostgreSQL 与桌面动态加载/调用/卸载验证。本项尚未完成，不提交为已交付。

第 40 轮增量：

- 当前 Web.Entry 使用独立输出目录 `plugin-api-build` 完成 net10.0 Debug 构建，退出码 0；日志 `plugin-api-build.log`。真实服务尚未启动，不计 PostgreSQL 或浏览器集成通过。
- 恢复检查发现旧业务处置摘要与当前日志不匹配。通过 `revalidate-current-review.mjs` 逐项比较原审计：17 个成员及归属、结果、宿主关闭状态完全一致；额外侧会话一致；阻塞仍精确对应原 7 条已处置结果；全部原始证据 SHA-256 未变化，原验收报告及清理结果再次检查通过。
- 独立输出 `current-business-review.json`、`current-reconciled-audit.json`，保留旧处置和审计未覆盖；本次核验返回 reviewed-clear、blockers=[]。无需再次归档或唤醒历史成员。本结果只允许继续当前第 34 项，不代表其业务完成。
- 本轮未执行浏览器，未产生新的浏览器通用经验。后续使用当前独立 API 构建完成隔离 PostgreSQL 真实联调、持久化反查及桌面截图；本项保持 in-progress，未提交为完成。

第 41 轮增量：

- 新增 `run-plugin-service-baseline.mjs`（生成源 `prepare-plugin-service-baseline.mjs`），复用既有隔离启动、归属核验、脱敏、清理 helper；明确边界为 real-postgresql-plugin-service-no-browser。使用本次 `plugin-api-build` 与 PostgreSQL fixture，登录加密公钥仅从公开生产 JS 提取，不读取 .env。
- 实际 6 阶段通过：真实新增后 PostgreSQL 反查 C# 原文 UTF-8 字节与 HTTP 执行；无效 C# 更新拒绝后整行记录不变且旧路由仍返回原值；更新替换返回值；禁用后路由 404；重新启用恢复；删除后数据库为 0 且路由 404。
- 原始报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-333a29301fbd447e82b798b6f9772174/evidence/plugin-service-baseline.json` 已直接读取，passed=true、cleanupPassed=true、cleanupErrors=[]；fixtureRecordsRemoved、containerRemoved、apiStopped 均为 true。阶段日志 `plugin-service-baseline.log`，进程退出码 0。
- 这次为真实服务集成，不含浏览器、授权租户、直接 CompileAssembly/RemoveAssembly 和停机草稿验收；尚不能关闭提案。已复核 Skill，无新增通用经验。

第 42 轮增量：

- 新增 `plugin-browser-flow.mjs`、`prepare-plugin-browser-baseline.mjs` 与生成入口 `run-plugin-browser-baseline.mjs`。生产 Web/dist + Edge 桌面 1680×1100 + 真实隔离 PostgreSQL/API，共 9 阶段通过；没有 Mock API。
- 除 6 个真实服务阶段外，真实页面完成 Monaco 输入、新增保存、PostgreSQL 字节核对和 HTTP 执行；编辑重开未修改提交保持原文；编译错误后整行数据库不变、旧接口正常、错误草稿重复提交仍保留，修正后更新成功；删除取消保留接口、确认删除后列表/数据库/接口均移除。未发现 pageerror。
- 原始报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-35b5a46f88954443aecd36e8abd3a935/evidence/plugin-browser-baseline.json` 已直接读取，passed=true、cleanupPassed=true、cleanupErrors=[]，测试记录、容器及 API 均已清理。
- 实际查看同目录 34-plugin-light.png、34-plugin-dark.png、34-plugin-editor.png、34-plugin-compile-failure.png：列表与编辑弹窗未见遮挡，代码、错误提示和保存/取消按钮可见。发现租户筛选为空时宽度仅剩箭头，后续调整；编译错误当前为通用保存失败提示，未展示编译诊断，保留该限制待核对。
- 浏览器合同与共享 fixture ESLint 通过，日志 plugin-final-e2e-eslint.log。本轮复核 Skill，无新增通用经验。仍需真实权限/跨租户、直接编译移除接口及停机失败验收，不关闭提案。

第 43 轮增量：

- 新增 `plugin-permission-flow.mjs`、`prepare-plugin-permission-baseline.mjs` 与生成入口 `run-plugin-permission-baseline.mjs`，使用 4 个真实创建并授权的隔离租户。通过跨租户查询不可见、新增/更新/删除及变更归属拒绝，拒绝后 PostgreSQL 整行记录保持不变。
- 匿名、无授权及只读账号的写入和直接编译/移除请求均得到真实鉴权拒绝；只读账号仍可查询自己的空列表。超管直接编译并实际 HTTP 执行成功，同名冲突不破坏旧接口；拒绝移除宿主程序集；移除后 HTTP 404、重复移除被拒绝，禁用持久化插件的程序集名不能被直接编译占用。
- 首次测试因将 RemoveAssembly 的路径参数错写为查询参数得到 404，未计权限通过。改为 `/api/sysPlugin/removeAssembly/{assemblyName}` 后重跑全部阶段成功，进程退出码 0。
- 原始报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-ea2600c6bdd64c80811b4e065bf01549/evidence/plugin-permission-baseline.json` 已直接读取，passed=true、cleanupPassed=true、cleanupErrors=[]；14 项租户与关联表残留计数均为 0，插件记录、API 与容器均清理成功。日志 `plugin-permission-baseline.log`。
- 清理阶段沿用的文字含 `original-snapshot-preserved`，实际没有执行全表初始快照比较，不能据此宣称全库原状保持；已修正生成器的阶段名称。实际证据为归属限定清理、关联记录零残留，以及拒绝操作前后的目标插件整行相等。未修改原始报告。
- 这次为服务权限验收，不含授权租户直接编译后的跨租户临时程序集移除、浏览器权限切换或停机保存；后续补齐适用项及界面修正。第 34 项仍保持进行中。

第 44 轮增量：

- 新增真实停机保存与重试阶段：先清理既有插件，再停止已校验隔离 API；浏览器连续两次提交均返回服务失败，请求草稿一致、错误汇总聚焦、按钮恢复可用、PostgreSQL 无新增记录，取消后弹窗关闭。
- 本轮初次真实桌面共 10 阶段通过。报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-9ae7bc595d964d918e8f35c7e15770b3/evidence/plugin-browser-baseline.json` 已读取，passed=true、cleanupPassed=true、cleanupErrors=[]，记录/API/容器均清理成功。实际查看 34-plugin-stopped-api.png，草稿、错误和保存/取消按钮均完整可见。
- 上述运行使用修改前生产构建。随后修复租户筛选：原生固定宽度容器承载全宽 Select，并显示“全部租户”；保存失败展示统一拦截器标记 ERR_ADMIN_RESULT 的业务诊断（最多 2000 字符），同时保留核对结果与草稿提示，网络异常仍使用通用提示。
- 新增业务诊断单元回归，PluginSession 8/8 通过；相关 ESLint、vue-tsc 与生产构建均通过，日志 plugin-diagnostic-unit.log、plugin-diagnostic-eslint.log、plugin-diagnostic-typecheck.log、plugin-final-production-build.log。
- 已为最终生产浏览器补充租户宽度、占位文字和真实 CS 编译诊断断言。最终重跑任务 pwsh-17 已启动，日志 plugin-final-browser-baseline.log；待收集结果和截图，不能将上一构建的浏览器通过替代本次修改的验收。Skill 已复核，无新增通用经验。第 34 项仍未提交。

## Comments

- 第 19 轮恢复：原第 34 项正式 issue 文件不存在，本轮按已授权提案范围补建；尚未重新核验业务实现或执行业务测试。

第 45 轮最终复验：

- 最终生产构建真实桌面 10 阶段通过，报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-370362cfcfce4b788f5017e7e6e7e6bd/evidence/plugin-browser-baseline.json`：passed=true、cleanupPassed=true、cleanupErrors=[]，插件记录、API、容器已清理。实际查看 light、dark、compile-failure 截图，租户筛选宽度及占位恢复，具体 CS 编译诊断、草稿、保存/取消按钮完整可见。
- 显式授予两个真实租户 compileAssembly/removeAssembly 权限后，所属租户编译成功，另一租户移除临时程序集及持久化程序集均被拒绝，旧 HTTP 和数据库整行不变；所属租户移除成功。最终权限报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-29c70ace55104e7989e1c580ec86a98b/evidence/plugin-permission-baseline.json`：passed=true、cleanupPassed=true、cleanupErrors=[]，14 项关联残留计数为 0，directPermissionMenusRemoved=true，API、容器和记录全部清理。
- 尚不宣称多实例原子事务、崩溃恢复或 Monaco worker 无泄漏。生产页面与 Mock 合同、内存故障测试与真实 PostgreSQL 分别记录，不互相替代。
- 提交前发现工作区其他修改：progress.md 被重新排版并删除两条约束，docs/agents/proposal-closeout.md 被清空；并非本轮操作，不恢复、不纳入插件提交。保留原有用户 .gitignore 和提案文档修改。第 34 项验收已通过，待完成文件范围核对、功能对应及独立提交后再标整体完成。
- 已复核真实浏览器 Skill，无新增通用经验。
