# 07 租户授权、隔离与身份切换真实验收

Status: ready-for-agent
Execution: complete
Blocked by: 01（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 07 项。仅测试桌面端。

## 验收清单

- [x] 授权同步、空授权、遗漏字段及新菜单冲突校验，失败保留原授权。
- [x] 默认租户保护；真实 API 验证字段隔离、独立库创建及系统表留主库，真实仓储与 3 份 SQLite 补充业务跨库读写和越权拒绝。
- [x] 隔离目标建库、删除、重置租管密码，界面确认和持久化一致。
- [x] 切换租户、进入租管端的身份、菜单及数据正确；失败保持原会话。
- [x] 权限不足、输入校验、服务失败及迟到请求不能污染新身份。
- [x] 生产桌面真实集成、稳定截图、相关契约、类型检查、lint 和构建通过。
- [x] 隔离数据清理成功，进度、交接与 Skill 已更新；随本任务代码一同提交。

## Comments

- 2026-10-09：开始实施。审查发现授权新菜单未完整校验，同步租户重复及同步默认租户主键保留存在缺口；先补齐服务端回归。尚未进行本项真实集成，不计为完成。
- 2026-10-09：已修复新授权菜单与父级闭包校验、遗漏字段保持原授权、空集合撤销、同步目标去重及存在性校验、同步默认租户保留授权主键。新增 `TenantMenuGrantTests`，10 / 10 通过；涵盖冲突路由/权限/标题、不存在菜单/租户、循环/断裂父级及失败不改原授权。
- 真实 API 子集报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-639edbab18cf4df597f9a4d987b89441/evidence/tenant-service-baseline.json`，`passed: true`、`cleanupPassed: true`、`proposalComplete: false`。真实 SM2 登录、授权父级补齐、去重、遗漏字段、无效输入保留数据、普通用户 403 及空授权通过，只读 SQLite 核对写入；原授权已恢复，退出成功，服务已停止。
- 首次执行清理失败原因是脚本误用 GET 退出，已按现有 `sysAuth/logout` POST 合同修正并复跑通过。已复核 Skill，无新增通用经验；遵循现有“先核对真实合同、业务与清理分别记录”规则。
- 验证：测试项目构建通过（22 个警告），API 独立输出构建通过（0 警告、0 错误），脚本语法及 `git diff --check` 通过。全量后端共 130 项：128 项通过，2 项既有 `Admin.NET.Test.User.UserTest` 在 EdgeDriver 初始化时报 `session not created`，不得将此次全量记作通过。日志分别在临时目录 `adminnet-proposal07-test-build.log`、`adminnet-proposal07-api-build.log`、`adminnet-proposal07-tenant-tests.log`、`adminnet-proposal07-related-tests.log`。
- 尚未完成：服务端租户管理目标边界、禁用租户及默认租户保护、真实 CRUD/建库/重置、字段和库隔离、切换及租管身份、前端迟到响应与生产桌面视觉。未提交本项，继续完成后统一提交，不进入第 08 项。

### 2026-10-09 后续进展

- 修复 `UpdateTenant` 的机构/租管关联伪造，增加事务；默认租户状态、配置及隔离方式保护；字段隔离租户不能调用建库；重置密码只能指向租户绑定的管理员并清理密码错误计数。切换及进入租管端核验租户启用、账号启用与租管归属，要求当前身份为超管。
- `GetAccessTokenInNotSingleLogin` 改为请求级跳过单点登录检查，不再临时修改所有并发登录共享的缓存配置；`CreateToken` 新增内部可选参数，普通登录与刷新调用保持默认行为。
- 编辑/授权弹窗加入会话版本、组件代次与卸载检查，保存时禁用取消/关闭/Escape；正文限高滚动。重置密码迟到返回不再在离开页面后展示。
- 真实浏览器发现默认 `/home` 不存在，且菜单的 `/home/index` 首页尚由第 16 项负责迁移。新增 `/home` 兼容入口到已实现的 `/dashboard/notice`；不把通知中心当作第 16 项首页完成。自定义首页与真实首页菜单不改写。
- 最终服务和桌面证据目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-2ab0d20b9a8c4131a75f00fa0fb13110/evidence/`。`tenant-service-baseline.json` 与 `tenant-browser-baseline.json` 均 `passed: true`、`cleanupPassed: true`、`proposalComplete: false`。服务已由真实停机测试停止，5016 端口已确认释放。
- API：真实新增、修改、关联伪造拒绝、重置后真实登录、字段隔离查询、授权同步/撤销、禁用租户拒绝切换且原会话可用、超管切换与进入租管身份、租管不得冒用其他身份、默认租户保护、SQLite 独立建库及删除清理通过。独立库 integrity_check 正常且不复制系统用户/租户/机构表。
- 桌面：真实新增校验、编辑重开、授权保存、密码确认、状态切换、切换/租管身份及刷新后的通知控件、删除级联、停机 502 草稿保留及无写入通过。已查看编辑器、授权及最终进入租管端/停机截图；密码弹窗未截图。
- 最新验证：19 / 19 租户 SQLite 回归，前端修改范围 lint、类型检查、生产构建，后端 API 独立构建通过。生产 Mock 契约 15 / 15，报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-tenant-ui-x0Vabu/tenant-contract-baseline.json`，包含保存期间关闭限制、失败草稿和迟到密码响应回归。`antdv lint` 仍仅回显参数，不作为有效检查。
- 已更新真实浏览器 Skill 的通用定位与视觉验收经验；先前外层布局通过但截图含 404 的证据作废，最终脚本改为断言通知查询控件并重新截图。

### 阶段剩余验收（已由下述最终验收关闭）

1. 库隔离当前只证实建库、系统表留主库及系统数据按租户过滤；宿主没有非系统业务表，仍需隔离测试覆盖业务仓储的真实跨库读写/拒绝其他租户指定库，不能以建库成功关闭该要求。
2. `auth.changeTenant` 在拿到新令牌后清理原会话，若后续用户信息或菜单加载失败仍会失去原会话。当前通过的是切换 API 失败保留旧身份，需实现并验证后续初始化失败恢复，不能混同两种边界。
3. 继续复核租户授权后的旧身份缓存、显式刷新令牌保持切换租户、默认/跨租户管理端点边界。代码审查线索：业务仓储根据请求头 TenantId 选择连接，当前未形成测试结论；不要擅自宣布安全或漏洞已证实。
4. 补齐明亮主题及真实 UI 建库/授权撤销（API 已覆盖），完成受影响最终回归和完整审查后更新清单并提交。此前全量后端中的 2 项旧 Selenium 初始化失败仍需与本项相关检查分开记录。

### 最终验收与证据对应（2026-10-09）

| 要求 | 最终实现与证据 |
| --- | --- |
| 真实授权同步、全部撤销及现有会话失权 | API 验证 `syncGrantMenu`、撤销后原租管按钮为空且职位查询 403；桌面树逐项取消至空并保存，SQLite 确认授权为零，随后恢复原授权 |
| 字段与独立库隔离 | 真实 API 创建两类租户并按身份查询系统数据；UI 确认创建独立 SQLite；`TenantRepositoryIsolationTests` 使用真实仓储和 3 份独立 SQLite，验证不同身份读写不串库、伪造其他库及主库请求头拒绝、匹配头与显式超管选择正确。系统表按既有架构留在主库，不新造生产业务实体 |
| 默认租户与管理目标保护 | 默认租户禁止删除、禁用与建库，编辑不能改其隔离配置；修改租户不能替换既有租管/根机构；仅绑定的租管可重置密码；禁用/不存在租户不能返回业务连接，包括已有连接 |
| 身份切换成功、失败及刷新 | 真实超管切换、租管进入、刷新后的当前租户与账号一致；非超管不能切换或冒用租管。显式刷新令牌保持当前租户。候选身份采用前预取用户与菜单，响应头不提前替换原令牌，失败不注销原身份 |
| 真实初始化失败 | 浏览器先取得真实进入租管端响应，再通过真实 API 删除该隔离目标，原样交付先前响应；新资料请求实际返回 401，原超管仍可查询。只编排服务端状态，不伪造服务返回值 |
| 迟到响应、取消与退出 | 生产契约覆盖用户/菜单初始化失败时原请求令牌保持不变、保存期间关闭限制、失败保留草稿、迟到密码不再显示，以及取消候选请求后快捷键退出、迟到响应不能重建会话 |
| 桌面视觉与服务失败 | 深色编辑/授权、明亮建库列表、实际身份切换后通知控件、真实停机 502 草稿均已截图并核验。截图前复位列表横向滚动，最终无名称裁切；原缺失首页仍归第 16 项，当前无自定义首页时进入已实现通知中心 |

最终真实 API 与生产桌面目录：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-698ee6f687214a51a431cc3fc15de869/evidence/`。
两个报告均为 `passed: true`、`cleanupPassed: true`。`proposalComplete: false` 是单脚本不独立关闭整个提案的约定，本任务清单结合各层证据关闭。数据库和截图留存，测试用户/租户/关联已删除；首次读锁造成的残留已通过限定 `browser07-数字` 命名和已校验运行目录的真实 API 清理，最终复查成功。API 已停止，5016 无监听。

最终生产 Mock 契约：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-tenant-ui-TFxJyZ/tenant-contract-baseline.json`，18 / 18 通过。

工程验证：

- `pnpm lint`、`pnpm check:type`、`pnpm build` 通过。
- `pnpm exec vitest run apps/web-antdv-next/src/api/admin-interceptors.test.ts apps/web-antdv-next/src/views/system/tenant/tenant-form.test.ts`：18 / 18。
- 后端测试构建、API 独立输出构建通过；`Admin.NET.Test.exe --filter-not-class Admin.NET.Test.User.UserTest --progress off`：143 / 143，其中租户回归 25 项。
- 两项旧 `UserTest` 是依赖本机 EdgeDriver 的环境测试，前次全量在初始化失败；本次明确排除，不将它们计为通过。CLI `antdv lint` 仍只回显参数，实际使用仓库 ESLint/类型/构建/契约验收。
- 无生产数据库、外部消息或资金操作；真实浏览器 Skill 新经验已归档。后续按编号进入 08。
