# 14 锁屏、解锁与退出隔离

Status: ready-for-agent
Execution: completed
Blocked by: 01（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 14 项。仅桌面验收。

## 验收清单

- [x] 沿用旧系统账号密码及 SM2 服务端解锁规则，不持久化本地解锁密码。
- [x] 锁屏遮挡并阻止受保护页面操作，刷新及关闭偏好中的锁屏入口不解除已有锁定。
- [x] 错误密码及服务失败保持锁定并允许重试，成功恢复原页面。
- [x] 令牌失效及主动退出清理会话，迟到解锁结果不影响新会话。
- [x] 真实隔离 API/生产桌面、契约、工程及稳定截图通过，更新进度并提交。

## Comments

- 2026-10-09：第 13 项提交 `daa1344fd` 后开始。旧 `layout/lockScreen/index.vue` 使用账号密码 SM2 加密调用 `sysAuth/unLockScreen`；当前 Vben `LockScreen` 仅比较本地密码，需接回既有认证接口。

## 实现与功能对应

- 原 `Web/src/layout/lockScreen/index.vue` 对应新应用 `layouts/components/session-lock.vue`；使用 Antdv-Next Modal/InputPassword/Button，沿用 `sysAuth/unLockScreen` 和 SM2 加密。错误后清空输入并允许重试，不把本地任意密码作为认证依据。
- Vben 布局、头部和用户下拉增加可选应用锁屏回调，原调用保持兼容；本应用直接锁定，头部与 `Alt+L` 共用入口。持久化锁定状态，不保存解锁密码，并清除迁移遗留的本地锁屏密码。
- 锁定时业务布局隐藏且 `inert`，通知弹窗关闭，独立锁屏 Modal 提供不透明遮罩及焦点约束；呈现不依赖偏好中的锁屏按钮开关。Escape/遮罩不能关闭。
- 解锁采用会话代次及取消信号校验；退出先取消当前解锁请求，迟到响应不能解除下一身份的锁定。退出或认证失效继续使用已有会话、路由、缓存及实时连接清理。
- 共享图标按钮显式将 `$attrs` 传给实际按钮，修复带 Tooltip 时锁屏入口缺少可访问名称；后端解锁入口增加 `SuppressMonitor`，避免请求监控记录密码参数。

## 证据

- 真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-30655e84e5f64e389c1a802b59298c37/evidence/lock-browser-baseline.json`，`passed`、`cleanupPassed` 均为 `true`。
- 真实 6 阶段：错误密码/刷新锁定、成功解锁恢复原地址、普通账号服务端解锁、真实令牌撤销后的失效登录、主动退出、真实停机 `502` 保持锁定及离线退出。业务页面不能在锁屏状态操作。
- 已查看稳定锁屏、解锁职位页和停机截图；密码输入已遮罩，受保护背景完全隐藏，主要按钮可达。API、浏览器和代理均停止；未新建业务实体，隔离库与截图保留。
- 生产桌面契约 9 项通过：`C:/Users/zoyo/AppData/Local/Temp/adminnet-lock-ui-pvPVFb/`，包含 `Alt+L`、刷新、Escape、空输入、SM2、失败重试、迟到响应与第 13 项回归。契约使用 Mock，不替代上述真实证据。
- 后端 195 项、前端会话及路由 Vitest 30 项通过；前后端构建、类型、全量前端 lint 和受影响共享组件 lint 通过。沿用排除旧 Selenium 环境测试的边界，lint 仍有 3 条既有警告。
- 已核对 Antdv-Next `1.5.2` 的 Modal/Input API 与 demo；CLI lint 仍只回显参数。真实浏览器 Skill 已复核，新增图标按钮属性透传和锁屏验收经验。
