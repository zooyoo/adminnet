# 02 手机缓存页与全局浮层可操作性

Status: ready-for-agent
Execution: complete
Blocked by: 无

## 交付

手机用户可浏览缓存键、查看值、确认删除或清空，不被偏好入口、通知与确认浮层阻挡。不改变缓存 API。

## 验收

- [x] 复现并修复手机端偏好按钮遮挡。
- [x] 分组不可删除，真实缓存键保持原编码与语义。
- [x] 桌面、手机与窄屏，明暗主题，有无通知均可操作。
- [x] 确认、取消、加载和服务失败可恢复，权限不足不能执行写操作。
- [x] 生产构建浏览器与隔离真实 API 验证缓存读取、删除、清空。
- [x] 类型、lint、相关测试、生产构建通过。
- [x] 稳定状态截图完成视觉检查，更新对应关系，随本项代码提交。

## 实现与证据

- 手机自动偏好入口进入用户菜单；保留桌面入口、无顶栏入口和显式偏好设置。浏览器验证菜单中的偏好入口仍可达。
- 手机登录通知改为底部；缓存操作使用受控确认框，失败保持选中与重试入口，防止重复提交和未处理 rejection。
- 标量值 `false`、`0`、`null`、普通文本不再被 JSON 查看器错误显示为空对象；对象查看器随明暗主题更新。
- 真实无权账号暴露路径参数拼入权限名的绕过问题。`RoutePermissionUtil` 使用已匹配路由模板的静态段解析权限；缓存详情与前缀查询映射现有查询权限，前缀删除映射删除权限。保持 URL、请求、响应和缓存 API 不变。
- 缓存管理是既有平台级管理能力，本项不新造按租户拆分缓存的协议；无权账号真实读写被拒绝。
- 最终真实证据目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-01b6cc83e1274274ab5ce4e374f87783/evidence/`。
- `cache-baseline.json`：`passed: true`，3 组真实设备流程、真实普通账号读写拒绝、真实手机停机失败反馈通过；`productionContractsPassed: true`。
- 已人工视觉检查 `cache-desktop-light-value.png`、`cache-mobile-light-value.png`、`cache-narrow-dark-value.png`，均为通知消失后的稳定状态；页面无横向溢出，删除控件未被覆盖。
- 生产浏览器契约：12 通过，2 个手机专用场景在桌面跳过。包含特殊键编码、分组不可删、明暗主题、取消、失败重试、只读权限、标量值与旧值清理。
- 前端完整单元：91 个文件、636 项通过；相关偏好与缓存树单元 7 项通过。全量运行退出码为 0，但图标选择器测试 worker 在退出阶段报告外部网络 `ETIMEDOUT`，不宣称日志无告警，不扩展修改无关图标组件。
- 后端：新增路由权限解析 13 项；职位、角色、菜单、Utils 合计 70 / 70 通过。使用已构建 `Admin.NET.Test.exe --filter-namespace Admin.NET.Test.Pos Admin.NET.Test.Role Admin.NET.Test.Menu Admin.NET.Test.Utils --progress off`，既有 `dotnet test` 的 MTP / VSTest 不兼容未更改。
- `pnpm check:type`、`pnpm lint`、`pnpm build`、`git diff --check` 通过。`antdv lint` 仅回显参数，未将退出码作为有效检查；复核安装和 lockfile 一致的 `antdv-next 1.5.2` 类型、CLI API 与 demo。
- 默认后端输出目录被用户 Visual Studio 调试进程锁定；未停止该进程，改用独立临时 `dotnet build -o`，0 错误、0 警告。启动脚本增加可选 `-BuildRoot`，只使用本次编译输出。
- 最终真实停机测试已关闭本项隔离 API，证据保留；未操作开发数据库或用户正在运行的服务。

## Comments

- 2026-10-08：第 01 项已在 `197ecaff6` 提交，工作区干净。从本项继续，遵循用户新要求逐项提交，不再以新建会话为前置条件。
- 2026-10-08：本项验收完成。早期误用 `/system/cache` 已改为真实种子路由 `/platform/cache`；早期仅模拟系统主题的伪浅色覆盖已用真实主题切换替换。保留失败发现，不以早期报告作为最终证据。
