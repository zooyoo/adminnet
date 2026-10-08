# 03 在线用户、实时连接与强制下线

Status: ready-for-agent
Execution: complete
Blocked by: 无

## 交付与验收

- [x] 真实登录创建 SignalR 会话，刷新后恢复，匿名握手不可建立有效会话。
- [x] 在线用户查询、筛选、分页、权限与多客户端强制下线目标正确。
- [x] 重连读取当前令牌，首次连接失败可恢复；退出和换租户停止旧连接。
- [x] 事件只注册一次，旧连接及迟到请求不能更新新身份。
- [x] 第 04 项可复用同一连接事件，不重复建立通知连接。
- [x] 成功、权限不足、失败、租户隔离和输入校验通过。
- [x] 生产浏览器、真实 API / SignalR、隔离数据与桌面手机视觉验收通过。
- [x] 类型、lint、相关测试和构建通过，更新进度并提交。

## 实现与证据

- 新增 `OnlineSession`，登录后创建单一身份连接；每次握手读取当前令牌，异步返回后再次校验会话版本。退出、失效、租户切换和强制下线会停止旧连接并清理事件与重试定时器。
- SignalR Hub 支持标准 `access_token` 和既有 `token` 查询参数；匿名连接被认证管道拒绝。
- 新增在线用户抽屉、筛选分页、实时状态和强制下线；服务端补齐当前租户边界、连接目标核验及迟到断开保护。
- 真实证据：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-4698caa6996b4e54bb7b8ed5b4a2facc/evidence/online-baseline.json`，`passed: true`、`productionContractsPassed: true`。
- 真实流程覆盖匿名握手、多客户端、断网重连、异租户隔离、权限拒绝、指定会话下线、令牌续期、新令牌重连、租户切换、退出清理和 API 停机重试。稳定桌面、手机截图已检查。
- 生产浏览器契约 22 项通过；前端 92 个测试文件、647 项通过；后端相关回归 82 / 82 通过。
- `pnpm check:type`、`pnpm lint`、`pnpm build`、`git diff --check` 通过；后端独立临时输出 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-03-final` 构建通过。默认输出被用户调试进程锁定，未终止用户进程。

## Comments

- 接续第 02 项提交 `4e6fa3852`，起始工作区干净。旧连接位于 `Web/src/views/system/onlineUser/signalR.ts`，旧在线用户以顶栏抽屉提供入口；新应用尚无 SignalR 依赖与接入。既有 Hub 为 `/hubs/onlineUser`，事件包括 `OnlineUserList`、`ForceOffline`、`PublicNotice`、`ReceiveMessage`。
- 采用 Microsoft SignalR 客户端，固定 `10.0.0` 与当前 .NET 10 API 对应。标准 `accessTokenFactory` 需要服务端兼容仅在 Hub 路径读取 `access_token`；保留旧 `token` 参数兼容。
- 2026-10-08：第 03 项验收完成。真实 SignalR、在线用户、权限、租户、重连和下线流程全部通过；下一项为通知发布、收取与已读闭环。
