# Vben 全量迁移交接

## 立即接续

- 交接日期：2026-10-08，时区 `Asia/Shanghai`。
- 原会话：`codex://threads/01a11a04-fd28-7a01-becb-8628b4c8f41e`。
- 接续会话：`codex://threads/01a11b54-ee01-78f0-93db-40e4dd3180b9`。
- 工作区：`E:\pri\Admin.NET`；分支 `v2`；交接时 `HEAD` 为 `1dc203f51898f431610bfd165c5c8374c6111033`。
- 当前优先级：生产白屏已修复，116 项生产浏览器契约全部通过；继续在线用户与 SignalR，并复核手机端悬浮控件遮挡。全量迁移仍未完成，最新复测结果见文末。
- 旧文档 `doc/frontend-vben-migration.md` 只更新到 7 个系统模块；交接时实际已有 14 个系统模块目录，后续增量和失败现场以本文为准。
- 本文是任务恢复记录，不替代当前 `AGENTS.md`、相关 `CLAUDE.md` 和用户的新要求。

## 用户已经确认的范围

1. 全面替换为 `vbenjs/vue-vben-admin` 的 `apps/web-antdv-next`，全部已实现功能保留，包括工具页、插件入口、首页组件和代码生成器输出。
2. 采用 Vben 的设计与交互，保留 Admin.NET 品牌、中文体验和业务规则。
3. 业务表格也统一使用 Antdv-Next Table，不使用 Vben 默认的 VXE Table。
4. 允许必要的后端接口改造，但计划要求保留既有认证安全语义、菜单数据、权限码、业务 URL 和数据库数据。
5. 分阶段验收，最终整体切换，不长期维护两套前端。
6. 上游基线已选定为 `d27a5b8a0c2972a10d583a7050fcb889766ff83f`。本次接续没有重新选择或升级基线。

原始来源：

- 仓库：<https://github.com/vbenjs/vue-vben-admin>。
- 应用：<https://github.com/vbenjs/vue-vben-admin/tree/d27a5b8a0c2972a10d583a7050fcb889766ff83f/apps/web-antdv-next>。
- 用户提供的文档：<https://doc.vben.pro/>。
- 上述链接为原会话的需求来源，不表示本次交接重新核验了远程内容。

## 工作区与安全边界

- 大量迁移代码尚未提交，`Web/apps/`、`Web/packages/`、`Web/internal/`、`Web/pnpm-lock.yaml`、后端新增测试等仍是未跟踪文件。
- `.gitignore`、`AGENTS.md`、`.agents/`、`.claude/`、`.codex/` 等也已有修改；不能将工作区差异全部视为本次任务所有，更不能重置或批量提交。
- 旧 `Web/src/` 保留作功能对照，尚未达到清理条件。
- 所有交互式命令使用 `pwsh`，脚本首部设置 `$ErrorActionPreference = 'Stop'`；文件读取使用 UTF-8。后台服务使用 `Start-Process -WindowStyle Hidden`。
- 真正业务后端在原会话中未运行。交接检查时，`5005`、`8891`、`8892` 未发现监听；旧进程号和工具 session ID 只作历史定位，使用前必须重新核实。
- 不直接启动连接真实业务数据库的后端。真实联调须先确定隔离测试配置，不把数据库密码、令牌、认证文件写入文档。
- 当前会话没有发现可用的 `read_thread` 或 context-mode MCP。通过只读解析原会话 JSONL 恢复信息，没有修改原会话或应用数据库。

## 工程与协议

### 工程

- 精简 workspace 根目录仍为 `Web/`，应用位于 `Web/apps/web-antdv-next/`，生产输出仍为 `Web/dist/`。
- 包管理器固定为 `pnpm@11.16.0`，环境中执行既有脚本使用 `corepack pnpm`。
- 交接时安装版本：`antdv-next@1.5.2`、`vue@3.5.41`、`vitest@4.1.11`、根目录 `vite@8.3.0`、`playwright@1.64.0`。
- 仓库部分 Skill 的参考版本比实际安装版本新，查询 API 时必须以实际目标包与 lockfile 为准；不要为套用 Skill 升级依赖。
- 开发代理原指向 `localhost:5005`。生产配置与开发配置必须分别核对，不能假定契约测试在两个模式下使用相同 API URL。

### 请求与会话

- 后端响应 `{ code, result, message, errors }`，成功码 `200`。
- SDK 保留 Axios 原始响应，业务适配层负责解包；SDK 与普通请求共用 RequestClient 的 Axios 和拦截器。
- 保留 `Authorization`、`X-Authorization` 及响应头换发令牌，不接入上游 Mock 刷新接口。
- 已处理 SDK 重复拼接 `/prod-api`；既有回归覆盖相对代理、绝对地址与 JSON 正文。
- 已实现会话代次隔离，切换或退出后旧请求不得回写新会话；字典缓存也受会话隔离保护。
- 登录密码保留 SM2、验证码、手机登录和注册协议；LDAP、锁屏、第三方令牌登录等仍需完整核验或迁移。
- 二进制响应中的 JSON 业务错误及鉴权失败已有处理与测试；成功导入仍保留原始响应交给页面。

### 路由与权限

- 新增 `/api/sysMenu/vbenMenuTree` 与 `VbenMenuOutput`，复用既有菜单授权、翻译及业务组件路径；原菜单 API 保留。
- 使用 Vben 后端权限模式，按钮权限来自后端；保留 hash 路由与旧业务地址，提供旧登录地址重定向和旧图标映射。
- 角色菜单授权 `null` 表示不更改，`[]` 表示清空；半选父级不能当成完全勾选。
- 用户角色清空、角色同步授权会失效对应权限缓存，已有隔离 SQLite 回归。
- 租户切换失败保留当前会话；成功则重新获取用户、权限和路由，并应销毁旧实时连接。

## 已落地内容

“已落地”仅表示代码存在并有相应实现或历史验证，不等于真实后端已经验收。

| 范围                                       | 交接时状态                                                                                                                                |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| workspace、布局、主题基础、请求、SDK、菜单 | 已落地，曾通过构建、类型检查及分阶段测试                                                                                                  |
| 公共表格                                   | 查询、重置、分页、排序、选择、树形列表、列显隐与移动已落地；后来补入 `table-output.ts` 导出与打印，编辑单元格、多级表头等全量合同仍须核验 |
| 职位、角色、机构、菜单                     | CRUD、授权、树形关系、复制、审计及多语言等已迁移，历史浏览器契约已通过                                                                    |
| 用户、租户、字典                           | 已迁移，包含附属机构、角色清空、租户授权与切换、建库确认、字典限制及缓存刷新                                                              |
| 系统配置、租户配置、语言                   | 已新增迁移，相关浏览器日志记录 22 项通过                                                                                                  |
| 翻译文本、系统信息                         | 已新增迁移，包含导入模板、导出、部分错误工作簿、注册设置和失败保护；相关日志记录 6 项通过                                                 |
| 缓存、注册方案                             | 中断前最新一批；缓存命名空间与真实键分离，注册方案随租户加载机构、角色和职位；桌面 5 项契约通过，手机及全量仍待确认                       |
| SDK 生成脚本                               | 已改向新应用，TypeScript AST 后处理及 `-WhatIf` 已验证；未真实重新拉取 Swagger 生成                                                       |

实际系统目录：

`cache`、`config`、`dict`、`infoSetting`、`lang`、`langText`、`menu`、`org`、`pos`、`role`、`tenant`、`tenantConfig`、`user`、`userRegWay`。

关键代码入口，以下路径相对仓库根目录：

- 请求：`Web/apps/web-antdv-next/src/api/{request,admin-interceptors,file-response,sdk,session}.ts`。
- 认证：`Web/apps/web-antdv-next/src/api/core/`、`src/store/`、`src/views/_core/authentication/`。
- 业务适配：`Web/apps/web-antdv-next/src/api/system/`，包括 `cache.ts`、`registration.ts`、`site-info.ts` 和 `lang-text.ts`。
- 公共表格：`Web/apps/web-antdv-next/src/components/admin-table/`。
- 公共业务组件：`Web/apps/web-antdv-next/src/components/admin/`。
- 浏览器契约：`Web/apps/web-antdv-next/e2e/`，共享登录与 API fixture 位于 `e2e/fixtures/`。
- 后端变更：`Admin.NET/Admin.NET.Core/Service/Menu/`、`Service/Role/`、`Service/User/SysUserRoleService.cs`。
- 后端测试：`Admin.NET/Admin.NET.Test/Menu/`、`Admin.NET/Admin.NET.Test/Role/`。
- 生成脚本：`Web/api_build/build.ps1`、`Web/api_build/normalize-sdk.mjs`。

## 中断现场与验证证据

以下为接管前的历史快照，不是本会话重新执行的结果；本次复测另列在文末。

| 检查               | 最近可确认结果                                       | 证据与限制                                                                                     |
| ------------------ | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 类型检查与生产构建 | 2026-10-08 19:04 前后通过                            | 原 JSONL 第 3345 行，构建命令退出码 `0`；输出到 `Web/dist`                                     |
| 全 workspace 单测  | 632 项中 631 通过、1 失败                            | `Web/node_modules/.cache/vitest-workspace.json`，`success=false`，进程退出码 `1`               |
| 表单单文件复测     | 29 项通过                                            | 原 JSONL 第 3371 行，19:06 后单独执行；不能据此认定全量稳定                                    |
| 开发模式全量浏览器 | 106 项中 105 通过、1 失败                            | `Web/node_modules/.cache/migration-e2e.log`；失败为手机翻译页登录未完成                        |
| 生产模式全量浏览器 | 发起 116 项，日志中已有 104 条失败记录，未见最终汇总 | `Web/node_modules/.cache/migration-production-e2e.log` 最后写入 19:27:30；不能认定为完成或通过 |
| 缓存与注册方案     | 桌面 5 项通过                                        | `cache-registration-e2e.log`                                                                   |
| 配置与语言         | 22 项通过                                            | `configuration-language-e2e.log`                                                               |
| 系统信息等增量     | 6 项通过                                             | `site-settings-e2e.log`                                                                        |
| 后端菜单与权限测试 | 历史 11 项通过                                       | 迁移记录中的 SQLite 隔离测试；本次尚未重跑                                                     |
| 依赖扫描           | 历史未发现三种旧 UI 运行依赖                         | 需在最终切换前重新扫描；不能据此删除尚未迁移的旧源码                                           |
| 真实业务联调       | 未完成                                               | 所有上述浏览器契约均可拦截 API，不代表数据库、短信、LDAP 等验收                                |

### 表单单测断点

- 文件：`Web/packages/@core/ui-kit/form-ui/__tests__/form-integration.test.ts`。
- 用例：`useVbenForm integration does not expose raw values through native form submit events`。
- 失败位置：第 1075 行 `expect(onSubmit).toHaveBeenCalledOnce()`。
- 错误：`AssertionError: expected "vi.fn()" to be called once, but got 0 times`。
- 当前流程为设置字段、触发原生 `submit`、执行 `flushPromises()` 后立即断言；单独重跑通过。
- 异步验证未结束是待验证假设，不是已确认根因。修复时保留“原生事件不暴露原始值”的断言，不通过删除断言或跳过测试处理。

### 浏览器断点

- 旧会话为避免 HMR 干扰，改为对 `8892` 上的生产预览运行契约测试，此轮大量失败。
- 优先复现一条登录和一条角色测试，检查生产运行时配置、请求地址、fixture 拦截、登录后路由和控制台错误。
- 检查 `Web/test-results/` 的 `error-context.md`、失败截图与 trace；完整测试启动前先保存需要保留的失败证据。
- `playwright.config.ts` 支持 `ADMINNET_E2E_BASE_URL`；不设置时自动在 `8890` 启动开发服务，Windows 浏览器 channel 为 `msedge`。
- 本次交接时旧测试进程未发现仍在运行；原工具句柄 `94023` 为历史记录，不能据此继续等待。
- 旧会话曾调整登录辅助函数，等待表单可用并确认输入值。必须复核现有实现，不能只归因于测试时序。

## 约束

如果集成了Sundial.Dashboard前端，这个不要替代

## 尚未完成的全量要求

1. 打通隔离环境的真实认证、角色、租户、直接访问与刷新闭环；覆盖旧请求回写、退出和跨租户状态隔离。
2. 迁移其余系统模块：`codeGen`、`database`、`file`、`job`、`ldap`、`log`、`notice`、`onlineUser`、`openAccess`、`plugin`、`print`、`region`、`server`、`stressTest`、`template`、`update`、`weChatPay`、`weChatUser`。
3. 完成首页、个人设置、品牌配置、水印、锁屏及第三方令牌登录。上游假通知已移除，真实通知和个人中心仍未完成。
4. 在线用户与 SignalR 是原会话已经准备进入的下一批：连接随登录会话创建与销毁，使用最新令牌，保留通知、强制下线与重连。
5. SignalR 已调查的入口为 `Admin.NET.Core/Hub/OnlineUserHub.cs`、`IOnlineUserHub.cs` 和 `SignalR/SignalRSetup.cs`；Hub 为 `/hubs/onlineUser`。`Admin.NET.Web.Core/Startup.cs` 当前从 query 的 `token` 读取 JWT，接入时须核对，不能默认只用 `access_token`。
6. 完成 Office、打印、可视化 Cron、数据库关系图、MQTT、视频、`about`、`elive` 及钉钉、GoView 入口等原有已实现能力。
7. 新增 `/api/sysJob/previewCron`：由现有 Furion 引擎计算后续 5 次运行时间，沿用任务授权；交接时仅是已确认计划，不是已实现接口。
8. 补全公共表格、编辑器、上传、导入、字典及机构选择等共享合同，不以占位按钮或仅文件数量相等作为验收。
9. 迁移 Razor 前端生成模板、预览、ZIP、直接落盘、`FrontRootPath` 与主服务/插件 SDK。生成代表性实体页，验证类型检查、构建与真实 CRUD。
10. 最终清理旧源码、样式、Element Plus、Ant Design Vue 和 VXE 运行依赖；保留可回退发布产物，更新部署、WebSocket/SSE/上传代理、缓存和运行时配置。
11. 完成只读 lint、类型检查、全单测、桌面/手机 E2E、截图、生产构建和受影响后端测试/构建。Mock 契约通过与真实服务验收分别记录。

## 接续顺序与命令

先修复中断时的测试失败并建立可信回归，再推进下一模块；一次完整回归期间不修改被测试源码。

下列命令从 `E:\pri\Admin.NET\Web` 执行；每个脚本均以 `$ErrorActionPreference = 'Stop'` 开头，原生命令失败需检查 `$LASTEXITCODE`：

```powershell
corepack pnpm test:unit packages/@core/ui-kit/form-ui/__tests__/form-integration.test.ts
corepack pnpm test:unit --reporter=json --outputFile=node_modules/.cache/vitest-handoff.json
corepack pnpm lint
corepack pnpm check:type
corepack pnpm build
corepack pnpm test:e2e --project=desktop --grep 'role edit preserves'
```

- 验证生产构建时，确认独立预览服务可用后设置 `ADMINNET_E2E_BASE_URL`。不要把生产回归失败后改回开发模式通过作为生产验收。
- 后端测试从 `Admin.NET/` 执行，先阅读 `Admin.NET.Core/CLAUDE.md`；已有权限回归使用临时 SQLite，不依赖业务库。
- 测试日志和截图放在已忽略的输出目录，不提交 `node_modules`、`test-results`、`bin`、`obj`、`dist`。
- 交接完成不等于迁移完成；剩余模块与真实联调未完成前，应继续保留原全量范围。

## 原始记录定位

本地只读来源：

`C:\Users\zoyo\.codex\sessions\2026\10\08\rollout-2026-10-08T13-38-17-01a11a04-fd28-7a01-becb-8628b4c8f41e.jsonl`

- 共 3391 行，约 11.9 MB；整份加载会再次浪费上下文，应按 JSON 结构提取需要的记录。
- 第 10 行：原始全量迁移请求；第 87 行：用户提供 Vben 文档。
- 第 68、106 行附近的 `request_user_input` 与匹配的 `function_call_output`：范围、后端边界、表格和切换方式确认。
- 第 174 行：完整已确认实施计划；原 goal 为“实施计划”。
- 第 1476、2062 行：阶段性结果，不是全量完成声明。
- 第 3325 至 3371 行：生产预览、632 项单测失败、116 项浏览器启动及表单 29 项复测。
- 会话读取与工具调用记录只作为历史证据；后续用户指令、当前文件和重新执行的结果优先。

## 本会话接续记录

### 已完成交接

- 恢复原始目标、已确认决策、关键协议和中断现场；核对工作区、依赖版本、落盘报告和端口状态。
- 原会话记录、原有改动和历史测试产物均保留，未提交、重置或修改原会话。

### 生产白屏修复

- 用现有角色与认证契约，在生产预览上复现为 1 项通过、1 项失败。角色登录成功，但页面空白，等待“编辑角色”超时。
- 原因证据：trace 中出现 `TypeError: Cannot read properties of undefined (reading 'beforeEach')`，定位到布局的 `useLayoutScroll`；应用与共享布局解析到不同 peer 上下文中的两份 `vue-router@5.2.0`，而 `vue` 本身解析路径相同。
- 修复文件：`Web/apps/web-antdv-next/vite.config.ts`，新增 `resolve.dedupe: ['vue-router']`，使布局和应用共享路由注入键。
- 重新生产构建后，相同 2 项用例均通过；已检查角色页截图，完整布局和业务表格正常渲染。
- 失败现场保留于 `Web/node_modules/.cache/handoff-e2e/`，通过现场位于 `handoff-e2e-fixed/`；没有修改业务权限或削弱测试断言。

### 当前复测结果

- 全 workspace 单测连续 4 轮全部通过，每轮 632 项。报告分别为 `vitest-handoff.json` 与 `vitest-handoff-repeat-{1,2,3}.json`，均位于 `Web/node_modules/.cache/`。
- 原生表单事件测试在本次未复现失败，没有改动该测试或其生产实现。历史异步失败继续保留为待观察项，不能描述为已修复。
- `corepack pnpm lint` 通过，仍有原有测试探针的 2 条 `vue/one-component-per-file` 警告，0 个错误。
- `corepack pnpm check:type`、`corepack pnpm build` 通过。
- 完整生产浏览器契约回归 116 项全部通过，耗时 4.2 分钟，进程退出码 `0`，覆盖桌面和手机。命令：`corepack pnpm test:e2e --max-failures=3 --output=node_modules/.cache/handoff-production-suite`，环境变量 `ADMINNET_E2E_BASE_URL=http://127.0.0.1:8892`。日志：`Web/node_modules/.cache/handoff-production-suite.log`；结果目录：`handoff-production-suite/`。
- 已查看桌面角色、手机缓存和注册方案截图，确认生产页面恢复渲染。手机缓存页的偏好悬浮按钮与删除操作区域仍需进一步复核，当前截图也包含登录通知浮层；功能契约通过不代表全部视觉验收完成。
- 已重新启动生产预览 `http://127.0.0.1:8892/#/auth/login`，进程号 `113324` 仅为本次启动记录，未来仍需核验。没有启动真实后端，页面未拦截 API 时仍依赖 `5005` 服务。
- 本次只修改前端构建解析配置与交接文档，没有重新执行后端构建或测试；原记录的 11 项后端测试仍属历史验证。

本次实际修改仅限本文、迁移记录顶部的交接指引和应用 Vite 路由去重配置；尚未开始下一批业务模块。
