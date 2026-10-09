# 编号提案上下文交接

日期：2026-10-10（Asia/Shanghai）。

## 最新接续：提案 27 已完成，下一项 28

- 提案 27 已完成并准备提交，总进度 27 / 48；继续严格编号、逐项验收后提交，仅桌面和隔离 PostgreSQL。
- 新增 Vben system/log 四类页面（访问、操作、异常、数据差异），复用真实 SysLog* API，支持分页、日期 / 账号 / 租户 / 状态筛选、详情、差异表格、操作 / 异常导出和超级管理员清空确认。
- 后端日志服务补齐租户过滤、详情边界、日期范围校验、超级管理员清空和导出租户过滤；SysConfig 更新使用真实差异日志。访问日志对 login / loginPhone / logout 分类写入。
- LogDataSanitizer 处理历史日志详情、导出、请求 / 返回 / 异常、差异敏感字段；差异 SQL 与无上下文参数不返回。新增 LogDataSanitizerTests，路由权限回归扩展到日志端点。
- 隔离启动脚本 -LogFixture 使用同一 PostgreSQL 18 主库 / 日志库并关闭验证码；真实脚本覆盖四类日志、日期空结果、分页 / 详情 / 差异 / 导出、匿名 / 普通 / 授权租户边界、清空取消与确认、Edge 明暗桌面和停机反馈。
- 最终报告：C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-3061b2b9c3da4f279ecf6bf09b0cad08/evidence/log-browser-baseline.json，功能、清理和视觉通过。已检查操作日志明色、差异详情暗色和差异列表暗色；API、代理、Edge 与 PostgreSQL 容器已停止 / 清理。
- 工程：API / Test 构建、前端生产构建、类型检查、ESLint、node --check 和日志脱敏 / 路由权限回归合计 56 / 56 通过。dotnet test 旧 VSTest target 被 .NET 10 Microsoft Testing Platform 拒绝，使用测试 DLL 直接执行；antdv lint 仅回显参数。
- 不提交用户已有 AGENTS.md 和 doc/frontend-vben-tickets-draft.md 改动。下一项 28：服务器与运行时监控；先核对旧 SysServerService 返回合同和新前端 API / 图表，再做真实授权隔离、轮询释放、Edge 桌面与停机验收。

## 最新接续：提案 26 已完成，下一项 27

- 提案 25 已提交 `459ce0f83`；26 已完成并准备提交，总进度 26 / 48。继续严格编号、逐项验收后提交，仅桌面和隔离 PostgreSQL。
- 库表页增加实体 / 种子生成入口和 Antdv-Next 预览编辑器；命名空间和基类来自实际配置，保留后缀、已有种子过滤及连接 / 表上下文。种子仍要求已编译实体，新实体须重新编译 / 启动后生成种子。
- 后端预览 / 写入共用内容，摘要绑定目标路径；已有文件需要明确覆盖和目标摘要匹配，写入使用临时文件原子替换，并拒绝不在配置中的位置和符号链接。预览、输出和拒绝均已真实验证。
- 修复模板 using、`bytea` → `byte[]`、字符串和复杂 scalar literal；特殊值 xUnit 通过真实编译和回读，目标文件变化保护通过。基类类型、主键和 identity 不一致时拒绝并提示无基类生成。
- 真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-144a86b70fd2470da7e98280087a7046/evidence/database-generation-browser-baseline.json`；其桌面明暗预览、停机、清理证据与生成编译日志同目录。
- 契约 `Temp/adminnet-database-ui-3rUIe4` 11 项，生成 xUnit 2 项、权限 38 项、API / Core / 生产构建、类型、ESLint 和脚本语法通过。生成代码仅 2 条不阻断警告，见日志；不把警告记为错误。
- 用户 `AGENTS.md` 和原提案文档改动保持不动、不提交。下一项 27：访问、操作、异常和数据差异日志，先核对旧列表 / 详情 / 权限与日志写入基础设施，再执行隔离真实产生与查询。

## 最新接续：提案 25 已完成，下一项 26

- 提案 25 已完成并准备提交，总进度 25 / 48；继续按 PostgreSQL、仅桌面验收和逐项提交推进。
- 后端 `GetVisualDbTable` 按所选连接读取真实表、字段和 PostgreSQL `pg_constraint` 外键元数据；无外键不绘制连线，关系类型不从实体导航或客户端推断。
- 新前端隐藏认证路由 `/develop/database/visual` 复用 `relation-graph 2.2.11`。库表页传递 `configId` / `tableName`；关系图支持定位、节点拖动、缩放、居中、适配、节点 / 连线详情、键盘选择、加载失败、空库和无关系边界。
- `Spin` 包装器显式建立满高链，节点显式宽高和固定坐标，解决生产截图中内容被压在顶部的问题。节点点击由页面自身事件同步详情，规避引擎拖动结束 200 ms 点击抑制。
- 最终真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-9837a14daffe4a268e711b73390dd750/evidence/database-visual-browser-baseline.json`，`passed: true`、`cleanupPassed: true`；截图已实际查看，API、浏览器、代理和 PostgreSQL 容器已停止 / 清理。
- 生产契约报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-database-ui-mKa78h/database-contract-baseline.json`，9 项通过；关系图 Vitest `9 / 9`、类型、ESLint、前后端构建通过。
- 不提交用户已有 `AGENTS.md` 和 `doc/frontend-vben-tickets-draft.md` 改动。只提交提案 25 相关文件。
- 下一项 26：实体与种子数据生成。沿用第 24 项数据库 / 表选择，先核对旧代码生成页面、真实 API、命名空间 / 字段合同和隔离 PostgreSQL 输出；不要把前端页面生成职责混入实体生成任务。

## 提案 25（已完成）

- 提案 24 已完成并准备提交，总进度 24 / 48。用户要求按 PostgreSQL、仅桌面验收；真实 API、权限、停机失败、清理、工程检查和截图复核均通过。
- 新增 Vben `system/database` 页面、可复用连接 / 表选择、建表字段配置和改表 / 字段编辑 / 删除确认；删除表沿用旧 UI 禁用策略。类型来自当前连接；既有字段编辑仍只改名称 / 备注 / 默认值。
- PostgreSQL 原生 identity / quoted identifiers / 事务修复 `serialt` 与大小写字段删除；所有 `sysDatabase` 端点要求显式权限，菜单新增读写按钮。原有物理列重排合同仅支持 MySQL，PostgreSQL 明确拒绝且结构不变，建表前字段顺序已真实反查。
- 最终真实目录 `Temp/adminnet-vben-e84165d05d6544b3b9bf38582f115295/evidence/`：6 阶段功能、停机、清理通过，测试表已删，容器已移除，API 停止。最新桌面契约 `Temp/adminnet-database-ui-xwmgVS` 7 项，Vitest 7 项，后端 268 项，lint / 类型 / 构建通过。完整证据和限制见 issue 24。
- 工作区包含其他任务和用户修改；提案 24 提交只纳入数据库维护相关文件。用户修改 `doc/frontend-vben-tickets-draft.md` 第 48 项保留且不提交；临时日志与 artifacts 位于最终临时证据目录，不提交生成内容；截图已实际查看。
- 本轮修复 Form 生成 ID 冲突和模式切换销毁旧实例误发关闭事件；同连接迟到重载不能恢复旧目标。提交后进入提案 25（数据库关系图与表查看），不重启已经终止的测试流程。

## 提案 25 实施记录（已完成）

- 已创建 issue 25。旧页面使用 `relation-graph/vue3`，新应用尚未接入；旧 `GetVisualDbTable()` 只读取主库实体导航，不能证明所选隔离 PostgreSQL 的真实结构。
- 目标是保留 `/develop/database/visual` 隐藏认证路由，从库表维护页面传递 `configId` / `tableName`；后端只从所选 PostgreSQL 的真实表、字段和外键元数据生成关系图数据。
- 真实 API、生产 Edge、契约、截图和清理已全部通过，详见上方交接。

## 最新接续：提案 21、22、23 已统一完成

- 用户本轮范围为 21、22、23，均已分别按验收点完成，总进度 23 / 48；不自动推进 24，不执行生产切换。
- 恢复 `/platform/job` 与旧 `/system/job/index` 组件路径：HTTP / C# 脚本编辑、引擎即时状态、任务 / 触发器控制、全局范围确认、记录与集群。所有 `sysJob` API 要求明确权限，Cron 预览 / 分组 / 触发器列表复用查询权限；保持原系统级数据模型。
- Cron 预览复用 Furion 4.9.9.92 `Crontab`，明确服务端时区、不含起点、5 / 6 / 7 字段与宏；真实 5 次运行与预览完全一致。周期、自定义类型、次数、重试与启动选项保留。SQLite 清空记录使用无序列的删除，新增回归。
- 原 Sundial.Dashboard 保留独立登录。相对 API 部署使用根 `/schedule/`，Vite、Nginx 与验收代理需转发该路径；不通过 URL 传应用令牌。原看板路由不能直接嵌入业务 API 前缀；同源生产页面、资源、登录与匿名 POST 拒绝已真实验证。
- 最终真实目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-7a71174d4166461d9b6dfb40eb65f1e4/evidence/`：8 阶段、`passed`、`cleanupPassed` 均通过，稳定截图已查看，任务 / 触发器 / 记录为 0，API / 浏览器 / 代理已停。连续 10 次真实启动后取消窄范围也通过。
- 后端 251 项（排除既有 Selenium `UserTest`），表单 10 项，生产桌面契约 10 项（`Temp/adminnet-job-ui-uIWWU8`），ESLint / 类型 / 前后端构建通过。测试输出 `Temp/adminnet-vben-test-21`；直接 `dotnet` 执行测试 DLL，默认 exe 被现有进程锁定，未终止它。CLI lint 仅回显，不计有效检查；Nginx 无本机 / 容器语法执行证据，大 chunk 和既有 C# 警告保留。
- 功能对应与复跑见 `doc/frontend-vben-jobs.md`，各验收和边界见 issue 21、22、23。`real-browser-baseline` 经验已更新，不保留认证值或某次实体 ID。

## 最新接续：提案 17、18 已统一完成

- 本轮用户明确要求统一规划推进 17、18，完成后更新进度并提交；该要求覆盖下文历史的“不要提前推进 18”。总进度 18 / 48，19 待开始，本轮没有实施 19。
- 保留 `/platform/file` 和旧组件路径，恢复真实文件查询、上传、元数据编辑、中文下载、删除及图片/Office/PDF/媒体预览。所有预览读取使用认证 API，关闭、取消、切换、缓存页离开及身份变化释放资源。
- 文件权限、私有租户边界、元数据白名单、静态私有资源保护、准确大小校验和去重上下文已修复；重复头像/签名复用相同 ID 不再删除文件。头像明确公开，签名新增当前用户认证读取，通知图片复用上传合同。
- 最终真实目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-0901fd2c1db24262b0592aeb6e232b4b/evidence/`：7 阶段及清理通过，启用 MD5 去重，全部样本本地生成；角色授权、个人图片、数据库及物理文件反查清理，API/浏览器/代理已停。
- 后端 232 项（排除既有 Selenium UserTest）、前端相关 37 项、生产桌面契约 10 项、类型/ESLint/前后端构建通过。契约目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-file-ui-SjUf9F/`。CLI lint 仍仅回显参数，不计为验证。
- 功能映射、旧无持久化关联字段和部署边界详见 `doc/frontend-vben-files.md`。历史标记私有的资源不再经匿名静态直链公开，不批量改写历史公开状态。OSS/SSH 外部部署并未借用本地结果宣称验收。
- 构建目录：`Temp/adminnet-vben-build-17` / `Temp/adminnet-vben-test-17`。复跑真实脚本自行启动临时服务，要求 5016 空闲。
- 用户已有 `DeepSeek.example` 和原提案文档改动保持不动且不提交；未启用子代理。提案记录与此交接随联合提交，提交哈希通过 `git log` 核对。

## 最新接续：第 16 项已完成，下一项 17

- 第 15 项提交 `d03911048`；16 随本记录提交，`git log` 核对。总进度 16 / 48，当前 goal active；继续严格编号、验收更新后逐项提交，仅桌面。
- 恢复 `/home` → `/dashboard/home` 和旧 `/home/index` 工作台组件，真实日程/收藏、身份隔离布局、时钟、项目说明和 Gitee 更新记录。随机收入及固定进度为旧示例，不伪造业务；日程未发现提醒投递实现。
- 日程所有操作限制当前用户与租户，字段白名单、日期时间和内容校验；收藏复用真实登录菜单过滤、拒绝无权 ID、支持排序和清空。新前端仅 Antdv-Next。
- 最终真实报告 `Temp/adminnet-vben-0a99e9ba8b9b4deebbcacd3199ff6ff2/evidence/home-browser-baseline.json`：6 阶段及清理通过。真实 Gitee 成功、明暗桌面与停机截图已查看，API/代理/浏览器已停止。
- 后端 209 项（排除 Selenium UserTest）、前端 4 项、生产桌面契约 14 项、类型/lint/build 通过。契约目录 `Temp/adminnet-home-ui-qNSsrm`；构建 `Temp/adminnet-vben-build-16` / `Temp/adminnet-vben-test-16`。xUnit 用测试 exe 执行；`dotnet test` 旧 VSTest 目标在此 SDK 下失败。
- 下一项 17：文件管理、上传下载与图片预览。沿用已有上传和二进制响应处理，核对旧文件页/权限/租户边界、资源地址与清理。不要提前推进 18 的 Office/媒体引擎。
- 保留用户 `DeepSeek.example` 和原提案修改，不提交。未启用子代理。

## 最新接续：第 15 项已完成，下一项 16

- 第 14 项提交 `a1c1b5820`，15 随本记录提交。总进度 15 / 48；严格逐项完成、更新与提交，仅桌面。
- 个人中心改为真实 Antdv-Next UI：资料字段/组织/头像裁剪/签名/密码；新增受认证 `/profile` 和旧 userCenter 组件兼容。Signature Pad `5.1.4` 作为直接依赖，VCropper 复用现有实现。
- 个人资料只允许当前用户和个人字段，避免改写身份/租户/权限等。手机号未变时兼容历史重复；改密不再将明文密码放入审计事件。头像 URL 使用生产代理解析。
- 水印来自当前租户身份，不使用上游本地文字；只读偏好，实例每布局独立，异步创建/销毁受代次保护。主题/语言保存需等偏好存储落地再刷新验证。
- 最终真实 `Temp/adminnet-vben-ad64dd4018d54951a11551bf7d3fa0b9/evidence/profile-browser-baseline.json` 及清理通过；稳定截图已查看，API/浏览器/代理停止。资料/密码/水印/角色授权恢复，上传记录反查 0。
- 后端 199 项，前端 33 项，桌面契约 8 项通过；契约 `Temp/adminnet-profile-ui-5azmvz`。构建 `Temp/adminnet-vben-build-15` / `Temp/adminnet-vben-test-15`。类型/lint/build 通过，保留既有警告。
- 隔离上传支持图片 MIME。一次冷启动 `no such table: SysLang` 仅观察，后续通过。真实启动失败时要检查 stderr 的异常开头，避免输出配置或密钥。
- 下一项 16：真实首页、工作台和日程，按原实现核对数据与交互；现有 `/home` 仍重定向通知页，应恢复真实主页。未实现旧示例不能扩展成新业务。保留用户 DeepSeek.example 和提案修改，不提交。

## 最新接续：第 14 项已完成，下一项 15

- 第 13 项提交 `daa1344fd`，14 随本记录提交。总进度 14 / 48，继续逐项验收并提交，仅桌面。
- 新 `SessionLock` 采用 Antdv-Next 与真实 `sysAuth/unLockScreen`，恢复旧账号密码 SM2 解锁语义；锁屏入口直接锁定，不保存本地锁屏密码。隐藏并 inert 业务布局，独立 Modal 不受按钮偏好开关影响。
- 头部、用户下拉与布局增加可选锁屏回调；`Alt+L` 共用入口。图标按钮 `$attrs` 透传实际 button，解决 Tooltip 包装吞掉 `aria-label`。解锁请求在退出/卸载时取消，并检查会话代次。
- 最终真实报告 `Temp/adminnet-vben-30655e84e5f64e389c1a802b59298c37/evidence/lock-browser-baseline.json`：6 阶段及清理通过，截图已核验；API/浏览器/代理停止。桌面契约目录 `Temp/adminnet-lock-ui-pvPVFb`，9 项通过。
- 后端 195 项、前端会话/路由 30 项、lint/类型/前后端构建通过。构建输出 `Temp/adminnet-vben-build-14` / `Temp/adminnet-vben-test-14`。CLI lint 仍只回显参数。
- 下一项 15：个人资料、偏好与水印。当前 `layouts/basic.vue` 仍有上游帮助链接和以用户名称拼出的水印逻辑；需按旧个人设置实际字段、头像上传合同和真实水印配置核对。不要提前扩大到第 16 项首页。
- 保留用户 `DeepSeek.example` 和原提案改动，不提交。没有活动 goal（本轮查询结果为 null），不要把旧交接中的 goal active 当作当前工具状态；用户持续要求完成全部编号仍有效。

## 最新接续：第 13 项已完成，下一项 14

- 第 12 项提交 `573f0a189`，13 随本记录提交；总进度 13 / 48。继续严格编号、每项验收后提交，仅桌面。
- 旧 `/#/login?token=...` 在地址栏移除令牌后交换双令牌，用户/菜单预检完成才采用身份；保留旧 `redirect`/`params`，避免编码分隔符被重复解码。新增入口序号处理组件复用，路由离开守卫提前取消请求。
- 旧扫码只编码项目主页，未实现扫码认证；新页明确未开通。刷新接口增加 `SuppressMonitor`。
- 后端 195 项、路由 19 项、生产桌面契约 9 项通过；类型/lint/前后端构建通过。Antdv CLI lint 仍只回显。构建 `Temp/adminnet-vben-build-13` / `Temp/adminnet-vben-test-13`。
- 最终真实报告 `Temp/adminnet-vben-9c8d98dda15543a49378f09a6e9334a9/evidence/token-browser-baseline.json`：7 阶段及清理通过，稳定截图已查看；API/代理/浏览器均停止。契约目录 `Temp/adminnet-token-ui-M6WLUH`。
- 自然过期使用隔离真实短令牌，等待超过 5 秒容差后核验服务端拒绝；不使用自造过期 payload 代替。截图需等待有限动画结束，`animations: disabled` 曾截到淡入空白。
- 下一项 14：核对旧锁屏规则和当前 Vben 本地锁屏实现，完成真实解锁、刷新/失效/退出及迟到请求隔离。保留用户 DeepSeek.example 和提案改动，不提交。

## 最新接续：第 12 项已完成，下一项 13

- 第 11 项提交 `0eb5382dd`；12 随本记录提交。进度 12 / 48，goal active，继续严格编号、每项提交，仅桌面。
- 新 LDAP 页面复用 AdminTable/SDK，密码不回传，保存留空保留。后端同步组织改为按编码更新并保留主键；映射限定租户、重复校验、事务替换；查询部分失败不写入；旧 syncOrg 权限对应 syncDept API。
- 真实 OpenLDAP 容器与页面验证通过，最终 `Temp/adminnet-vben-16afcd95f2aa45559cee387e81e96f2c/evidence/ldap-browser-baseline.json` passed/cleanupPassed true；临时容器和匿名卷已删除，API 已停止。
- 后端 193 项通过，新增 2 项后 LDAP 专项 10 项通过；桌面契约 8 项目录 `Temp/adminnet-ldap-ui-f8NIHw`。lint/type/build 通过，构建 `Temp/adminnet-vben-build-12` / `Temp/adminnet-vben-test-12`。
- `run-ldap-browser-baseline.mjs` 自建带专用标签、本机随机端口的临时 OpenLDAP；不输出凭据，截图遮罩，最后核验标签后清理。镜像 `osixia/openldap:1.5.0` 仅测试用，已下载。Skill 已更新。
- 下一项 13：核对旧第三方令牌入口、回跳与扫码实际行为，沿用现有认证协议，不新增上游未实现认证。用户 DeepSeek.example 与提案修改保留不提交。

## 最新接续：第 11 项已完成，下一项 12

- 第 10 项提交 `8d39c4ebe`，第 11 项随本记录提交；总进度 11 / 48。goal active，仍要求严格逐项提交和仅桌面验收。
- 手机登录/注册完成：真实本机短信 HTTP 服务、限频/过期/消费、停用和租户拒绝、图形验证码注册、默认及自选密码登录。修复 `Copy` 遗漏密码。短信错误响应与日志不含验证码。
- 后端 185 项、桌面契约 10 项、lint/type/build 通过。构建目录 `Temp/adminnet-vben-build-11` 和 `Temp/adminnet-vben-test-11`。
- 最终证据 `Temp/adminnet-vben-76463b68a8214f4c80ab0d5b2c63124c/evidence/phone-browser-baseline.json`；passed/cleanupPassed true，隔离 API/收件器停止。契约目录 `Temp/adminnet-phone-ui-4ph1xp`。
- `run-phone-browser-baseline.mjs` 自行启动隔离 API/本机 HTTP 收件器，图形验证码输出图片路径，使用 `view_image` 后经 PTY（不回显）输入，不记录文本。Windows 后台管道需以 Ready 消息而非 execFile close 判定就绪。此经验已更新 Skill。
- 用户密钥文件与提案变更继续保留不提交。下一项 12：LDAP 配置、同步与登录，先核查现有接口、前端入口和可用隔离目录服务；不能用成功 Mock 关闭真实 LDAP 验收。

## 最新接续：第 10 项已完成，下一项 11

- 总进度 10 / 48，goal 仍 active；第 10 项随本记录提交，后续使用 `git log` 确认提交号。严格逐项完成、更新、提交再推进，仅桌面验收。
- 已实现站点品牌/Logo/版权备案页脚、匿名租户选择、方案所属租户与关联校验、明确站点保存授权、Logo 取消及异步会话保护。
- 后端 179 项、相关 Vitest 27 项、桌面生产契约 10 项通过；lint/type/build 通过，仅既有告警。API 构建目录 `Temp/adminnet-vben-build-10`，测试输出 `Temp/adminnet-vben-test-10`。
- 最终真实证据 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-12d67f4456714d11a25fc366439786e2/evidence/`；通过与清理均 true，服务已停止，Logo 和数据库作为证据保留。契约目录 `Temp/adminnet-site-ui-2Xta7k`。
- 一次浏览器登录 `D1000` 未确定原因，随后真实登录通过；保留观察，不宣称修复。真实脚本和 Skill 均已更新。
- 保留且不要提交用户 `Admin.NET/Admin.NET.Application/Configuration/DeepSeek.example` 与 `doc/frontend-vben-tickets-draft.md` 改动。后者最新范围：19/20 使用 pdfme，36 删除钉钉，37 删除 GoView，39 删除微信支付订单与退款。
- 下一项 11：桌面页面验证手机登录与注册，先核查现有短信实现与可用隔离测试服务，不发送真实短信、不用成功 Mock 关闭真实验收。

## 最新接续：第 09 项已完成，下一项 10

本节覆盖下方旧交接的当前编号。01 至 09 已完成，总进度 9 / 48，goal 仍 active。

- 08 提交 `1e3f50a3b`，09 随本记录提交。用户明确要求每项完成后提交再推进，仅桌面验收。
- 用户本轮新指令：“DeepSeek.example 里已配置了密钥，在试下”。已读取配置但未输出密钥；新增隔离开关 `-TranslationTestService`，只有显式传参才注入配置。真实 AI API、浏览器入口、译文占位符及保存落库通过。
- 后端修复翻译空批量删除、旧标识缓存残留、不存在记录写缓存及重复记录；明确翻译文件/批量/AI 授权，补对应菜单种子。共享翻译的既有数据模型不改。
- 前端表单/多语言补会话代次保护、长表单、保存关闭保护和权限按钮。隔离 Upload 配置补齐，真实 XLSX 部分错误、中文导出均通过。
- 真实目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1d5c2a2a6ceb45cd9464c6f5622d8a59/evidence/`，API/桌面 passed 和 cleanupPassed 均 true。API 已停，上传文件和 SysFile 均为 0；证据保留。
- 后端 166 项、Vitest 19 项、生产桌面契约 18 项通过。契约目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-language-ui-ofTPMi/`。lint/type/build 通过。
- 构建目录现为 `adminnet-vben-build-09` / `adminnet-vben-test-09`（系统 Temp 下）。后续不需要 AI 就不传 TranslationTestService。
- **保留且不要提交**：用户的 `Admin.NET/Admin.NET.Application/Configuration/DeepSeek.example`（含密钥）、`doc/frontend-vben-tickets-draft.md` 排版修改。不要展示这些文件的 diff 或配置值。
- 下一项 10：站点品牌、Logo、注册开关和注册方案真实验收。复用本地上传配置及第 07 项租户隔离环境，确认取消 Logo 不泄漏、失败不保存、租户选项刷新。先创建 issue 10，再实现验收并提交。

## 最新接续：第 08 项已完成，下一项 09

本节覆盖下方第 07 项交接的“当前/下一项”状态；历史说明保留。

- 01 至 08 已完成，整体 8 / 48，goal 仍 active。第 08 项随本次交接提交，使用 `git log` 核验。
- 字典租户缓存键、状态更新、父类型保护、删除顺序与失效已修复；参数按租户读写、共享定义保护、改名缓存、特殊字符键解码已修复；真实字典样式渲染及编辑会话保护通过。
- 后端 156 项（新增 13 项）、Vitest 24 项、生产桌面契约 16 项通过，2 项手机专用跳过。lint 0 错误、3 条既有警告；类型/构建通过。Antdv lint 仍仅回显参数。
- 最终真实 API/浏览器报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-dea69df8bb18453191fd45822e4d8333/evidence/`，passed/cleanupPassed 均 true。最终 `--outage` 已停止 API，证据保留。
- 最终生产契约目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-dictionary-ui-jRtbwe/`。完整矩阵在 issue 08。
- API 构建目录更新为 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-08`，测试输出为 `adminnet-vben-test-08`。
- 执行期间 `doc/frontend-vben-tickets-draft.md` 出现外部排版修改，保留并排除第 08 项提交。
- 下一项 09：语言/翻译 CRUD、模板、真实 Excel 导入、部分失败工作簿、选中导出、二进制错误与权限。先检查既有 AI 翻译配置及可用测试服务，不用 Mock 关闭真实验收。
- 未获用户委派授权，不启动子代理。继续仅桌面和既有 Skill/PowerShell/隔离环境约束。

## 当前状态

- 用户要求严格按 01 → 48 实施，每项完成验收、更新进度并提交，再整理上下文继续。已完成 01 至 26，下一项 27；整个 goal 仍然有效，不能将 26 / 48 记为整体完成。
- 仅测试桌面端，Playwright 限定 `--project=desktop`，独立脚本不创建 mobile/触屏 context。历史移动端证据保留。
- 提案来源 `doc/frontend-vben-tickets-draft.md`；其中“本轮不实施”为历史内容，不覆盖用户当前授权。
- 第 01 项 `197ecaff6`，02 `4e6fa3852`，03 `45b8a5761`，04 `e4b6c6aee`，05 `5a90350b7`，06 `e64353732`。07 与本记录一同提交，使用 `git log` 核验。
- 保留用户既有 `AGENTS.md`、`Web/playwright.config.ts` 改动，不纳入业务提交。
- 没有可调用的手动压缩工具，本文件提供精简交接用于自动压缩恢复；没有主动创建新会话或声称完成手动压缩。

## 下一项 27

访问、操作、异常和数据差异日志，无前置阻塞。

- 核对旧日志列表、详情、搜索、清空和删除能力及对应权限，恢复后端实际支持的交互。
- 用隔离账号、API 和 PostgreSQL 操作真实产生各类日志，核验分页、时间、敏感值处理、权限拒绝和详情一致性。
- 不用成功 Mock 关闭真实日志产生 / 持久化验收；生产桌面、失败反馈和清理分别记录。
- 先创建 issue 27，再按真实 API、契约、隔离 PostgreSQL、生产桌面和清理证据推进。

## 第 07 项完成摘要

- 服务端：租户菜单完整校验/同步去重/空撤销/默认主键保留；编辑关联目标保护；默认租户与主库保护；重置仅绑定租管；切换检查超管、启用状态及租管归属。
- `CreateToken` 的单点登录跳过改为请求级内部参数，保持常规登录默认行为；显式刷新保持当前切换租户。业务仓储拒绝普通用户伪造其他库/主库 TenantId 请求头；禁用或删除租户不复用已有连接。
- 前端：候选令牌不提前自动采用；资料及菜单预检通过后提交身份，失败保留原身份；预载菜单按 session version 一次消费。切换框取消会中止候选请求，旧响应不能重建退出的会话。
- 编辑/授权弹窗及密码响应有代次/会话/卸载保护；保存时禁用关闭，正文滚动；静态确认框处理请求失败，避免未处理 Promise。
- 默认 `/home` 当前兼容到已实现通知中心 `/dashboard/notice`。旧 `/home/index` 真实首页仍归第 16 项迁移，不能把通知中心当作首页任务完成。
- 最终真实 API 与桌面报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-698ee6f687214a51a431cc3fc15de869/evidence/`，均 passed/cleanupPassed true。隔离 API 已停止，5016 无监听，数据库/截图留存。单脚本 proposalComplete false 不等于整个任务未完成，完整矩阵在 issue 07。
- 最终生产契约：`C:/Users/zoyo/AppData/Local/Temp/adminnet-tenant-ui-TFxJyZ/`，18 项通过。前端 lint/type/build、相关 Vitest 18 项、后端相关 143 项（其中租户 25 项）、API 独立构建通过。
- 后端命令明确排除 `Admin.NET.Test.User.UserTest`：2 项旧 Selenium 环境测试此前 EdgeDriver 初始化失败，不计为通过。`antdv lint` 仅回显参数，实际依靠 ESLint/类型/构建/契约。

## 工具与执行

- 全部 CLI 使用 `pwsh`，首行 `$ErrorActionPreference = 'Stop'`，检查原生命令退出码；读取 UTF-8，手工改动用 `apply_patch`。
- context-mode 工具此前未检索到，不循环重试。Vue/Pinia/Antdv/Vitest 等按任务使用仓库 Skill；Antdv-Next 安装及 lockfile 为 1.5.2，先查匹配版本 info/demo。
- 真实脚本需应用 `.agents/skills/real-browser-baseline/SKILL.md`，执行后复核并更新 lessons；技能不替代当前任务验收。
- 不停止用户 Visual Studio/开发进程。API 独立构建输出：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-07`。
- 新隔离服务：`start-isolated-api.ps1 -OnlineFixture -BuildRoot <输出目录>`；清理用停止脚本的路径/PID/时间校验。`run-tenant-browser-baseline.mjs --outage` 会在最后真实停机。
- 后端使用构建后的 `Admin.NET.Test.exe --filter-not-class Admin.NET.Test.User.UserTest --progress off`，避免 MTP/VSTest 不兼容。
- 浏览器只读 SQLite 设置 busy_timeout；截图前等通知/动画并复位表格横向滚动。直接核验截图，不能将布局或接口成功当作落地页面成功。
- 第 48 项生产切换仍需独立发布授权，当前 goal 不替代它。
