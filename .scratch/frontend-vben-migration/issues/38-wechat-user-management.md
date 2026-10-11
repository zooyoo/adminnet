# 38：微信用户管理

Status: done
Execution: completed

## 目标与验收

迁移既有微信用户资料管理，完成查询、分页、新增、编辑、删除和头像显示；保留平台类型与标识语义，验证权限和租户边界、失败保留输入及防重复提交。仅生产构建桌面浏览器、真实隔离 PostgreSQL/API；不访问外部微信服务、不发送消息或支付。

## 待办

- [x] 核验第 37 项交付及第 38 项宿主门禁。
- [x] 阅读现有实体、CRUD、OAuth 与小程序记录创建流程。
- [x] 接入管理专用输入输出、明确授权与关联账号租户边界。
- [x] 实现前端资料管理与请求生命周期处理。
- [x] 完成回归、构建、真实权限与桌面验收、清理和截图检查。
- [ ] 更新进度、独立提交并压缩接续。

## Comments

### 门禁与第 65 轮源码核对

第 37 项提交 0423d6268。review-next-38.mjs 与正式 CLI --next 38 --host-url http://127.0.0.1:19387 --review-file .scratch/proposal-agent-lifecycle/next-38-review.json 均退出 0，reviewed-clear、blockers=[]；17 个历史成员与额外只读侧会话及原始证据哈希核验一致。当前仅 Lead，没有新建子智能体。原超长会话无需唤醒。

源码事实：SysWechatUser 继承 EntityBase，没有 TenantId；UserId 关联 SysUser。OAuth 创建记录时填写 UserId，小程序 GetWxOpenId/GetWxPhone 创建未绑定记录（UserId 默认 0）。管理 CRUD 原来直接接受和返回完整实体，包含 SessionKey/AccessToken/RefreshToken。旧编辑器仅昵称输入，新增不能填写必需的 OpenId；平台枚举为公众号 1、小程序 2、QQ 3、Alipay 4、Gitee 5。

实施决定：保持实体与认证流程不变；管理分页通过关联系统账号解析租户，普通租户仅能维护本租户绑定记录，超管可维护未绑定记录；新增/改绑检查目标账号，更新/删除同时校验旧归属，禁止依赖客户端 TenantId。专用 DTO 仅允许平台、标识和个人资料字段，管理列表不输出令牌或会话密钥，更新须保留原凭据与创建审计。未知平台/无效分页/越权写入需明确拒绝并验证数据库无变化。未绑定资料保持超管可管理，不自动把历史未绑定记录分配租户。

已新增 WechatUserProfile.cs 输入/输出白名单类型，尚未接入服务，当前接口行为仍未改变。构建日志 wechat-profile-build.log；本项未完成、未提交，不将 DTO 编译等同于业务验收。

### 第 66 轮：管理约束与权限回归

- RoutePermissionUtil 将 sysWechatUser:* 纳入显式授权检查，包含大小写回归；不将 sysWxOpen:getWxOpenId 纳入此管理权限范围。
- 新增 WechatUserContracts：输入字段与平台校验、头像路径协议约束、基于关联账号租户的访问判断，以及仅复制资料字段的 Apply。保留 SessionKey、AccessToken、RefreshToken、Scope、ExpiresIn 和原 Id；选填资料允许清空。
- 新增 WechatUserContractTests，与 RoutePermissionUtilTests 合计 77/77 通过；独立测试构建成功，日志 wechat-test-build.log / wechat-contract-tests.log，pwsh-109 退出 0。
- 约束尚未接入 SysWechatUserService 的 CRUD，因此不能宣称管理接口已完成租户隔离或凭据脱敏。下一步接入查询投影、旧归属和目标账号检查、数据库字段白名单及真实接口验收。本项未提交，总进度仍 37/48。

### 第 67 轮：服务层接入

- SysWechatUserService 注入 UserManager；分页增加平台与租户条件，LeftJoin 系统账号解析 TenantId，显式投影 WechatUserProfileOutput，不输出认证凭据。
- 新增采用 WechatUserProfileInput，新建实体后仅复制资料字段；更新采用带 Id 的白名单输入，先校验原记录及目标账号，再只更新资料和修改审计列，保留创建信息及凭据。更新/删除数据库条件均包含 Id 与原 UserId，普通租户附关联账号租户子查询；更新另在 SQL 条件内核对目标账号仍存在且归属有效。
- 首次编译误用 SysUser.IsDelete，已读取实体基类确认 SysUser 不含软删除字段后修正。最终测试构建通过，77/77 回归通过（pwsh-112 退出 0），日志 wechat-service-build.log / wechat-service-tests.log。
- 尚待真实 PostgreSQL 验证查询投影、全局过滤器与关联子查询生成，新增账号归属检查与插入之间的并发窗口也需核对；不得把现有纯约束回归当作实际 CRUD 验收。前端与真实权限、浏览器验收尚未完成，未提交。

### 第 68 轮：实际 SQL 生成回归与隔离 API 构建

- 提取 WechatUserContracts.UpdateQuery，服务直接使用该查询，避免测试复制 SQL 条件。普通租户无有效 TenantId 或试图绑定 UserId=0 时拒绝。
- 新增 WechatUserSqlTests：使用 PostgreSQL SqlSugar ToSql 验证实际生成语句含原归属及目标归属两个 EXISTS、Id/原账号/目标账号/租户参数；资料空值仍写入，凭据、创建审计不进入 SET 或绑定参数。
- 构建与测试通过：wechat-sql-build.log、wechat-sql-tests.log，80/80，pwsh-114 退出 0。隔离 API 输出 wechat-api-build 构建通过（wechat-api-build.log，pwsh-115 退出 0）。
- 本轮没有连接数据库；SQL 生成回归不能证明实际执行、全局过滤器及并发行为。真实 PostgreSQL/API、前端和 production desktop 验收仍待完成，第 38 项未提交，37/48 不变。

### 第 69 轮：前端资料契约与编辑草稿

- 加载 vue、antdv、antdv-next、ui-ux-pro-max，沿用现有后台交互规范。安装组件库版本 1.5.2；Modal info/demo 已保存 wechat-modal-info.json / wechat-modal-demo.json，尚需读取及核验其返回内容后写组件。
- 新增 api/system/wechat-user.ts，接口使用资料 DTO，不依赖包含凭据的旧生成模型；新增 views/system/weChatUser/wechat-user-form.ts，白名单创建草稿，保留账号 ID 字符串，验证平台、长度、必填、性别及头像路径。
- 对实际草稿函数直接运行 Node 断言通过，覆盖凭据/租户字段排除、源记录不变、Int64 字符串上限、普通租户禁止未绑定、头像协议边界。尚无 UI 组件，未做真实浏览器验收。
- 首次类型检查误选应用目录的 vue-tsc 路径，MODULE_NOT_FOUND；已改用 Web/node_modules 下实际工具运行 pwsh-121，结果见 wechat-frontend-typecheck.log。

### 第 70 轮：微信用户列表与编辑弹窗

- 新增 views/system/weChatUser/index.vue，与 SysMenuSeedData 中 /system/weChatUser/index 匹配；昵称/手机号/平台分页查询、超管租户筛选、新增、资料编辑、删除确认及头像失败回退已接 API。
- 请求跟踪 SessionBoundary，身份/租户/权限变化清空数据及草稿并取消旧请求，页面停用/卸载同样处理；页请求序号拦截旧结果，保存/删除同步 busy 防重复，保存失败保留草稿。
- 读取 antdv-next 1.5.2 的 Modal/Form/Input/Select/Table/Button/Alert info 与 basic demo 后编码。类型检查发现 Select 返回值过宽，已显式收窄性别为 0/1/2/null。Prettier 与 vue-tsc 最终通过（pwsh-127 退出 0），日志 wechat-page-format.log / wechat-page-typecheck.log。
- antdv lint 仅回显 Parsed args，未执行实际扫描，不能以退出 0 当作 lint 通过。组件库类型检查通过，仍需项目 ESLint、真实权限与生产构建桌面联调。
- 未提交，未更新完成数；新增并发归属边界、真实 PostgreSQL 执行和浏览器验收仍未完成。

### 第 71 轮：生产构建与首轮真实集成启动

- ESLint 修复 7 项导入/类型排序后通过；Vite production 构建通过，pwsh-130 退出 0，日志 wechat-eslint.log / wechat-production-build.log。
- 应用 real-browser-baseline 技能，复用既有隔离 API/PG 启动、路径与容器标签核验、脱敏报告及 finally 清理。新增 wechat-browser-flow.mjs / prepare-wechat-browser-baseline.mjs / run-wechat-browser-baseline.mjs，语法检查后以 pwsh-131 启动；运行日志 wechat-browser-baseline.log，最终结果尚待读取。
- 首轮范围：实际生产页面登录、新增、PG 持久化、输出排除凭据、更新清空城市且保留凭据及创建审计、编辑回显、确认删除、真实停机留草稿。不能将首轮通过视为完整第 38 项交付；权限租户矩阵、新增并发归属及防重复仍待覆盖。
- 已复核技能，无新增已验证通用经验。尚未提交，总数 37/48 不变。

### 第 72 轮：权限矩阵准备与隔离启动观察

- pwsh-131 仍在运行，尚无业务阶段输出，不认定成功或失败。已核对 5038 的真实 marker：plugin-startup-runtime-f23735aa82942d7b2bc2fad3dbced45c.json，运行目录 Temp/adminnet-vben-711baf03834941e088a3c7fb818ae795；dotnet 仍运行，stderr 当前为空。不要仅因输出为空终止测试。
- 新增 wechat-permission-flow.mjs，node --check 通过；目前尚未组合进 runner、尚未执行，需先扩展租户及关联清理。矩阵使用 API 创建独立租户，grantMenu/goTenant 后验证实际 buttons；覆盖已授权本租户更新、外租户查询/新增/改绑/修改/删除拒绝、普通租户未绑定拒绝、匿名/未授权/只读拒绝，并逐次比较整表摘要证明拒绝不写入。
- 复用参考 run-template-browser-baseline.mjs 的 grant/createTenant/关联清理模式。后续组合时补齐租户、角色、账号及关联残留验证，不能只删除 syswechatuser。当前技能复核无新增通用经验。
- 目标 active（revision 26，roundsStarted 72）；第 38 未提交，总进度 37/48。

### 第 73 轮：首轮真实结果、定位修正与权限清理

- 首轮 pwsh-131 退出 1，报告 Temp/adminnet-vben-711baf03834941e088a3c7fb818ae795/evidence/wechat-browser-baseline.json：passed=false，cleanupPassed=true，cleanupErrors=[]，fixtureRecordsRemoved/containerRemoved/apiStopped=true。生产真实页面加载阶段通过，新增 OpenId 精确名称 locator.fill 超时；未执行新增保存。
- 已实际查看 failure.png；弹窗布局完整，按钮可达。failureDom 证实唯一可见 INPUT id=wechat-editor_openId。将该字段定位修正为弹窗内唯一 ID，node --check 后 pwsh-143 重跑，仍待报告。尚不能宣称修正已通过或业务 CRUD 成功。
- wechat-permission-flow.mjs 补齐 cleanupWechatTenants：恢复部分创建租户归属、收集关联账号/角色、逐项删除、核验 7 类租户实体与用户/角色关联残留；node --check 通过。尚未组合及执行矩阵。
- Edit 工具遇到 ReplaceFileW EIO，使用 PowerShell UTF8 定点替换成功，不涉及文件权限提升。技能复核无新增已验证通用修复（定位修正仍待验证）。目标 active，37/48，第 38 未提交。

### 第 74 轮：权限矩阵接入与非空凭据前提

- pwsh-143 仍在运行，本轮未修改其已生成 runner。prepare-wechat-browser-baseline.mjs 已为下一次生成组合权限矩阵：建立整表初始摘要后先 runWechatPermissions，再进入浏览器流程；cleanupFixtures 分别尝试资料和租户清理，最终汇总错误，不让一项失败跳过另一项。node --check 通过。
- 浏览器 flow 增加非空虚构认证字段前提：只更新本次已登记 ID 且昵称等于唯一 prefix 的记录，写入 fixture-session/access/refresh 等固定虚构值，断言一行命中后取摘要，再由真实业务 API 验证更新保留。此增强尚未生成到当前运行中的 runner，下一轮生成后才会执行。
- 仍待 pwsh-143 报告，后续重跑必须使用新的生成器以执行权限矩阵及租户关联清理。新增归属并发窗口尚未修复；第 38 未提交，进度 37/48。已复核技能，无新增已验证通用经验。

### 第 75 轮：新增事务锁与完整验收启动

- 新增微信资料已将 CheckOwner 与 Insert 放入同一事务，关联账号查询使用 TranLock(DbLockType.Wait)，直到提交前保持行锁；异常回滚。已核对 SqlSugar 官方事务锁文档的 PostgreSQL 支持。测试构建通过，wechat-lock-tests.log 80/80；wechat-lock-api-build.log API 构建通过。并发数据库行为仍待实测，不能以单元回归代替。
- pwsh-143 已失败并清理：报告 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-df844d58bf1348dd8710b1cf229cc71a/evidence/wechat-browser-baseline.json，passed=false，cleanupPassed=true，cleanupErrors=[]，fixtureRecordsRemoved/containerRemoved/apiStopped=true。真实新增、持久化、清空与凭据字段摘要保持三阶段通过；失败为查询框 locator 名称“查询昵称”不匹配，实际 DOM 的 ID 为 wechat-query_nickName，现按 ID 定位。
- 组合权限矩阵后，昵称前缀查询会包含权限测试记录；现以精确 nickName 与 OpenId 识别浏览器新增记录并断言唯一，避免混淆。
- 已重新生成并通过语法检查，pwsh-153 运行完整权限矩阵、非空虚构凭据、事务锁 API 和生产桌面流程，日志 wechat-full-browser-baseline.log。当前未出最终结果，第 38 未提交，37/48，目标 active。下轮先收结果和清理证据再处理后续。

### 第 76 轮：平台分页与授权合法路径补验

- 已核对生成器在初始资料摘要后执行 runWechatPermissions，清理分别尝试 profiles 与 tenants，再汇总错误。
- 权限 flow 补充普通租户合法删除并核数据库无记录、只读账号合法查询空租户。
- 新增五个平台值的真实新增与精确筛选，按 pageSize=2 遍历三页验证总数 5、无重复且无遗漏；拒绝空/超长 OpenId、无效平台和性别、危险头像协议、过长手机号、无效分页。拒绝请求前后核整表摘要不变。node --check 已通过。
- 上述增强尚未写入正在运行的 pwsh-153 runner，下一次生成再执行。pwsh-153 尚未结束，应先收报告和清理结果，不并发启动相同端口。第 38 未提交，进度 37/48，目标 active。

### 第 77 轮：补齐桌面编辑持久化验证

- 浏览器 flow 已补充真正通过编辑弹窗保存城市，然后以 SQL 验证持久化并比较非空凭据与创建审计摘要；不再只检查编辑回显后取消。node --check 通过。
- 正在执行的 pwsh-153 尚未结束，其运行目录为 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-aa5d6f45417547a3b9fc475f7410417f。当前已生成 runner 确认包含权限矩阵调用、fixtures 注册和 quote 辅助方法。
- 第 76、77 轮增加的场景需下一次重新生成后执行，未计为验收通过。先收取 pwsh-153 结果与清理状态，再修正失败并统一运行最终场景。第 38 未提交，37/48，目标 active。

### 第 78 轮：完整六阶段真实验收通过

- pwsh-153 已成功退出。报告 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-aa5d6f45417547a3b9fc475f7410417f/evidence/wechat-browser-baseline.json：passed=true、cleanupPassed=true、cleanupErrors=[]，fixtureRecordsRemoved/tenantFixturesRemoved/containerRemoved/apiStopped 全为 true。
- 六阶段覆盖真实授权及跨租户/匿名/无权限/只读拒绝、production 桌面加载、UI 新增及 PostgreSQL 持久化、清空选填并保留非空凭据与创建审计、UI 删除、停机失败保留草稿且恢复按钮。
- 实际读取同目录 38-wechat-list.png、38-wechat-editor.png、38-wechat-offline.png：1680×1100 桌面，表格与双列表单完整，失败提示可见，草稿保留，按钮可达，无遮挡或溢出。停机提示当前沿用请求错误文本。
- 启动等待期间没有 evidence 目录不代表卡死；本轮 3 秒有界 HTTP 探测已返回 200，随后正常完成。未修改宿主、未启动重复实例。
- 已生成包含第 76/77 轮新增平台/分页/无效输入与 UI 编辑持久化场景的最终 runner，node --check 通过，pwsh-162 正在运行，日志 wechat-final-browser-baseline.log。仍需收取最终报告后完成第 38 交付与提交。进度 37/48，目标 active。

### 第 79 轮：提交清单及头像、防重复规格补验

- 当前本项业务/测试清单 11 个文件，已保存 wechat-stage-paths.txt；git diff --check 通过。用户既有 .gitignore、草案、进度格式和门禁文档删除保持不提交。
- 对照规格第 38 项，浏览器 flow 新增 /favicon.ico 本地头像（产物确实存在），要求 img 可见、complete=true、naturalWidth>0；保存改为连续双击，记录真实 add 请求计数并断言只有一次，同时数据库查询新增唯一。node --check 通过。
- 文件编辑工具出现 ReplaceFileW EIO (Win32 1175)，通过 UTF8 定点写入完成同一变更；不是沙箱拒绝。
- pwsh-162 仍运行，以上头像和双击增强尚未生成到它的 runner；应先收结果与清理证据，再重新生成运行最终完整规格。第 38 未提交，进度37/48，目标 active。复核技能后暂无新增已验证通用经验。

### 第 80 轮：八阶段真实验收通过，启动最终规格补验

- pwsh-162 已退出 0。报告 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-17c1ec3270b44f5d93186b96cb389daa/evidence/wechat-browser-baseline.json：passed=true、cleanupPassed=true、cleanupErrors=[]；fixtureRecordsRemoved、tenantFixturesRemoved、containerRemoved、apiStopped 均 true。
- 8 阶段覆盖真实权限矩阵、五个平台筛选和分页、非法输入拒绝、生产桌面加载、新增持久化、空值清除及非空凭据保留、桌面编辑持久化、删除确认及真实停机留草稿。
- 重新生成 runner 并通过 node --check，启动 pwsh-168；日志 wechat-complete-browser-baseline.log。该轮加入头像真实解码和双击仅一次 add 请求，尚待结果。仅使用独立 PostgreSQL、真实 API 和桌面生产构建。
- 总进度表将第 38 项由待开始同步为进行中，完成数仍 37/48；保留用户格式改动。未提交，未开始第 39 项。已复核技能，无新增通用经验。

### 第 81 轮：提交边界与桌面证据复核

- goal revision 26 保持 active；pwsh-168 仍运行，本轮运行目录为 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-c0c0e79320674b0496a4c4a97fea8567，尚未生成阶段报告。不并发启动第二个 5038 实例。
- 11 个业务/测试路径均存在且无重复；暂存区为空，无关 .gitignore、草案、门禁文档删除均保留。源码复核确认资料投影、旧/新归属检查、新增事务及关联账号行锁；并发锁竞争未实测，不据此扩大验收声明。
- 实际查看上一轮 17c1ec3270b44f5d93186b96cb389daa 的截图：offline 图中真实 502、OpenId 草稿及按钮完整可见；名为 editor 的图片实际为列表，不能将其当作成功编辑弹窗的视觉证据。当前 flow 在城市空值断言后、填入城市前截图，尚缺弹窗稳定可见的明确等待；须核对最终轮实际图片，必要时补充稳定条件和截图证据，不用文件名代替视觉核验。
- 本项仍未提交，37/48。未产生可确认根因的新通用技能经验。

### 第 82 轮：最终交付

最终报告 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-c0c0e79320674b0496a4c4a97fea8567/evidence/wechat-browser-baseline.json：9 阶段 passed=true、cleanupPassed=true、cleanupErrors=[]，fixtureRecordsRemoved、tenantFixturesRemoved、containerRemoved、apiStopped 全 true，pwsh-168 退出 0。头像实际解码、双击仅一次新增、权限/租户矩阵、五个平台/分页/非法输入、完整资料 CRUD、空值清除和非空凭据/创建审计保留、真实停机草稿均通过。

本轮 list/editor/offline 三张 1680×1100 截图已实际查看；编辑弹窗真实完整可见，关闭上一轮截图证据缺口。80/80 后端回归、前端类型/ESLint/生产构建、隔离 API 构建均通过；antdv lint 只回显参数的限制保留，不计作验证。并发锁争用未实测，不扩大保证范围。已复核，无新增已验证通用技能经验。

整体更新为 38/48；本项业务与测试 11 个文件、验收脚本/记录 5 个文件、进度 1 个文件独立提交。保留用户无关改动；下一项 39 先核验收尾状态。