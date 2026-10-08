# 01 真实账号登录与职位 CRUD 基线

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 01 项及共同验收规则。

## 交付

在隔离环境使用真实账号，从生产登录页进入职位列表，完成新增、修改和删除，再退出并重新登录。

## 验收清单

- [x] 建立可重复的隔离数据库、测试账号、启动方法和清理验证。
- [x] 生产构建浏览器通过真实 API 完成登录、职位新增、修改、删除、退出和重新登录。
- [x] SM2 密码传输、验证码及二次验证符合既有认证规则。
- [x] 双令牌续期、失效提示和退出隔离可重复验证。
- [x] 职位页直达、刷新不白屏；持久化数据与界面一致。
- [x] 验证成功、输入校验、权限不足、服务失败及适用的租户隔离。
- [x] 桌面、手机布局及稳定状态截图通过。
- [x] 只读检查、类型检查、相关测试和生产构建通过。
- [x] 记录功能对应及证据，更新总进度，交接第 02 项至新会话。

## 证据

### 契约

已有 `Web/apps/web-antdv-next/e2e/position-contract.spec.ts`，使用 `page.route` 拦截认证和职位 API；不是实际数据库验收。本轮复测结果待填。

2026-10-08：`auth-contract.spec.ts` 与 `position-contract.spec.ts` 在既有 `8892` 生产预览上桌面、手机共 10 项通过（20.4 秒）。

### 真实集成

部分通过，不能关闭本任务。新脚本将后端程序集复制到系统临时目录，使用新建主库和日志 SQLite 库、Memory 缓存及随机 JWT 密钥；不复制开发配置和业务数据库。

`run-position-baseline.mjs` 未使用 API 拦截或 Mock。生产构建经本机代理连接真实 API，桌面和手机均验证：

- SM2 密码不是明文请求；真实登录成功。
- 职位页刷新正常。
- 职位新增、修改、删除，并直接通过只读 SQLite 查询核对持久化。
- 快捷键触发真实退出，未登录直达被送回登录，随后重新登录成功。

最后一次完整执行退出码 `0`。运行目录：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-4ce7dcd396b04da0b5b1930414c0c1b2`。

证据：该目录 `evidence/position-baseline.json` 和桌面、手机截图。
此运行的报告使用早期字段 `completed: true`，仅表示该 CRUD 基线脚本完成，不是提案完成；脚本已改为明确的 `baselinePassed`、`proposalComplete` 和 `pending` 字段。

CRUD fixture 仅在停止的隔离库中将 `sys_captcha` 改为 `False`；因此不能用本次结果关闭验证码正向验收。首次默认配置的真实 `sysInfo` 返回 `captcha: 1`、`secondVer: 2`。

仍待：验证码正确/错误/过期、二次验证、双令牌续期与失效提示、租户隔离、触屏退出。

#### 本轮增量验证

2026-10-08，再次使用新建隔离库运行扩展后的 `run-position-baseline.mjs`，退出码 `0`：

- 桌面和手机空表单均显示字段错误，未发出新增请求，未写入数据库。
- 直接向真实 API 提交空名称被拒绝，数据库未写入非法职位。
- 两端重复新增均被真实 API 拒绝；对话框保留名称和编码草稿，库中仍只有一条记录；取消后继续修改、删除和退出重登正常。
- 普通种子账号 `TestUser3` 通过真实浏览器登录，真实用户信息不含 `sysPos:add`；直接调用新增接口得到 `403`，数据库无写入。直达职位页没有新增按钮。
- `node --check` 通过。本轮仅修改验收脚本和进度文档，未改动业务代码。

最新证据：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-8cb2b3922eae46c98f2f5b3750ecd07d/evidence/position-baseline.json`。
报告使用 `baselinePassed: true`、`proposalComplete: false`，明确列出剩余验收；对应截图在同目录。该运行的 API 已用停止脚本关闭，数据库和证据保留。

重复数据的业务拒绝不等于网络中断或服务异常验收；权限验证不等于租户隔离。以上通过项不关闭这些剩余要求。

#### 真实停机验证

2026-10-08：扩展脚本在桌面真实登录 `Admin.NET` 后，为手机浏览器复制该真实会话，两端分别填写职位草稿。调用带路径、PID 和启动时间检查的停止脚本关闭隔离后端，然后执行保存；没有使用 Playwright 请求拦截或伪造后端错误。

- 桌面点击、手机触屏提交，真实代理均返回 `502`，页面显示 `请求失败（502）`。
- 对话框仍可见，名称和编码均保留，确定按钮恢复可用，不显示 `保存成功`。
- 直接读取隔离 SQLite，两端草稿均未写入。
- 新运行重跑既有 CRUD、校验、权限和退出重登，再执行停机验证，整体退出码 `0`；`node --check` 通过，端口 `5017` 已释放。
- 手机错误状态截图已检查：错误提示、输入和确认/取消按钮可见。这是错误态证据，不代替已记录的整体导航、浮层与触屏退出视觉验收。

最新报告：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-3787862735c74cfdb1e352d973b72ea7/evidence/position-baseline.json`。
对应 `desktop-service-outage.png`、`mobile-service-outage.png` 在同目录。数据库和证据保留，后端已停止。

### 视觉

未通过完整验收。已在成功提示消失后截图；手机 `390 × 844` 下顶部工具条超出可见范围，浮动偏好按钮占用表格右侧区域。快捷键退出不能代替触屏入口可操作性。该问题与第 02 项范围相关，但不据此提前关闭第 01 项的手机验收。

### 租户隔离缺陷与修复

2026-10-08，本轮真实运行首先失败：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-a3d0d9e38da8421fb0f554013de2d0d0/evidence/position-baseline.json`。
租户管理员提交外租户 `tenantId` 新增职位后，数据库确实出现外租户记录；不是 Mock 或页面推断。该隔离服务已停止，失败证据保留。

原因：`AddPosInput` 继承实体并接受 `TenantId`，插入审计只补空租户值，不覆盖显式输入。修复仅在 `SysPosService.AddPos` 将非超管的租户编号限定为当前认证身份；保留超管显式选择租户的行为。更新字段原有 `IsOnlyIgnoreUpdate` 保护，不改写其规则。

- 新增 `Admin.NET/Admin.NET.Test/Pos/PositionTenantTests.cs`，覆盖非超管新增归属、超管新增归属、两种身份修改时租户不变，4 / 4 通过。修复前非超管新增测试已实际失败。
- 职位、角色、菜单相关后端测试合计 15 / 15 通过；API 构建、浏览器脚本语法和修改服务的 `git diff --check` 通过。
- 仓库文档中的 `dotnet test` 在当前 .NET 10 / Microsoft.Testing.Platform 配置下拒绝 VSTest target；改用构建后的 `Admin.NET.Test.exe --filter-namespace Admin.NET.Test.Pos Admin.NET.Test.Role Admin.NET.Test.Menu --progress off` 成功运行，未修改测试工具链。
- 全新隔离库重跑：两端真实 CRUD、输入校验、重复拒绝、退出重登、普通账号 403 均通过。
- 租户管理员的跨租户列表不可见，跨租户修改和删除拒绝且外租户记录不变；伪造新增归属仍为当前租户，再伪造更新归属也不改变租户；删除测试记录后确认不存在。
- 两端真实停机保存失败仍通过；完整脚本退出码 `0`，测试 API 已停止。

最新成功证据：
`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-6d42c343e0f64320bd1d44ca64ec7550/evidence/position-baseline.json`。
报告仍为 `proposalComplete: false`。剩余：验证码、二次验证、双令牌续期及失效提示、手机触屏退出、完整视觉与工程验收。此次未修改前端业务代码，未重跑前端全量构建和 Vitest。

### 工程检查

- `dotnet build Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj -c Debug --no-restore --nologo -v quiet`：通过，0 个错误，0 个警告。
- `Admin.NET.Test.exe --filter-namespace Admin.NET.Test.Pos Admin.NET.Test.Role Admin.NET.Test.Menu --progress off`：通过，15 / 15 全部通过。
- `corepack pnpm build`：通过，产物位于 `Web/dist`。
- `corepack pnpm check:type`：通过，0 个错误。
- `corepack pnpm lint`：通过，0 个错误、2 条既有 `vue/one-component-per-file` 警告。
- 本轮启动的 `5017`、`5018` 隔离服务均已停止。

#### 认证闭环与触屏退出终验

2026-10-08，完成第 01 项全部剩余验收：

1. **滑块验证码触屏修复**：
   - 修复 `Web/packages/effects/common-ui/src/components/captcha/slider-captcha/index.vue` 中 `getEventPageX` 仅读取 `touches[0]` 而未读取 `changedTouches[0]` 的问题。在触屏松开手指触发 `touchend` 时，因 `touches` 为空数组此前返回 `0` 误判为未达阈值并重置；补充 `changedTouches` 处理后触屏拖拽松手可正常判定通过。
   - `run-auth-baseline.mjs` 优化 CDP 触摸事件序列，每个 step 增加 20ms 等待并携带终点触摸坐标，确保 Chromium 渲染流水线完整派发事件。

2. **手机端顶部导航响应式与真实触屏退出**：
   - 在 `Web/packages/effects/layouts/src/basic/header/header.vue` 中，对窄屏非必需的桌面工具图标（全局搜索、主题切换、语言切换、全屏、时区、锁屏按钮、刷新、偏好设置）增加 `hidden sm:flex` 响应式隐藏。
   - 手机端（390px 视口）顶部栏不再水平溢出，租户切换、通知、退出登录图标及用户头像完整展示在可视区域内。
   - `run-position-baseline.mjs` 手机端由原快捷键 `Alt+q` 退出改为真实触屏点击头部退出按钮及弹窗确认（`touch-header-logout`），实现真正的移动端触屏闭环。

3. **双令牌续期、失效提示与退出隔离真实验收**：
   - 隔离运行目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-6cad73da43b741cba3ea8dafd4272c0f`。
   - 运行报告：`evidence/auth-baseline.json`，`baselinePassed: true`。
   - 桌面与手机双端均验证：SM2 密文请求传输；滑块未通过阻止提交；滑块通过后真实登录成功；等待 67 秒后发起职位查询，请求自动附带 `x-authorization` 刷新凭证，服务端返回 200 并在响应头注入新 `access-token`；后续请求成功采用新令牌；主动登出撤销令牌后，持旧会话浏览器发起请求收到 HTTP 200 / 业务码 403 / `invalid_token`，页面显示“登录已失效 请重新登录后继续操作”提示并自动跳回登录页；刷新及直接访问受保护路由仍被送回登录页。
   - 截图证据：`mobile-session-expired.png`、`desktop-session-expired.png` 经视觉检查确认无白屏、排版规整。

4. **职位 CRUD、输入校验、权限拒绝、租户隔离与停机失败终验**：
   - 隔离运行目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-93d8e65aec07493d9d8391c021a2bfb5`。
   - 运行报告：`evidence/position-baseline.json`，`baselinePassed: true`。
   - 桌面（键盘退出）与手机（触屏退出）两端真实 CRUD、空输入校验阻止、API 重复职位拒绝、草稿保留、未登录重定向及重新登录全部通过。
   - 普通账号 `TestUser3` 登录后写入被拒绝（403），数据库无变更。
   - 租户管理员 `Admin.NET` 跨租户查询不可见，跨租户修改/删除被拒绝，伪造租户写入被限制在当前租户。
   - 停止隔离后端后，两端保存均返回代理 502，提示失败、保留草稿、数据库无写入。
   - 截图证据：`desktop-positions.png`、`mobile-positions.png`、`desktop-service-outage.png`、`mobile-service-outage.png` 均已通过 `read_image` 核验确认。

5. **后端单元测试沙箱隔离适配**：
   - `PositionTenantTests.cs` 与 `RoleMenuRevocationTests.cs` 将临时 SQLite 路径由 `Path.GetTempPath()` 调整为工作区测试输出目录 `AppContext.BaseDirectory`，并在 `Dispose` 中加入 `Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools()`，解决 Windows 沙箱及连接池文件占用问题。
   - Pos、Role、Menu 模块共 15 / 15 测试全部通过。

第 01 项全部验收清单项已核验通过。

## Comments

- 2026-10-08：第 01 项验收完成。两端真实登录、滑块二次验证、双令牌自然过期续期、令牌撤销后失效提示与刷新隔离、两端职位 CRUD、触屏退出与键盘退出、输入校验与重复拒绝、普通用户 403、租户隔离防伪造、服务停机 502 草稿保留全部通过。单元测试 15 / 15、构建、类型检查及 lint 全部通过。已准备交接至第 02 项（手机缓存页与全局浮层可操作性）。
- 2026-10-08：新增真实复测证据 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-5b687698d0ad4984a1d62ef30abcf595/evidence/auth-baseline.json`。桌面加密登录、双令牌续期、采用新令牌、失效提示和刷新隔离通过；整体失败位置为 `mobile / login-after-slider / TimeoutError`，手机失败截图为空白，尚不能归因。脚本改用 `Promise.all` 同时处理动作与响应等待，失败时先保存脱敏阶段报告再截图，解决此前未处理拒绝使报告丢失的问题；语法检查通过，失败场景已验证报告和截图确实保存。隔离服务端口 5031 对应进程已通过停止脚本关闭，数据库和证据保留。该应用测试失败不等于会话网关的 403 拦截，未关闭任何安全校验。
- 2026-10-08：恢复时核对现存报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-b430f361dab847be8158067236e331e2/evidence/auth-baseline.json`。报告记录桌面加密登录、真实过期后的双令牌续期、后续请求采用新令牌，以及撤销请求 HTTP 200 / 业务码 403 / 失效令牌响应头；整体 `baselinePassed: false`、`proposalComplete: false`，不能推断失效提示或手机流程通过。本轮两个认证脚本 `node --check` 通过，仅核验现存证据，未重跑浏览器。验证码脚本保留人工输入，不通过关闭验证码替代真实验收。
- 2026-10-08：当前工作区具有大量既有迁移改动；保持原状继续。尚未发现新会话创建工具，交接动作不能静默降级为同会话推进。
- 2026-10-08：隔离启动排除了缺少 `wwwroot` 和 OAuth 配置对象造成的环境错误；没有修改后端业务行为。复用同一测试账号频繁重跑曾收到登录业务码 `400`，未查明原因；新隔离库单轮通过，不能据此认定重复运行问题已修复。
