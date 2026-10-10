# 提案 31：开放访问与签名调用

- Status: ready-for-agent
- Execution: completed
- Started: 2026-10-10
- Completed: 2026-10-10
- Proposal: doc/frontend-vben-tickets-draft.md 第 31 项

保留开放身份明文展示、22 字符密钥、九 HTTP 方法、HMAC-SHA256 / Base64、METHOD&PATH&ACCESSKEY&TIMESTAMP&NONCE 与四个原 sysOpenAccess:page/add/update/delete 权限。帮助全部使用占位符。

## 验收

- [x] 查询分页、真实 CRUD、删除确认 / 取消、失败草稿和生成合同。
- [x] 最小绑定候选、切租户清旧用户、存在 / 有效 / 租户一致 / 账号级别校验。
- [x] PostgreSQL 持久化、真实签名身份、篡改 / 过期 / 重放 / 轮换 / 删除后拒绝。
- [x] 有效输入权限拒绝、迟到响应、身份变化、KeepAlive 离页和真实停机。
- [x] 后端 / 前端单元、类型、正式源码 ESLint、API / Test / 生产构建。
- [x] Edge 生产桌面 Mock 契约、真实流程与明暗视觉分别通过。
- [x] 主结果与临时记录、API / 浏览器 / 代理 / PostgreSQL 清理独立通过。

## 实现

- 新 system/openAccess 页面兼容 /platform/openAccess 和旧 Component。绑定候选与密钥生成允许 add 或 update，签名生成映射 page；非超管只管理本租户且不得绑定更高账号级别，999 可跨租户。候选与鉴权身份投影不读取密码 / 连接。
- 鉴权鲜读有效绑定，validated 与身份 claims 共用本请求快照；禁用租户 / 用户、轮换 key / secret / 绑定和删除立即使旧身份失效。保留 UTF-8 密钥、秒 / 毫秒时间戳，检查路径 / 单值 Header / Base64 / 时间窗。合法鉴权后才消费 nonce，TTL 覆盖时间窗；单进程锁防本实例并发重放，不宣称跨实例原子保证。
- 请求可取消、固定错误反馈、忙时防重；租户变更清用户，身份 / 权限 / KeepAlive 边界释放敏感状态、拒迟到，失败保留 draft。删除取消不发请求，密钥 / 签名不写存储、console、通知；截图遮挡真实凭据。
- 共享日志脱敏加入 accessKey / accessSecret / sign 及分隔符变体，覆盖 JSON、文本、查询串、差异列和参数。原 CRUD 使用 SuppressMonitor 且不触发差异审计，真实审计条数与脱敏单元分别记录。

## 最终证据

- API / Test 构建和后端 200 / 200、0 跳过：开放访问 133 + 路由权限 53 + 日志脱敏 14。日志 open-access-api-build.log、open-access-test-build.log、open-access-unit-tests.log。组织 Type=null 的空引用已修复并新增直接回归。
- 前端 112 / 112：本项 35 + 历史 77；类型、正式文件 ESLint、严格 E2E TypeScript、生产构建通过。日志 open-access-frontend-tests.log、open-access-frontend-a11y-typecheck.log、open-access-frontend-a11y-eslint.log、open-access-e2e-final-types.log、open-access-production-build.log。fixture 13 条既有强制 ESLint 问题保留；默认 ignore / 仅参数回显的 antdv lint 不计有效验证。
- 生产桌面 Mock 11 / 11，29.5 秒。仅 --project=desktop / Edge，验证 /jse/ hash module 并拒 Vite；open-access-desktop-contract.log、Web/test-results/open-access-desktop-contract/。
- 最新真实报告 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-df55f333997141acb36d80a84984fb30/evidence/open-access-browser-baseline.json：passed=true、cleanupPassed=true、20 阶段、执行器 exit0；26 个 HTTP 200 / 业务 401 的签名拒绝均核验 error 与空身份，8 个相同 nonce 并发仅 1 成功。
- 全部三连接 PostgreSQL；授权普通账号、最小候选、跨租户保护、九方法独立 Node HMAC、秒 / 毫秒、身份 claims、非法 / 篡改 / 过期 / 未来 / 重放、禁用 / 轮换 / 删除、page-only 与 add/update-only 有效参数权限均真实通过。
- 生产浏览器实际生成密钥与签名、CRUD / 换租户 / 重复保存失败 / 删除取消确认 / 离页 / 最后停机草稿通过；密钥签名不出现在存储或 console。审计实际 35 条操作、0 条差异，进程 / 审计无凭据；差异管道由单元验证，不声称本项真实触发。
- 已实际查看最终真实明暗表格、编辑 / 签名 / 帮助、保存失败与停机图；凭据遮挡。独立 Mock 明暗 760×598 帮助完整可读、通知和动画稳定，全部占位符。
- fixtureRecordsRemoved / containerRemoved / apiStopped 均 true，cleanupErrors=[]。临时开放配置、租户、用户、机构 API 删除后 PG 反查 0；浏览器 / 代理 / API / 标识容器及卷已清理。

## 过程与经验

- 首轮 Mock 2 / 11 的 DOM 显示星号进入名称、组合 Input 无标签、同名关闭按钮；修复唯一直接控件 / suffix、aria-hidden 装饰、自动标签并保留 required，关闭限定 footer。别名过渡等待目标页 count=1；最终 11 / 11。
- 首轮真实 false / cleanup true（Temp/adminnet-vben-53b83eefd6fa45e4af438110fd8e39bc）：脚本误要求 HTTP401/403。核对 AdminResultProvider 后严格验证 HTTP / 业务鉴权码 / error / 空身份，使用有效参数测试权限并逐个检查并发失败者；最新完整重跑通过。
- 复核 real-browser-baseline 与 lessons，记录已验证的表单关联、统一响应、通知截图、实际审计条数经验。用户 AGENTS.md / 原提案文档、日志 / 查询 JSON / 本地缓存 / 输出路径不提交。

整体 31 / 48、goal active，下一项 32 区域管理。第 47 项前不清旧前端，第 48 项生产切换遵循独立授权。提交信息：feat(前端): 完成提案31开放访问与签名迁移。

复验入口：run-open-access-browser-baseline.mjs、run-open-access-desktop-contract.mjs、open-access-playwright.config.mjs（本目录的父目录），以及 Web/apps/web-antdv-next/e2e/open-access-contract.spec.ts。日志均位于 .scratch/frontend-vben-migration/，Temp 和 Web 产物例外；无生产连接或真实凭据入库。
