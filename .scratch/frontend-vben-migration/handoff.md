# 编号提案上下文交接

日期：2026-10-09（Asia/Shanghai）。

## 最新接续：第 09 项已完成，下一项 10

本节覆盖下方旧交接的当前编号。01 至 09 已完成，总进度 9 / 48，goal 仍 active。

- 08 提交 `1e3f50a3b`，09 随本记录提交。用户明确要求每项完成后提交再推进，仅桌面验收。
- 用户本轮新指令：“DeepSeek.example 里已配置了密钥，在试下”。已读取配置但未输出密钥；新增隔离开关 `-TranslationTestService`，只有显式传参才注入配置。真实 AI API、浏览器入口、译文占位符及保存落库通过。
- 后端修复翻译空批量删除、旧标识缓存残留、不存在记录写缓存及重复记录；明确翻译文件/批量/AI 授权，补对应菜单种子。共享翻译的既有数据模型不改。
- 前端表单/多语言补会话代次保护、长表单、保存关闭保护和权限按钮。隔离 Upload 配置补齐，真实 XLSX 部分错误、中文导出均通过。
- 真实目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1d5c2a2a6ceb45cd9464c6f5622d8a59/evidence/`，API/桌面 passed 和 cleanupPassed 均 true。API 已停，上传文件和 SysFile 均为 0；证据保留。
- 后端 166 项、Vitest 19 项、生产桌面契约 18 项通过。契约目录 `C:/Users/zoyo/AppData/Local/Temp/adminnet-language-ui-ofTPMi/`。lint/type/build 通过。
- 构建目录现为 `adminnet-vben-build-09` / `adminnet-vben-test-09`（系统 Temp 下）。后续不需要 AI 就不传 TranslationTestService。
- **保留且不要提交**：用户的 `Admin.NET/Admin.NET.Application/Configuration/DeepSeek.example`（含密钥）、`doc/frontend-vben-tickets-draft.md` 排版修改。不要展示这些文件的 diff 或配置值。
- 下一项 10：站点品牌、Logo、注册开关和注册方案真实验收。复用本地上传配置及第 07 项租户隔离环境，确认取消 Logo 不泄漏、失败不保存、租户选项刷新。先创建 issue 10，再实现验收并提交。

## 最新接续：第 08 项已完成，下一项 09

本节覆盖下方第 07 项交接的“当前/下一项”状态；历史说明保留。

- 01 至 08 已完成，整体 8 / 48，goal 仍 active。第 08 项随本次交接提交，使用 `git log` 核验。
- 字典租户缓存键、状态更新、父类型保护、删除顺序与失效已修复；参数按租户读写、共享定义保护、改名缓存、特殊字符键解码已修复；真实字典样式渲染及编辑会话保护通过。
- 后端 156 项（新增 13 项）、Vitest 24 项、生产桌面契约 16 项通过，2 项手机专用跳过。lint 0 错误、3 条既有警告；类型/构建通过。Antdv lint 仍仅回显参数。
- 最终真实 API/浏览器报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-dea69df8bb18453191fd45822e4d8333/evidence/`，passed/cleanupPassed 均 true。最终 `--outage` 已停止 API，证据保留。
- 最终生产契约目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-dictionary-ui-jRtbwe/`。完整矩阵在 issue 08。
- API 构建目录更新为 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-08`，测试输出为 `adminnet-vben-test-08`。
- 执行期间 `doc/frontend-vben-tickets-draft.md` 出现外部排版修改，保留并排除第 08 项提交。
- 下一项 09：语言/翻译 CRUD、模板、真实 Excel 导入、部分失败工作簿、选中导出、二进制错误与权限。先检查既有 AI 翻译配置及可用测试服务，不用 Mock 关闭真实验收。
- 未获用户委派授权，不启动子代理。继续仅桌面和既有 Skill/PowerShell/隔离环境约束。

## 当前状态

- 用户要求严格按 01 → 48 实施，每项完成验收、更新进度并提交，再整理上下文继续。已完成 01 至 07，下一项 08；整个 goal 仍然有效，不能将 7 / 48 记为整体完成。
- 仅测试桌面端，Playwright 限定 `--project=desktop`，独立脚本不创建 mobile/触屏 context。历史移动端证据保留。
- 提案来源 `doc/frontend-vben-tickets-draft.md`；其中“本轮不实施”为历史内容，不覆盖用户当前授权。
- 第 01 项 `197ecaff6`，02 `4e6fa3852`，03 `45b8a5761`，04 `e4b6c6aee`，05 `5a90350b7`，06 `e64353732`。07 与本记录一同提交，使用 `git log` 核验。
- 保留用户既有 `AGENTS.md`、`Web/playwright.config.ts` 改动，不纳入业务提交。
- 没有可调用的手动压缩工具，本文件提供精简交接用于自动压缩恢复；没有主动创建新会话或声称完成手动压缩。

## 下一项 08

字典、参数与缓存一致性真实验收，依赖 01（已完成）。

- 维护字典、系统参数、租户参数后，页面按正确作用域读取新值。
- 内置字典保护、枚举数值类型、排序样式与扩展字段。
- 系统与租户参数不串用；缓存刷新与删除不误删其他键。
- 特殊字符键真实读写/删除，旧会话迟到值不填回新会话缓存。
- 先创建 issue 08，阅读配置/字典/缓存及前端 reference store 当前实现，再补真实 API/生产桌面/错误权限隔离与清理证据。复用 02、07 基础设施，不重复已完成的工程搭建。

## 第 07 项完成摘要

- 服务端：租户菜单完整校验/同步去重/空撤销/默认主键保留；编辑关联目标保护；默认租户与主库保护；重置仅绑定租管；切换检查超管、启用状态及租管归属。
- `CreateToken` 的单点登录跳过改为请求级内部参数，保持常规登录默认行为；显式刷新保持当前切换租户。业务仓储拒绝普通用户伪造其他库/主库 TenantId 请求头；禁用或删除租户不复用已有连接。
- 前端：候选令牌不提前自动采用；资料及菜单预检通过后提交身份，失败保留原身份；预载菜单按 session version 一次消费。切换框取消会中止候选请求，旧响应不能重建退出的会话。
- 编辑/授权弹窗及密码响应有代次/会话/卸载保护；保存时禁用关闭，正文滚动；静态确认框处理请求失败，避免未处理 Promise。
- 默认 `/home` 当前兼容到已实现通知中心 `/dashboard/notice`。旧 `/home/index` 真实首页仍归第 16 项迁移，不能把通知中心当作首页任务完成。
- 最终真实 API 与桌面报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-698ee6f687214a51a431cc3fc15de869/evidence/`，均 passed/cleanupPassed true。隔离 API 已停止，5016 无监听，数据库/截图留存。单脚本 proposalComplete false 不等于整个任务未完成，完整矩阵在 issue 07。
- 最终生产契约：`C:/Users/zoyo/AppData/Local/Temp/adminnet-tenant-ui-TFxJyZ/`，18 项通过。前端 lint/type/build、相关 Vitest 18 项、后端相关 143 项（其中租户 25 项）、API 独立构建通过。
- 后端命令明确排除 `Admin.NET.Test.User.UserTest`：2 项旧 Selenium 环境测试此前 EdgeDriver 初始化失败，不计为通过。`antdv lint` 仅回显参数，实际依靠 ESLint/类型/构建/契约。

## 工具与执行

- 全部 CLI 使用 `pwsh`，首行 `$ErrorActionPreference = 'Stop'`，检查原生命令退出码；读取 UTF-8，手工改动用 `apply_patch`。
- context-mode 工具此前未检索到，不循环重试。Vue/Pinia/Antdv/Vitest 等按任务使用仓库 Skill；Antdv-Next 安装及 lockfile 为 1.5.2，先查匹配版本 info/demo。
- 真实脚本需应用 `.agents/skills/real-browser-baseline/SKILL.md`，执行后复核并更新 lessons；技能不替代当前任务验收。
- 不停止用户 Visual Studio/开发进程。API 独立构建输出：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-build-07`。
- 新隔离服务：`start-isolated-api.ps1 -OnlineFixture -BuildRoot <输出目录>`；清理用停止脚本的路径/PID/时间校验。`run-tenant-browser-baseline.mjs --outage` 会在最后真实停机。
- 后端使用构建后的 `Admin.NET.Test.exe --filter-not-class Admin.NET.Test.User.UserTest --progress off`，避免 MTP/VSTest 不兼容。
- 浏览器只读 SQLite 设置 busy_timeout；截图前等通知/动画并复位表格横向滚动。直接核验截图，不能将布局或接口成功当作落地页面成功。
- 第 48 项生产切换仍需独立发布授权，当前 goal 不替代它。
