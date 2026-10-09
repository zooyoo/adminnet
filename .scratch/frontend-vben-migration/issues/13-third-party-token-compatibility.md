# 13 第三方令牌与既有登录入口兼容

Status: ready-for-agent
Execution: completed
Blocked by: 01（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 13 项。仅桌面验收。

## 验收清单

- [x] 保留 `/#/login?token=...` 和现有回跳参数，经服务端验证后建立完整双令牌会话。
- [x] 用户、菜单、权限加载完成才采用新身份，失败没有半登录状态。
- [x] 无效、过期、撤销令牌均拒绝，地址栏移除令牌，迟到结果不覆盖新会话。
- [x] 核查旧扫码入口，未实现能力明确提示，不展示上游演示二维码。
- [x] 真实隔离 API/生产桌面、契约、工程与视觉验证通过，更新进度及交接并提交。

## Comments

- 2026-10-09：第 12 项提交 `573f0a189` 后开始。旧 `account.vue` 读取 `route.query.token`；OAuth 回调仅回传 AccessToken。旧 `scan.vue` 只将项目主页编码为 QRCode，未发现扫描认证协议。

## 实现与功能对应

- 旧 `Web/src/views/login/component/account.vue` 的 `/#/login?token=...&redirect=...&params=...` 对应新 `legacy-token.ts`、`token-login.vue`；先移除 URL 令牌，再以候选身份调用原有刷新接口取得双令牌，预检用户和菜单后采用完整身份。
- 旧业务回跳保留标量参数；拒绝外部及认证递归地址，不把认证令牌转交业务页面；保留查询值内编码的分隔符。
- 页面复用时处理新入口，离开路由提前取消请求；失败不采用候选身份，迟到请求不能覆盖当前会话。原有会话代次、权限及 SignalR 生命周期继续复用。
- 旧扫码页面只展示项目地址，未实现扫码认证；新 `/auth/qrcode-login` 明确提示未开通，不展示上游演示二维码。
- 后端刷新接口增加 `SuppressMonitor`，避免请求监控记录查询中的认证令牌。

## 工程与契约证据

- 路由 Vitest 共 19 项通过；生产桌面 Playwright 共 9 项通过，报告目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-token-ui-M6WLUH/`。契约明确使用 Mock API，覆盖双令牌、刷新、菜单失败、取消请求、重复旧链接及扫码说明。
- 后端 195 项通过；继续排除既有依赖 Selenium 环境的 `Admin.NET.Test.User.UserTest`，不计为通过。前后端构建、类型检查、lint 通过；全量 lint 保留 3 条既有警告。
- 已核对安装及 lockfile 的 Antdv-Next `1.5.2`，查询 Alert、Spin、Button 的 info/demo；采用 `title` 和 `description`。CLI lint 仍仅回显参数，不能视为组件检查通过，使用 ESLint、类型和浏览器替代验证。
- 路由导航时机通过 Context7 官方 Vue Router 文档核对：`https://router.vuejs.org/guide/advanced/composition-api`。
- 最终真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-9c8d98dda15543a49378f09a6e9334a9/evidence/token-browser-baseline.json`，`passed`、`cleanupPassed` 均为 `true`。7 个阶段包含管理员完整身份/回跳/刷新、切换为普通账号及写权限拒绝、撤销、伪造签名、真实自然过期、扫码说明、真实停机 `502`。
- 已查看成功职位页、拒绝页、扫码说明和停机页截图；最终错误态等待有限动画结束后截图，内容清晰且返回入口可达。旧截图中捕获过淡入瞬间，未作为最终视觉通过证据。
- 隔离 API 已停止，浏览器与代理已释放；未写入新业务实体，临时数据库和证据保留。已复核真实浏览器 Skill，补充路由复用、离开导航取消、编码回跳与动画截图经验。
