# 编号提案上下文交接

日期：2026-10-09。

## 当前状态

- **最新用户要求：只测试桌面端，不需要测试 mobile 端。** 后续浏览器命令必须限定 `--project=desktop`，独立脚本只建桌面 context，不再跑手机、触屏或窄屏；保留已有历史测试，不做无关删除。
- 用户要求严格按 01 → 48 实施，每项验收、更新进度并提交，然后压缩上下文继续。已完成 01 至 06，下一项 07；不要重新实施已完成项。
- 第 01 项：`197ecaff6`；第 02 项：`4e6fa3852`；第 03 项：`45b8a5761`；第 04 项：`e4b6c6aee`；第 05 项：`5a90350b7`。第 06 项与本交接一同提交，使用 `git log -1` 确认。
- 任务源：`doc/frontend-vben-tickets-draft.md`。其中“本轮不实施”是历史文档内容，不覆盖用户当前实施授权。
- 当前没有活动 goal；不能将 6 / 48 当作整体完成。
- 运行环境未提供显式压缩工具，已保留本交接供自动压缩恢复；不要声称已手动压缩，不创建新的用户会话。

## 下一步 07

租户授权、隔离与身份切换真实验收：授权同步、空授权、默认租户保护、字段/库隔离、隔离目标建库/删除/重置租管密码、换租户或租管端身份及失败保持原会话。仅桌面测试。

### 第 06 项压缩交接摘要

- 用户服务新增管理目标及关联租户校验；注册仍沿用内部注册方案，不调用公开管理授权接口。修改前读取原角色/机构，再按变化强制下线；真实 SignalR 事件已验证。
- 机构新增/移动验证父级存在、租户和管理范围；循环拒绝，租户/创建者字段不可伪造。新增 5 项 SQLite 回归。
- 用户/机构编辑器限制正文滚动、居中，保存时禁止关闭；加载、异步校验及保存前后检查会话版本。重置密码迟到响应不泄露到新身份页面。
- 真实 API 报告在 `adminnet-vben-99867a69a67b4178a1fd7beb8d5a1688/evidence/user-service-baseline.json`；最终桌面报告/截图在 `adminnet-vben-191ac77ef09a4437b2b727430f5b2c34/evidence/`。路径父级均为 `C:/Users/zoyo/AppData/Local/Temp`。两者通过且清理成功，服务已停止。
- 前端 lint/type/build、相关单元 15 项、桌面生产契约 30 项、后端相关 118 项通过。CLI lint 仍仅回显参数，不作有效检查。详见 issue 06。
- 当前用户既有 `AGENTS.md`、`Web/playwright.config.ts` 修改保留，不纳入业务提交。没有可主动调用的压缩工具，本摘要用于后续自动压缩恢复。

### 第 05 项已完成

- 修改 `SysRoleService` 及 `RoleMenuRevocationTests`：角色管理边界、逐目标菜单校验、普通账号不可转授、校验前置、角色身份字段不可伪造、数据范围输入保护；20 项角色测试通过，相关后端共 113 项通过。
- 修改角色/数据范围弹窗：正文限高，手机确认按钮可见，保存时禁用关闭。角色编辑加入会话版本及卸载代次保护；真实手机已复现旧问题并确认修复。
- `access-admin-contract.spec.ts` 加全选/半选和撤销检查，并补默认 API 拦截，旧 fixture 会将新增通知请求发往用户开发服务并使 Mock 登录失效。24 项双端合同现通过；不要删除隔离拦截。
- 新增 `run-role-service-baseline.mjs`、`run-role-browser-baseline.mjs`。API 验证包含权限撤销后旧会话和重登变化、跨租户拒绝、菜单 Vben DTO；浏览器验证双端真实编辑/全选/撤销/恢复叶子/目标重登按钮与数据范围保存。报告均 `passed: true`，`proposalComplete: false`。
- 真实运行目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-4f270eaafb1a42bfbbceab811797dba8` 已停止；证据在其 `evidence/`。后端临时输出 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-05`，不终止用户默认输出目录中的调试进程。
- 后续已补齐：真实部门/自定义/全部范围查询过滤与缓存失效；翻译保存、重登和更新刷新；生产浏览器真实缓存/隐藏/固定标签/外链/内嵌交互与旧地址；桌面明暗截图。用户已取消手机/窄屏验收。
- 测试复跑须新建 `-OnlineFixture` 隔离服务；浏览器脚本会先把专用 `isolated-online-read` 角色恢复为职位查询叶子。测试菜单使用唯一前缀并在服务脚本中删除。
- 最新前端 lint、type、build 和 665 项单元断言通过；全量有既有 icon-picker 退出网络超时告警。后端相关 113 项、桌面生产合同 12 项通过，第 05 项关闭。
- 最终真实报告目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1755242804ac4bc7bba5ed7e31ae3607/evidence/`；桌面生产合同报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-access-ui-CKnF20/`。隔离 API 已停止。
- **保留并行修改**：`Web/playwright.config.ts` 留有用户切换默认 Chromium/CI trace 的改动，我仅修正非法引号和 `isCI` 缺失；不将该文件纳入第 05 项提交，不回退。已安装 Chromium headless shell；现可运行 `--project=desktop`。

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
