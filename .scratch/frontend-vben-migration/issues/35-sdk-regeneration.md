# 35 主服务和插件 SDK 真实再生成

Status: ready-for-agent
Execution: completed

## 范围与验收

来源：`doc/frontend-vben-tickets-draft.md` 第 35 项，无直接依赖。仅使用授权隔离 PostgreSQL/API 与桌面生产构建，不连接生产环境。

- [ ] 从真实测试 Swagger 生成主服务与现存插件 SDK，不升级依赖。
- [ ] 保留 PowerShell 入口、路径检查、暂存替换和失败恢复，并在隔离副本验证失败不损坏现有 SDK。
- [ ] 后处理重复运行内容幂等，生成代码类型检查及生产构建通过。
- [ ] 新应用使用生成 SDK 完成受认证真实 API 调用，核验前缀、原始响应、错误与令牌处理和普通请求一致。
- [ ] 记录桌面验收及资源清理，更新进度并独立提交，随后压缩上下文。

## Comments

### 第 47 轮：收尾门禁与入口核对

- 第 34 项提交 `e2c8915f4` 已核实；最终生产桌面 10 阶段与真实权限 5 阶段原始报告再次读取，passed/cleanupPassed 均 true、cleanupErrors 为空。
- 当前 `list_agents` 仅 Lead。实时宿主清单与历史 17 个成员、额外侧会话逐项一致。保留原始 error/aborted 结果，将第 34 项两个中止实例的处置由恢复当前提案改为真实交付接手，绑定上述原始报告 SHA-256。
- 正式收尾 CLI 使用 `--next 35 --host-url http://127.0.0.1:19387 --review-file .scratch/proposal-agent-lifecycle/next-35-review.json`，退出码 0，reviewed-clear、blockers=[]。证据为 `next-35-cli-audit.json`、`next-35-audit.json`；无需再次归档。
- 工作区 `docs/agents/proposal-closeout.md` 为既有删除；读取 HEAD 规则执行核验，保留该删除未提交。
- 已核对 `Web/api_build/build.ps1`：apiServices/Default、dingTalk/DingTalk、goView/GoView；固定新应用目标目录，随机 cache 暂存和备份，Java 生成后调用 normalize，再替换；替换失败恢复备份。
- 已核对 `normalize-sdk.mjs`：使用当前 TypeScript AST 修正 type-only import、自引用导入、headers 可选访问、RequiredError override。当前脚本没有执行生成结果的完整类型检查；须真实再生成验证，不将脚本退出 0 当作类型检查通过。
- 已核对 `src/api/sdk.ts`、`sdk.test.ts`、`request.ts`：生成 SDK 使用共享 Axios instance，basePath 为空；instance 保留原始响应，普通 request 默认解包，共用认证拦截器。现有 SDK 测试使用 Mock，不能替代本项真实验收。
- Codegraph 结果偏离生成入口，fast-context 返回 HTTP 401，已改用本地 rg 与源码阅读定位；未修改依赖或业务实现。

下一步：核对现有 SDK 文档与生成器版本，启动隔离 Swagger；先在隔离副本测试生成、幂等和失败恢复，再更新正式 SDK 并完成真实桌面调用。

### 第 48 轮：真实生成基线与 Java 运行时

- 新增 prepare-sdk-generation-baseline.mjs 和 run-sdk-generation-baseline.mjs，复用已核验的隔离启动、运行目录归属与 finally 清理；规划对 Default/DingTalk/GoView 真实 Swagger 在运行目录 sdk-copy 内生成，重复后处理校验 SHA-256，错误 Swagger 请求后核对旧 SDK 与暂存清理。尚未完成执行，不记为通过。
- 后台执行 pwsh-35，日志 sdk-generation-baseline.log，启动端口 5035，运行标记使用 plugin-startup-runtime 随机文件；下一轮必须先收取结果与清理报告，不并发重复启动。
- 默认 java 为 Java 8，当前 JAR 报 UnsupportedClassVersionError（55.0 对 52.0）。已找到本机 IntelliJ IDEA 2026.1.4/jbr/bin/java.exe，使用现有 JAR 的 version 命令成功返回 3.0.78；没有下载或升级项目依赖。
- build.ps1 新增可选 -JavaPath（默认 java），Get-Command 和实际生成调用均使用该值；PowerShell 解析与 -WhatIf 通过。该修改尚未完成真实生成验证，不提交。
- 基线生成器新增从 SDK35_JAVA 环境变量传 -JavaPath，未设置仍使用 java。当前 pwsh-35 启动于此修改之前，生成的运行脚本尚未刷新；收取其结果后需重新运行 prepare，再设置 SDK35_JAVA 为已核验的本机 JBR java.exe 并重跑。
- Context7 官方 Swagger Codegen 文档核对 generate 的 -i/-l/-o 参数；实际版本以本机 3.0.78 为准。
- real-browser-baseline 技能已复核；本轮尚无完成的浏览器验收或新的已验证通用经验。

第 48 轮结果补充：pwsh-35 已退出 1。原始报告 C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-c67adeeb2edc448a9d90d6d2be599dea/evidence/sdk-generation-baseline.json 已读取，失败发生于 generate-apiServices，Default Swagger 返回 HTTP 404，尚未调用 Java。passed=false，cleanupPassed=true，cleanupErrors=[]，容器/API 均已清理。下一步先核对隔离环境 Swagger 开关，再使用已验证的 JavaPath 重跑；不要将本次失败归因为 Java。


### 第 49 轮：显式文档开关与恢复测试

- start-isolated-api.ps1 增加 -SdkFixture，将 InjectSpecificationDocument 设为该开关值；默认仍 false。SdkFixture 缺少 PostgreSqlFixture 时在创建资源前拒绝，实际负向检查通过；PowerShell 解析及差异检查通过。
- prepare-sdk-generation-baseline.mjs 为隔离启动传 PluginFixture + SdkFixture + PostgreSqlFixture。已重新生成运行脚本并设置 SDK35_JAVA 为已核验 JBR，后台 pwsh-47 正在运行，日志 sdk-generation-enabled-baseline.log；尚未收取最终结果，不记通过。
- 新增 test-sdk-replacement-recovery.ps1（语法检查通过，未实际执行）：仅针对具有规范 Temp runtime 路径的 sdk-copy，用本地进程的 Move-Item 包装注入“原目录已备份、暂存发布失败”，随后验证原文件哈希及备份/暂存清理；不修改生产生成脚本实现来模拟失败。需要先收取 pwsh-47 的成功生成目录，再使用该 runtime 与 JavaPath 执行。
- 正式应用 SDK 仍未替换，本项改动未提交；真实生成与恢复结果待验证。

### 第 50—51 轮：发现并修复无效 Swagger 替换缺陷

- 第二次真实运行（01adaa05958a4fca9d818dc57d369e5d）主服务真实 Swagger 385 路径，生成 518 文件，两次后处理哈希一致；随后不存在的 Swagger 地址未导致生成命令失败，Missing expected rejection。因此全程 passed=false，cleanupPassed=true、cleanupErrors=[]。这是生成器可能零退出码造成的输入保护缺陷，不是验收通过。
- build.ps1 在生成前读取并冻结 Swagger，拒绝非 JSON、无版本标识及空 paths，HTTP 错误直接抛出；Java 从已验证的输入快照生成，发布前移除 sdk-input.json。仅支持 HTTP/HTTPS/file；未升级生成器。
- 真实 Swagger 快照在旧运行目录 sdk-copy 内重新生成成功。目录替换失败测试最初的 $script 作用域导致故障注入标志未被父脚本观察，改为共享 hashtable 后重跑通过：sdk-replacement-recovery.json 中 passed/restored/stagingClean 全 true。真实调用了备份与恢复，逐文件哈希一致。
- 同运行目录 evidence/sdk-invalid-input.json：malformed、empty、not-spec 三类输入全部拒绝，原 SDK 哈希不变、暂存清理通过。evidence/sdk-path-boundary.json：后处理越界路径拒绝，哨兵未变。
- 第三次完整真实基线后台 pwsh-1（第 51 轮的任务编号，勿与早期构建混淆）正在运行，日志 sdk-generation-validated-baseline.log；下一轮先收取结果和清理报告。
- 正式应用 SDK 未替换，本项尚未完成或提交。还需三模块最终生成、类型/构建、受认证生产桌面调用及请求语义验收。

### 第 52 轮：修复钉钉 Swagger 路由冲突

- 第三次基线已退出 1：原报告位于 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-ee0a902d3c43496ab7af6d8cf193f1cd/evidence/sdk-generation-baseline.json`。主服务生成、后处理幂等和无效 URL 保留均通过；DingTalk Swagger 返回 500，整体 passed=false、cleanupPassed=true、cleanupErrors=[]，API 和容器均已清理。
- 实际日志定位 AddWorkflowConfig、UpdateWorkflowConfig、DeleteWorkflowConfig 均映射到 POST api/dingTalk/workflowConfig。为三者明确独立 POST 路由 addWorkflowConfig、updateWorkflowConfig、deleteWorkflowConfig，不使用忽略冲突的文档策略。
- 独立 API 构建通过，日志 `sdk-route-api-build.log`。真实生成基线增加三条 POST 路由同时存在的断言，已启动第四次完整运行（后台 pwsh-11），日志 `sdk-route-generation-baseline.log`；结果待收取。
- 本项仍 in-progress，正式 SDK 尚未替换，尚未提交。

### 第 53 轮：三组真实生成及清理通过

- pwsh-11 已退出 0，直接读取原报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-24ef745a79b7474880aa91abc26e3602/evidence/sdk-generation-baseline.json`：passed=true、cleanupPassed=true、cleanupErrors=[]、containerRemoved/apiStopped=true。
- 主服务 385 条路径、518 文件；DingTalk 29 条路径、90 文件；GoView 14 条路径、29 文件。三组均通过两次后处理幂等、无效 URL 失败保留和暂存清理；DingTalk 三个审批配置 POST 路由存在断言通过。
- 已启动使用该次真实 Swagger 快照更新正式三组 SDK（pwsh-15），各组日志 `sdk-publish-<module>.log`。生成完成后仍需类型检查、生产构建、认证桌面调用。本报告边界为无浏览器的真实 Swagger 生成，不能代替桌面验收。
- 正式三组 SDK 快照生成 pwsh-15 退出 0。随后类型检查 pwsh-16 退出 1，日志 `sdk-regenerated-typecheck.log`：大量数字/字符串枚举不兼容，另有 LDAP 入参合同差异待后续单独核对。
- 根因已证实：真实 Swagger 快照的 StatusEnum 为 string Enable/Disable；应用 `Configuration/Swagger.json` 明确 `SpecificationDocumentSettings.EnumToNumber=true`，但隔离启动未加载该项。已在 SdkFixture 中仅读取并继承该配置，生成基线新增 StatusEnum integer/[1,2] 断言。旧报告仅证明当时文档的生成流程，不代表正确应用合同。
- 已启动修正配置后的完整真实生成 pwsh-18，日志 `sdk-numeric-generation-baseline.log`。当前正式 SDK 仍是前一次字符串枚举产物，不能提交或宣称类型检查通过；下一轮收取新报告后重新发布 SDK、类型检查、生产构建和认证桌面验收。
- 已复核真实浏览器验收 Skill；新增配置一致性经验待修正后实际验证通过再沉淀。

### 第 54 轮：正确数字合同生成、类型及生产构建通过

- pwsh-18 退出 0，直接读取 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-0ded3c4486e24fd498e15e123b1733a3/evidence/sdk-generation-baseline.json`：passed/cleanupPassed=true、cleanupErrors=[]、containerRemoved/apiStopped=true。主服务 385 路径/518 文件、DingTalk 29/90、GoView 14/29；StatusEnum integer/[1,2]、三条审批配置路由、三组后处理幂等和失败保留断言均通过。
- pwsh-20 使用该次真实快照重新生成正式三组 SDK，退出 0。日志 `sdk-numeric-publish-<module>.log`。
- LDAP 草稿不再直接复用可空密码实体类型，改为 `Omit<SysLdap, 'bindPass'> & { bindPass: string }`，匹配表单原有空字符串初始化和新增接口必填密码合同；不改变编辑时空密码保留行为。
- pwsh-21 退出 0，正式 SDK 的完整 vue-tsc 与生产构建通过：`sdk-numeric-typecheck.log`、`sdk-numeric-production-build.log`。
- 已读取缓存管理页和 API 适配：真实页面通过 `getAPI(SysCacheApi)` 访问 keyList/value/delete，读取 `.data.result`。下一步复用隔离 runner 与生产代理，验收认证 GET、原始 Axios 响应适配、代理前缀、停止 API 错误恢复；另运行已有 SDK 请求层合同测试。当前尚未浏览器验收或提交，不标记提案完成。
- 新增 `sdk-browser-flow.mjs`、`prepare-sdk-browser-baseline.mjs`、生成的 `run-sdk-browser-baseline.mjs`，复用已核验的真实隔离启动/归属/清理。生产 Edge 1680×1100 登录缓存页，验证真实共享 Bearer、单代理前缀、SDK `.data.result` 展示、刷新、真实停机后两次失败与按钮恢复；不 Mock。首次 pwsh-22 在生成器解析时因多余括号退出 1，未创建隔离资源，不能记语法通过。已修正并启动 pwsh-23：先检查生成器、生成脚本语法，再运行真实验收，日志 `sdk-browser-baseline.log`。下一轮先收取结果与原报告并实际查看截图，再判断验收状态。

### 第 55 轮：SDK 合同回归通过，真实页面入口修正

- pwsh-24 退出 0：SDK 请求层 4/4 测试通过（Vitest 4.1.11，`sdk-final-contract-tests.log`），LDAP 适配 ESLint 通过（`sdk-ldap-eslint.log`）。测试启动打印既有 Vben Form 迁移提示，未造成失败。
- pwsh-23 退出 1，原报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-7820bc0b84c3422e863ea69206be9b5c/evidence/sdk-browser-baseline.json`：passed=false、cleanupPassed=true、cleanupErrors=[]、API/容器均清理。失败在请求等待，最小 DOM 只有返回首页；尚未触发 SDK 缓存请求。
- 核对 SysMenuSeedData.cs 的真实菜单 Path 为 `/platform/cache`，Component 才是 `/system/cache/index`。修正脚本 redirect，重新生成及语法检查后启动 pwsh-26，日志 `sdk-browser-baseline.log`，结果待收取。
- 全工作区 `git diff --check` 退出 2：包含用户 progress.md 空白行及生成器新增注释尾空格，不能记格式检查通过；未擅改用户进度格式。后续提交前检查本项暂存差异。
- 整体仍 34/48，第 35 项未提交。

### 第 56 轮：真实认证断言对齐令牌更新

- pwsh-26 退出 1，原报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-55e2c2ae55404b9485d5c2e02e4ddd2e/evidence/sdk-browser-baseline.json`：缓存页已加载，SDK GET HTTP 200；失败在将 SDK Authorization 与最初登录令牌逐字比较，passed=false、cleanupPassed=true、cleanupErrors=[]，API/容器已清理。
- 登录链会更新令牌，断言改为匹配普通 API 请求令牌或真实响应 access-token；请求/响应令牌均登记脱敏，断言只比较布尔结果，避免把实际令牌打印到错误。该次失败报告意外记录的隔离刷新令牌已脱敏，失败状态和清理证据保留。
- 已重新生成并启动真实验收 pwsh-28，日志 `sdk-browser-baseline.log`，结果待收取。尚不能标记桌面通过或提交。


### 第 57 轮：最终真实桌面验收与交付

- pwsh-28 退出 0。原报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-d3e285909d8c4330b11a3f596a86d750/evidence/sdk-browser-baseline.json` 已直接读取：passed=true、cleanupPassed=true、cleanupErrors=[]，fixtureRecordsRemoved/containerRemoved/apiStopped=true。
- 生产 Web/dist + Edge 1680×1100 + 真实隔离 PostgreSQL/API，无 Mock：SDK 共享认证与令牌更新、单代理前缀、原始 Axios 响应适配展示 12 个缓存键、刷新、真实停机 502 及两次重试均通过。
- 已实际查看 35-sdk-cache.png 和 35-sdk-stopped-api.png：列表与错误提示可见，刷新按钮可达；成功图存在刷新 Tooltip，但不遮挡业务内容，不宣称完全无浮层截图。
- 三组真实 Swagger 生成、幂等、失败保留与清理以 0ded3c4486e24fd498e15e123b1733a3 的报告为准。发布替换失败恢复、非法输入/越界拒绝使用前述独立报告；未升级依赖。
- 最终完整类型检查、生产构建、SDK 请求合同 4/4、LDAP ESLint 和后端构建通过。生成器既有注释尾空格保留；不改用户 progress 格式、.gitignore、提案文档和已删除的门禁文档。
