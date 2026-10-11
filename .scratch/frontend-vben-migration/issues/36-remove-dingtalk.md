# 36：删除钉钉插件及入口等相关代码

Status: ready-for-agent
Execution: completed

## 目标

依据 `doc/frontend-vben-tickets-draft.md` 第 36 项，删除钉钉插件及其关联入口和专用代码。完成构建、真实隔离 API 与生产桌面验收后，更新进度并独立提交。整体当前为 35 / 48；本项尚未完成。

## 收尾门禁

- 第 35 项提交：`be88e392d`。
- 当前仅 Lead，无新增子智能体。
- 已读取 HEAD 中 `docs/agents/proposal-closeout.md`，保留用户对工作树该文件的删除。
- `review-next-36.mjs` 实时核对宿主归档清单，17 个日志成员与额外侧会话状态均与先前一致；逐项验证历史处置证据 SHA-256、原验收 passed/cleanupPassed 和 cleanupErrors，并重新读取第 35 项生成与桌面原始报告。
- 正式 CLI `--next 36 --host-url http://127.0.0.1:19387 --review-file .scratch/proposal-agent-lifecycle/next-36-review.json` 退出 0。证据：`next-36-cli-audit.json`、`next-36-audit.json`，reviewed-clear，blockers=[]。

## 已核对范围

- 后端 `Admin.NET/Plugins/Admin.NET.Plugin.DingTalk/`，Application.csproj 项目引用和 Admin.NET.sln 项目及 GUID 配置。
- 新应用 `Web/apps/web-antdv-next/src/api-plugins/dingTalk/` 与旧前端 `Web/src/api-plugins/dingTalk/`。
- `Web/api_build/build.ps1`、build.bat、build.sh 的钉钉模块入口。
- `Web/packages/effects/common-ui/src/ui/authentication/` 中 dingding-login.vue 与 third-party-login.vue，仍需核对引用和实际入口。
- `TemplateTypeEnum.DingTalk = 5`、新应用模板类型选项及新旧生成模型；需保持其他枚举数值稳定并核对已有数据行为。
- 旧 `Web/src/api-plugins/goView/` 混有钉钉接口及模型；需核对引用后只清理钉钉相关部分，第 37 项再处理 GoView 整体。
- 已有检索没有在 Core/SeedData、当前路由和测试目录发现匹配，但仍须补查配置文件、别名、入口依赖和未跟踪文件，不能据此断言无残留。
- 只记录源码文件名，不输出配置密钥。引用清单：`dingtalk-reference-files.txt`、`dingtalk-shared-references.txt`、`dingtalk-entry-files.txt`。

## 待办

- [x] 核对配置及完整引用，移除插件、专用入口及代码。
- [x] 确认剩余 SDK、模板与登录行为兼容；不删除实际数据库业务数据。
- [x] 后端独立干净构建、前端类型检查与生产构建。
- [x] 真实隔离 PostgreSQL/API 核验钉钉接口及 Swagger 分组已消失、保留 API 可用。
- [x] 生产桌面验证相关入口消失、保留登录与页面正常，实际查看截图。
- [x] 独立资源清理、记录验收、更新进度、独立提交、compress。

## Comments

用户现有 `.gitignore`、提案文档、progress 无关格式修改以及门禁文件删除均保留。尚未修改第 36 项业务代码，也没有把范围核对当作业务验收。

### 第 58 轮：插件与登录入口删除

- 已移除 Application.csproj 和 Admin.NET.sln 中钉钉项目引用；独立 API 构建退出 0，输出 `dingtalk-removal-api-build`，确认不存在 Admin.NET.Plugin.DingTalk.dll。日志 `dingtalk-removal-api-build.log`。
- 核对绝对路径后删除 206 个受版本控制的专用文件，范围为后端钉钉插件、新旧钉钉 SDK 和 dingding-login.vue；随后删除专用 SVG 图标。没有删除业务数据库数据。
- 清理共享第三方登录组件、useAppConfig 中专用配置、global.d.ts 类型、图标导出及三种语言的登录文案。其余配置调用方只使用 apiURL。
- 三个生成脚本移除钉钉模块；旧脚本新增未知模块拒绝，避免误生成默认 SDK。PowerShell 语法及 -Module dingTalk 参数拒绝已实际验证；未在 Windows 执行 Bash 或 cmd 脚本。
- 初次类型检查被当前 pnpm 11.22.0 与项目要求 11.16.0 的差异阻断，没有执行源码检查。找到本机缓存 `C:/Users/zoyo/AppData/Local/node/corepack/v1/pnpm/11.16.0/bin/pnpm.cjs` 后，以 Node 直接调用，版本输出 11.16.0，完整 typecheck 退出 0。未修改版本约束或依赖。日志 `dingtalk-removal-typecheck.log`。
- 剩余：模板枚举及前端选项、旧 GoView SDK 混入代码、完整引用复查、生产构建、真实隔离 API 与桌面验收及清理。尚未提交，整体仍为 35 / 48。

### 第 59 轮：模板兼容性及最终构建

- 移除模板枚举、前端选项及新旧 SDK 模型中的钉钉值 5，保留企业微信数值 7。没有删除或重编号数据库历史记录；无类型筛选仍可读取历史记录，新增及筛选值 5 由既有枚举校验拒绝。
- 核对旧 `Web/src/api-plugins/goView` 实际仅导出钉钉 API 且没有业务调用方，校验精确绝对路径后删除其中 23 个受版本控制文件。新应用 GoView SDK 保留到第 37 项。
- 引用扫描仅剩根 `Web/package.json` 的 `build-dingTalk-api-ps`，已移除；扫描范围排除了生成产物、配置环境文件和 Markdown，不能视为全仓库所有字节无残留。
- 前端完整 typecheck 和生产 build 退出 0，日志 `dingtalk-final-typecheck.log`、`dingtalk-production-build.log`。最终 API 构建退出 0，日志 `dingtalk-removal-api-build.log`。
- 模板后端回归 60/60，前端会话回归 25/25，日志 `dingtalk-template-tests.log`、`dingtalk-template-frontend-tests.log`。后端首次失败由本轮测试参数替换误将 5 加入非正数 ID 用例导致，已修正重跑；前端首次日志路径错误导致未启动测试，修正后通过。
- 仍需真实隔离 PostgreSQL/API 核验路由和 Swagger 分组消失、保留 API 与模板行为，以及生产桌面登录/页面截图和独立资源清理。本项未完成、未提交，整体保持 35 / 48。

### 第 60 轮：真实服务验收与浏览器查询诊断

- 新增 `dingtalk-removal-flow.mjs`、`prepare-dingtalk-removal-baseline.mjs`、`run-dingtalk-removal-baseline.mjs`，复用已核对的独立 PostgreSQL/API、生产代理及 finally 清理逻辑，使用最终 dingtalk-removal-api-build 和 Web/dist，无 Mock。
- 首次原报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-fef3e0189b7147a3a4505ff6df52bd39/evidence/dingtalk-removal-baseline.json`。passed=false、cleanupPassed=true、cleanupErrors=[]，fixtureRecordsRemoved/containerRemoved/apiStopped 全为 true。
- 已通过真实断言：钉钉 Swagger 分组 404；依据第 35 项真实 Swagger 快照逐项请求 29 个旧路由均 404；Default 与 GoView 文档正常，GoView 保留 14 路径；模板枚举为 [1,2,3,4,7]；类型 5 新增及查询被拒绝且数据库快照不变；类型 7 保存入 PostgreSQL 且实际渲染成功。
- 真实账号密码登录 HTTP/业务码成功，但进入模板页面后找不到本次记录。已读取最小 DOM 及实际查看 failure.png，列表为空，不能断言为分页或产品缺陷。已补充按唯一名称点击查询，并记录脱敏查询参数与返回条数后重跑。日志 `dingtalk-removal-query-baseline.log`，后台作业 pwsh-70；本记录写入时尚未收取最终结果。
- 登录入口截图及完整桌面选项、保留缓存页面、停机处理仍需最终成功报告和截图复核。已复核 Skill，本轮尚无已验证的新通用经验，未修改 Skill。
- 本项未提交，整体仍为 35 / 48，目标保持 active。

### 第 61 轮：真实全流程通过，稳定截图复核中

- 第二次报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-f453faeffdcd42d3bf536b7795d6a4a0/evidence/dingtalk-removal-baseline.json` 显示真实查询 tenantId=1300000000001，fixture 原写 tenantId=100，结果为 0；cleanupPassed=true。确认是验收前提不一致，未修改产品隔离逻辑。
- 脚本现从隔离库读取真实租户 ID，将 fixture 与登录 tenantId 明确对齐，并断言浏览器实际查询租户一致。
- 第三次完整报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-5aad0a0b574d40a48fd56cb835160e62/evidence/dingtalk-removal-baseline.json`：passed=true、cleanupPassed=true、cleanupErrors=[]，5 个阶段通过、真实浏览器查询返回 1 条；fixtureRecordsRemoved/containerRemoved/apiStopped 全为 true。日志 `dingtalk-removal-tenant-baseline.log`，pwsh-71 退出 0。
- 真实账号密码登录、模板选项 [通知,短信,邮件,微信,企业微信]、保留缓存 SDK 请求、实际停机错误及按钮恢复均通过，全程无钉钉请求、无 pageerror。模板恢复初始整表快照。
- 已实际查看第三次登录及模板截图：登录存在启动遮罩，模板存在登录通知及未完成浮层动画，不能作为稳定视觉通过。新增等待 #__app-loading__ 隐藏、消息通知归零、截图 animations=disabled 后启动最终重跑 pwsh-74；日志 `dingtalk-removal-final-baseline.log`，本记录写入时待收取结果和看图。
- 受影响模板及共享登录等 7 个文件 ESLint 退出 0，日志 `dingtalk-final-eslint.log`。再次核对后端输出没有钉钉产物。
- 仍未提交；待稳定视觉完成后更新总进度、独立提交。

### 第 62 轮：最终交付验收

- 最终报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-0dc39eb78791419bac98d857f2f1df76/evidence/dingtalk-removal-baseline.json` 已直接读取：passed=true、cleanupPassed=true、cleanupErrors=[]，5 阶段全部通过，fixtureRecordsRemoved/containerRemoved/apiStopped 均为 true。pwsh-77 退出 0。
- 实际查看最终 `36-template-types.png`：自然等待浮层 opacity=1 及有限动画完成后，五个保留选项完整可见。前一完整成功运行 `adminnet-vben-5367b8ff5bfa4457befe11054c2d2c91` 的登录与缓存截图已实际查看，无启动遮罩和临时通知遮挡；其报告同样 passed/cleanupPassed=true。
- 保留的企业微信值为 7；未删除历史数据库记录，隔离测试数据删除后恢复原模板整表快照。无生产访问、短信、外部消息或支付。
- 后端模板 60/60、前端模板 25/25、前端 typecheck/build、最终 API build、受影响文件 ESLint 均通过。build.sh 换行规范化后业务范围 git diff --check 通过；未执行 cmd/Bash 入口。
- Skill 经验复核：登录租户与 fixture 对齐、有限动画自然完成和通知等待均属于既有前提与截图规则，本次证据记录于本 issue，不新增重复 Skill 条目。
- 本项完成，整体更新为 36 / 48；下一项 37 在收尾门禁核验后推进。仅提交本项业务文件、验收脚本和进度差异，保留用户无关修改。