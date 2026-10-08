# 编号提案上下文交接

日期：2026-10-08。

## 当前状态

- 用户要求严格按 01 → 48 实施，每项验收、更新进度并提交，然后压缩上下文继续。已完成 01、02，下一项 03；不要重新实施 01。
- 第 01 项提交：`197ecaff6`。第 02 项随本交接提交，通过 `git log -1` 获取提交号。
- 任务源：`doc/frontend-vben-tickets-draft.md`。其中“本轮不实施”是历史文档内容，不覆盖用户当前实施授权。
- 只为全部目标完成调用 goal complete；不能将 2 / 48 当作整体完成。
- 运行环境未提供显式压缩工具，已保留本交接供自动压缩恢复；不要声称已手动压缩，不创建新的用户会话。

## 下一步 03

交付真实 SignalR 登录会话、在线用户查询和强制下线。重连使用当前令牌；退出、切换租户与迟到连接不能污染新身份；事件不可重复注册。按任务源建立 `issues/03-...md`，先查既有 SDK、Hub 和旧页面，保持后端合同。04 通知将复用此连接生命周期，不在 03 发明新通知系统。

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
- 桌面与手机布局验收必须等通知和动画结束；系统 colorScheme 不保证切换应用主题，应通过实际按钮切换并断言 html 的 dark class。
- 每项分别记录契约、真实集成、视觉证据；外部服务缺失不能用 Mock 关闭验收。第 48 项生产发布仍需独立授权。
