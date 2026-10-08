# 编号提案上下文交接

日期：2026-10-08。

## 当前状态

- 用户要求严格按 01 → 48 实施，每项验收、更新进度并提交，然后压缩上下文继续。已完成 01、02、03、04，下一项 05；不要重新实施已完成项。
- 第 01 项提交：`197ecaff6`；第 02 项：`4e6fa3852`；第 03 项：`45b8a5761`。当前第 04 项进行中，工作区有本项未提交变更，不能覆盖或当成无关改动丢弃。
- 任务源：`doc/frontend-vben-tickets-draft.md`。其中“本轮不实施”是历史文档内容，不覆盖用户当前实施授权。
- 只为全部目标完成调用 goal complete；不能将 4 / 48 当作整体完成。
- 运行环境未提供显式压缩工具，已保留本交接供自动压缩恢复；不要声称已手动压缩，不创建新的用户会话。

## 下一步 05

交付角色授权、菜单和旧地址真实验收。核验第 04 项提交中的租户字段迁移不会破坏角色菜单；覆盖全选、半选、全部撤销、遗漏字段不改授权、服务端越权拒绝、目录/按钮/翻译/图标/隐藏/缓存/固定标签/外链/内嵌以及加载失败保留已有授权。

### 第 04 项进行中

- 第 04 项已提交前的新增包括通知 API、`NoticeInbox`、wangEditor / DOMPurify 组件、通知管理/收件视图、生产与真实隔离脚本；本项完成后统一提交，不能拆成半完成。
- 已验证：类型、应用 lint、生产构建；通知状态/实时生命周期 18 项单元；桌面手机通知合同 8 项。Playwright 自动启动的 dev server 已随测试退出，无真实服务本轮启动。
- 第 04 项已完成：wangEditor 富文本、DOMPurify、Antdv-Next Badge/Popover、旧收件地址、失败和竞态状态、租户字段与真实 SignalR 均已验收。
- 后端所有权/生命周期已推进：`SysNoticeService` 不信任输入所有权和发布状态；发布事务先提交收件记录再推送，重复发布只重发、已读时间幂等。新增 SQLite 测试 17 项，与既有相关回归共 99 项通过。**仍须处理**通知实体无租户字段、收件查询及 `SysOnlineUserService.PublicNotice` 按用户 ID 向跨租户连接推送的风险，不能据所有权校验推断租户安全。
- 新增真实服务脚本 `run-notice-service-baseline.mjs`，真实 SM2 登录及通知 API 持久化流程通过。报告位于 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-b3aa586f06d64eac8788f82503a3b72b/evidence/notice-service-baseline.json`，`passed: true`、`proposalComplete: false`；该轮隔离 API 已停止。编译输出 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-04`。继续修改后要重新构建、新建隔离运行，不复用已停止服务。
- SQLite 测试无完整 Furion 宿主，拒绝场景证明数据不被修改；HTTP 业务错误码由上述真实 API 测试补充。测试用户表是发布所需的 ID/TenantId/Account 最小投影，不能替代真实用户与租户集成。
- `NoticeInbox` 对服务端未读列表去重并以请求版本忽略旧结果，已读仅在请求成功后修改；每次 PublicNotice 或重连成功重查。不要将聊天 ReceiveMessage 的不同 ID 直接作为通知 ID。
- 第 04 项证据：真实 API `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-b3aa586f06d64eac8788f82503a3b72b/evidence/notice-service-baseline.json`；真实 SignalR `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-95be7e1e579d4211815c3ccda32d971b/evidence/notice-signalr-baseline.json`；生产 UI `C:/Users/zoyo/AppData/Local/Temp/adminnet-notice-ui-89AcQ5`。
- 当前总进度为 4 / 48，第 04 项已可提交。

## 工具与运行

- 全部 CLI 用 `pwsh`，脚本开头 `$ErrorActionPreference = 'Stop'`；手动文件修改用 `apply_patch`，文件读取 UTF-8。
- context-mode 工具检索未提供 ctx 工具，不循环重试；限量输出，日志留在临时目录。
- Vue、Pinia、antdv、pnpm、Vitest 等按实际任务加载仓库 Skill；`antdv-next` 安装与 lockfile 当前均为 1.5.2。`antdv lint` 仅回显参数，不是有效 lint。
- 用户 Visual Studio 服务占用默认 Web.Entry 输出，不停止该服务。第 02 项编译输出：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-02-198aee748de645ef9c8f9411d7a6a5ec`。
- 隔离启动脚本支持 `-BuildRoot`，只复制程序与隔离配置，不连接开发或生产数据库。最后一次隔离目录 `adminnet-vben-01b6cc83e1274274ab5ce4e374f87783` 的 API 已停止。
- 后端 `dotnet test` 存在 MTP / VSTest 不兼容，构建测试项目后运行 `Admin.NET.Test.exe --filter-namespace ... --progress off`。

## 验收注意

- 第 02 项最终证据与命令详见对应 issue。636 项前端单元断言通过，但图标选择器退出有网络超时告警，不冒称无告警。
- 真实路由权限修复使用 `RoutePermissionUtil` 从已匹配 RouteEndpoint 模板移除参数。缓存详情、前缀查询和前缀删除复用原有权限；真实无权账号读写 403。
- 第 03 项新增 `OnlineSession`、`onlineSession` 与在线用户页面；第 04 项通知必须复用这些事件和生命周期。
- 第 03 项证据：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-4698caa6996b4e54bb7b8ed5b4a2facc/evidence/online-baseline.json`，`passed: true`、`productionContractsPassed: true`。
- 桌面与手机布局验收必须等通知和动画结束；系统 colorScheme 不保证切换应用主题，应通过实际按钮切换并断言 html 的 dark class。
- 每项分别记录契约、真实集成、视觉证据；外部服务缺失不能用 Mock 关闭验收。第 48 项生产发布仍需独立授权。
