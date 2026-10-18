# 前端协作规则

## 范围与入口

本文件适用于 `Web/`，并补充[仓库规则](../AGENTS.md)。本目录是 pnpm workspace，业务应用只有 `apps/web-antdv-next/`；共享包放在 `packages/`，构建与检查配置放在 `internal/`，辅助 CLI 放在 `scripts/`。不要沿用旧的 `Web/src/`、`Web/public/`、`web-antd` 或其他模板应用路径。

先读 [README.md](README.md)，开发与联调见[开发和验证](../docs/development.md)，生产交付见[部署说明](scripts/deploy/README.md)。最近的包配置和磁盘源码优先于上游模板说明；`@vben/*` 包名和上游许可证需要保留。

## 环境与命令边界

- 使用 `package.json` 的 `packageManager` 指定的 pnpm，当前为 `pnpm@11.16.0`；Node 范围为 `^22.18.0 || ^24.12.0`。版本变更后同步文档，不为查询资料升级依赖。
- 在 `Web/` 安装与执行根脚本。依赖使用现有 `pnpm-workspace.yaml`、catalog 与 `workspace:*`；不要混入 npm / Yarn 锁文件，也不要手改 lockfile 绕过版本约束。
- `pnpm dev`、`pnpm build`、`pnpm check:type`、`pnpm lint` 的当前目标都是业务应用。共享包改动需另外检查受影响包，不能把这些根脚本写成全 workspace 检查。
- `pnpm test:unit` 从根 Vitest 配置执行逻辑测试；`pnpm test:e2e` 从根 Playwright 配置执行桌面浏览器测试。E2E 的环境要求与 Mock 边界见 README。
- `pnpm lint-fix` 和 `pnpm format` 会修改业务应用源码。仅在授权范围使用；文档整理不要运行修改型全仓格式化，也不要执行 `update:deps`、`version` 或 `catalog` 等改依赖命令。
- 生产构建产物是 `Web/dist/`。`node_modules/`、缓存、报告和构建产物不作为源码修改或提交。

## 目录与代码约定

- 应用入口为 `apps/web-antdv-next/src/main.ts`，初始化与适配沿用现有 `bootstrap.ts`、`adapter/`、`router/`、`layouts/` 和 `store/`；页面放在 `views/`，业务组件放在 `components/`。
- `src/views/_core/` 是框架页面。新增业务放入独立功能目录；共享能力先检查 `packages/`，避免建立平行实现。
- 应用内 `#/*` 映射到应用的 `src/*`；跨包引用使用目标包 `package.json` 公开的 `exports`。核对真实导出，避免照搬旧 README 中不存在的默认导出或类型名。
- 前端格式参考 `.prettierrc.cjs`：制表符、宽度 2、分号、单引号、LF、200 字符行宽。共享包沿用其最近配置，不为文档统一而重排源码。
- API SDK 输出到 `apps/web-antdv-next/src/api-services/`，统一通过 [API 生成流程](api_build/readme.md) 更新；业务请求与运行时 API 地址沿用现有封装。Swagger 默认示例使用本地 API，禁止把认证信息放入公开运行时配置。
- 国际化业务文案放在应用 `src/locales/langs/`；框架通用文案在 `packages/locales/`，按现有命名空间和加载方式组织。

## 按任务加载 Skill

只读取当前工作需要的 `.agents/skills/<skill>/SKILL.md` 及其引用资料，位置从仓库根目录计算。优先使用会话实际可调用的 Skill 工具；配置文件存在不代表工具已加载。纯文档整理可先核对本地配置与源码，无需因文档出现组件名称而加载实现技能。

| 任务 | 对应 Skill |
| --- | --- |
| Vue 组件、SFC、响应式逻辑 | `vue` |
| Antdv Next 组件、主题、API、排障或版本迁移 | `antdv`、`antdv-next`；涉及 Vue 实现时同时使用 `vue` |
| Pinia 状态管理 | `pinia` |
| Vite 配置或 Vitest 测试 | 分别使用 `vite` 或 `vitest` |
| pnpm 依赖、workspace、catalog、lockfile 或具体 CLI 行为 | `pnpm` |
| Nuxt、Nitro、VitePress、UnoCSS | 确实涉及对应技术时加载 `nuxt`、`nitro`、`vitepress`、`unocss` |
| 新项目选型或明确要求 Anthony Fu 的约定 | `antfu` |
| 明确要求创建、发布或准备 PR | `antfu-create-pr`；提交与 PR 文案仍使用本仓库规范 |

Skill 的版本与建议需要核对目标包实际版本。`antfu` 的个人偏好仅作补充，不能替换本仓库已配置的工具链、目录与格式规则。外部库 API、配置或 CLI 用法按会话要求查询匹配版本的官方资料；普通路径与脚本事实优先在仓库验证。

## Antdv Next 查询与验证

1. 核对目标应用的已安装依赖和 `pnpm-lock.yaml`，把 `catalog:` 或 semver 范围解析为实际版本。安装状态与 lockfile 不一致时说明差异和本次查询版本；本文件不固定组件库版本号。
2. 优先使用已加载且版本可确认的 `antdv` MCP，参数以真实 schema 为准。未加载、版本不明或查询失败时使用本机 CLI，例如 `antdv info <组件名> --ver <实际版本> --format json`。`--ver` 选择组件库版本，`--version` 输出 CLI 版本。
3. 按 `info → demo → 编码` 顺序工作，必要时补充 `doc`。确认 Props、Events、Slots、类型、默认值与弃用提示，不直接套用旧 Ant Design Vue 或 React Ant Design API。离线资料也要确认版本适用。
4. 主题查询 `token`，DOM 和样式挂钩查询 `semantic`，整体视觉设计按需读 `design.md`。沿用现有视觉规范和该版本公开接口。
5. 修改后按实际支持情况运行 `antdv lint <修改文件或目录> --format json`，再执行受影响范围的 lint、类型检查与相关测试。CLI 仅回显参数、功能未实现或不支持版本时，明确记录限制，改用现有检查与对应版本文档，不能仅以退出码 `0` 宣称有效检查通过。
6. 升级或迁移先核对 Changelog 与迁移指南，CLI 支持时再辅助使用 `changelog`、`migrate`。不得为获取资料升级依赖或重写配置；CLI 疑问用本机 `--help` 与官方说明核实。

参考：[Skills](https://www.antdv-next.cn/docs/vue/skills-cn)、[MCP](https://www.antdv-next.cn/docs/vue/mcp-cn)、[CLI](https://antdv-next.com/docs/vue/cli-cn.md)、[Agent 指南](https://antdv-next.com/docs/vue/for-agents-cn.md)。

## 验证与文档维护

- 逻辑测试使用 Vitest，浏览器流程使用 Playwright，仅要求桌面端。CapsLock、快捷键与 Notification 在浏览器层通过 Playwright API 或 Mock 验证，不编写 Windows 原生 Hook。
- 数据库集成使用隔离的真实 PostgreSQL，不用 SQLite 替代。Mock、路由拦截和 happy-dom 的结果只能覆盖对应逻辑，不能记作真实登录、数据库或代理链路验收通过。
- 单项测试调试超过 30 分钟仍无结果时，按根规则停止扩展测试工具；可降级验证可隔离逻辑，注明真实联调未完成并列出 1～2 步人工核验。
- 按改动选择验证。仅文档改动核对路径、命令、导出、链接和 `git diff`；无需启动业务服务或数据库。不要把全部脚本当作每次工作的固定门禁。
- README 与规则记录可复用的当前契约。临时任务编号、机器地址、截图日志与阶段验收记录留在临时工作区；长期文档不要依赖 `.scratch/`。历史 CHANGELOG 保留真实版本内容，不补造本次移植历史。
- 不修改依赖、生成源码或用户现有改动来消除文档检查问题；发现范围外问题时记录事实并交给对应负责人。
- 检索时遵循根规则，Codegraph 显式传当前仓库绝对路径；文档清单可用定向 `rg`。不读取或输出 `.env`、密钥、认证文件和证书内容。
- Windows CLI 使用 PowerShell 7+，脚本以 `$ErrorActionPreference = 'Stop'` 开始，文件读写显式 UTF-8，检查外部命令退出码，遵守当前工具的权限边界。
- 未经用户要求不提交 Git，也不创建或发布 PR；提交、外部发布及权限判断遵循用户当前授权和根规则。

有关仓库维护、清理范围与历史资料保留策略，参见[维护说明](../docs/maintenance.md)；打印服务契约见 [PDF 打印服务](../docs/frontend/pdfme-print-service.md)。入口、脚本或共享契约变更时同步更新本文件和对应 README。
