# 04 通知发布、收取与已读闭环

Status: ready-for-agent
Execution: complete
Blocked by: 03

## 交付与验收

- [x] 管理员可真实新增、编辑、发布和查询通知，保留既有权限与草稿规则。
- [x] 在线目标通过第 03 项 `onlineSession` 收到真实 `PublicNotice`，同一通知重复事件不重复展示。
- [x] 通知详情、单条已读、全部已读后未读列表和数量一致。
- [x] 离线用户重新登录后从 `GetUnReadList` 恢复未读；跨租户不串收件人。
- [x] 服务失败、权限不足、重复事件和断线恢复可反馈且不伪造成功。
- [x] 桌面、手机、明暗主题和稳定状态截图通过。
- [x] 前后端测试、类型、lint、生产构建、真实 API / SignalR 验收通过。

## Comments

- 接续第 03 项提交 `45b8a5761`。通知事件必须复用 `Web/apps/web-antdv-next/src/api/realtime.ts` 的 `onlineSession`，不在通知组件中创建 HubConnection。
- 后端现有 `SysNoticeService.Public` 会为所有用户生成 `SysNoticeUser` 未读记录并调用 `PublicNotice`；前端还没有新通知管理页或真实通知状态接入。
- 2026-10-08：已接入通知管理 API、草稿页面与发布/删除确认框，新增接收通知页面及顶栏通知中心抽屉。`NoticeInbox` 通过服务端重查处理 `PublicNotice`，对重复 ID、加载竞态、已读失败、并发已读及身份切换迟到响应做隔离；未混用聊天 `ReceiveMessage`。
- 当前检查：类型检查、应用 lint、生产构建通过；`notice-inbox.test.ts` 7 项和 `online-session.test.ts` 11 项合计 18 项通过；通知管理/收件箱浏览器合同桌面手机合计 8 项通过。开发日志仍有 `ResizeObserver loop completed with undelivered notifications`，未宣称无告警。
- **仍未完成，不得提交为验收完成**：目前编辑与详情仅为临时纯文本，必须恢复旧富文本编辑与安全展示；顶栏仍复用 Vben 通知组件，需按 Antdv-Next 自有业务 UI 要求完善未读数量、清空语义、失败提示和移动端布局；完整收件页旧地址及同步已读也需检查。
- 后端风险尚待修复和验证：`UpdateNotice` 信任请求的 `CreateUserId`；`Public` 重复调用会重建收件记录并清空已读状态；通知实体不带租户字段，发布收件人及同账号切换租户时的读取范围需要实测并显式约束，不能凭现有用户过滤假定隔离成立。
- 2026-10-08（完成）：第 04 项所有验收条件关闭。新增 `EntityBaseTenant` 通知和 `EntityBaseTenantId` 收件记录；发布目标、收件查询、未读查询和在线推送均使用当前租户。`SysOnlineUserService.PublicNotice` 按通知租户过滤连接。
- 管理员通知页使用 wangEditor Next 6.5.0，支持旧 HTML 回显、表格、格式、图片上传、生命周期销毁及编辑器内 `sanitizeHtml`；`DOMPurify 3.4.16` 清理详情和通知预览，剥离脚本、事件属性、嵌入框架和危险样式。
- 顶栏通知改为 Antdv-Next Popover + Badge，自有通知列表支持未读数量、刷新、全部已读、失败重试、详情和收件中心；`/dashboard/notice` 旧地址保留并要求登录。
- 前端通知状态由 `NoticeInbox` 管理，按通知 ID 去重，保护刷新竞态、重复事件、身份切换迟到响应、并发已读和部分全部已读失败。
- 后端通知单元及既有相关回归 99 / 99 通过；前端全量 94 个测试文件、665 项通过；通知浏览器合同 19 项通过（含桌面/手机、富文本、危险 HTML、通知中心、旧地址、窄屏浅色）；生产构建、类型检查和 lint 通过。
- 全量前端单元退出阶段仍有既有 icon-picker 测试 worker 网络 `ETIMEDOUT` 告警，断言为 665 项通过；未修改无关图标组件，也未宣称日志无告警。
- 真实 API 基线：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-b3aa586f06d64eac8788f82503a3b72b/evidence/notice-service-baseline.json`，`passed: true`，覆盖 3 个真实 SM2 账号、草稿所有权、权限、发布、未读、已读和重复发布。
- 真实生产浏览器 + SignalR：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-95be7e1e579d4211815c3ccda32d971b/evidence/notice-signalr-baseline.json`，`passed: true`、`proposalComplete: true`；覆盖同租户实时收取、跨租户无未读、详情已读和离线 API 查询一致。稳定截图为 `notice-signalr-reader.png`；生产 Mock UI 报告为 `C:/Users/zoyo/AppData/Local/Temp/adminnet-notice-ui-89AcQ5`。
- 未连接生产数据库、未发送真实外部消息；所有隔离 API 已停止，数据库与证据保留。
- 2026-10-08（后端推进）：上述所有权和重复发布问题已修复。新增通知只接收可编辑字段并创建当前用户的草稿；更新查询数据库所有权，不信任 `CreateUserId`，条件写入阻止已发布记录被覆盖。发布状态与收件记录使用事务，提交之后再推送；重复发布重发已有收件通知，不重置记录 ID、发布时间或阅读状态。重复已读保留首次阅读时间。
- 新增 `Admin.NET.Test/Notice/NoticeMutationTests.cs`：17 项 SQLite 测试覆盖伪造字段、越权修改、已发布保护、重复发布、事务回滚、推送失败重试、首次提交可见性等；独立 SQLite 连接验证推送前事务已提交。此前 8 项中 7 项先失败，修复后通知与既有相关后端测试合计 99 / 99 通过。
- 后端 API 使用独立临时输出 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-04` 构建，0 警告、0 错误；未终止用户调试进程。
- 新增 `run-notice-service-baseline.mjs`，以真实 SM2 登录验证新增、伪造字段纠正、普通账号 403、他人通知修改拒绝、编辑发布、真实未读读取、已读和重复发布持久化一致、已发布编辑删除拒绝。证据：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-b3aa586f06d64eac8788f82503a3b72b/evidence/notice-service-baseline.json`，`passed: true`、`proposalComplete: false`。
- 本次真实 API 基线没有连接浏览器或 SignalR，不能覆盖完整交付；租户隔离仍未实现/验证，富文本和完整视觉仍待完成。隔离 API 已停止，数据库和证据保留，当前未提交第 04 项。
