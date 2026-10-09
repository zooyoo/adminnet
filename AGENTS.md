# 仓库指南

## 项目结构与模块组织

本仓库由 ASP.NET Core 后端和 Vue 3 前端组成。后端代码位于 `Admin.NET/`：`Admin.NET.Core` 包含领域模型与共享基础设施，`Admin.NET.Application` 实现应用服务，`Admin.NET.Web.Core` 承载 Web 层通用能力，`Admin.NET.Web.Entry` 是可执行的 API 项目。测试位于 `Admin.NET/Admin.NET.Test`，可选集成模块独立放在 `Admin.NET/Plugins/`。

前端位于 `Web/`。应用代码放在 `Web/src/`，静态资源放在 `Web/public/`，构建产物放在 `Web/dist/`。部署相关资源归入 `docker/`；不要在源码目录中放置运行时或构建产物。修改后端模块或插件前，请先阅读距离目标文件最近的 `CLAUDE.md`。

## 构建、测试与开发命令

在 `Admin.NET/` 中运行后端命令：

```powershell
dotnet restore Admin.NET.sln
dotnet build Admin.NET.sln -c Debug
dotnet run --project Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj
dotnet test Admin.NET.Test/Admin.NET.Test.csproj
```

### 不需要测试mobil端，只测试桌面端

解决方案面向 .NET 8 和 .NET 10，Web 入口项目面向 .NET 10。在 `Web/` 中使用仓库指定版本的 pnpm 运行前端命令：

```powershell
pnpm install
pnpm dev
pnpm build
pnpm lint-fix
pnpm format
```

`pnpm lint-fix` 会修改文件，提交前请检查其产生的差异。

## 代码风格与命名约定

遵循 `Admin.NET/.editorconfig`：C# 使用 4 个空格缩进、`CRLF` 换行、文件范围命名空间，以及 `PascalCase` 类型和成员命名；接口以 `I` 开头，并在适当场景优先使用显式局部类型。新增 C# 文件时保留规定的版权声明头。

前端格式由 `Web/.prettierrc.cjs` 定义：使用制表符缩进（宽度为 2）、分号、单引号、`LF` 换行和 200 字符行宽。遵循既有的 `index.vue` 与功能目录组织模式，避免建立平行的目录结构。

## 测试约定

在 `Admin.NET.Test` 中使用 xUnit v3。测试文件应放在对应领域目录下；新测试类命名为 `*Tests`，测试方法使用 `Method_Scenario_ExpectedResult` 格式，例如 `Init_WithTimeSpan_ReturnsCorrectDateTime`。测试采用 Arrange、Act、Assert 结构。提交 PR 前运行受影响的测试项目和相关构建。

## 提交与 Pull Request 约定

提交信息使用简洁的中文 Conventional Commit 格式，例如 `fix: 修复异常日志序列化失败` 或 `feat: 新增审批流节点`。每个提交只处理一个关注点。Pull Request 应说明行为变化、标出受影响的后端或前端模块、关联可用的 Issue、列出验证命令；界面变更还应附截图。不要提交凭据、生产环境连接字符串、证书，以及生成的 `bin/`、`obj/`、`node_modules/` 或 `dist/` 内容。

## 前端 Skill 与工具调用规范

本节适用于 `Web/` 前端任务。Skill 提供按需知识，MCP 和 CLI 提供查询与检查能力；具体实现以用户要求、仓库现有结构及目标包的实际配置为准。所有 Skill 的 API 和配置建议均需核对项目实际版本。`antfu` 的个人偏好仅作补充，不因加载 Skill 而替换现有工具链、目录组织或格式规则。

### 按需选择 Skill

任务触发时，先阅读对应的 `.agents/skills/<skill>/SKILL.md`，再按指引读取相关参考文件；只加载本次任务需要的内容。

| 任务 | 应使用的 Skill |
| --- | --- |
| Vue 组件、响应式逻辑、SFC | `vue` |
| antdv-next 组件开发、API 查询、主题定制、故障诊断、版本迁移 | `antdv` 与 `antdv-next`，涉及 Vue 实现时同时使用 `vue` |
| Pinia 状态管理 | `pinia` |
| Vite 配置或 Vitest 测试 | 分别使用 `vite` 或 `vitest` |
| pnpm 依赖、workspace、catalog、lockfile | `pnpm` |
| Nuxt、Nitro、VitePress、UnoCSS | 仅在实际涉及对应技术时使用 `nuxt`、`nitro`、`vitepress`、`unocss` |
| 新项目工具选型或用户明确要求 Anthony Fu 的约定 | `antfu` |
| 用户明确要求创建、发布或准备 PR | `antfu-create-pr`，提交与 PR 文案仍遵循本仓库规范 |

### antdv-next 查询与验证流程

1. **确认版本**：核对目标应用的已安装依赖与 `Web/pnpm-lock.yaml`；将 `catalog:` 或 semver 范围解析为确定版本。若安装状态与 lockfile 不一致，先说明差异，明确查询的目标版本。本文件不固定组件库版本号。
2. **选择查询入口**：优先使用当前会话已加载且能确认版本匹配的 `antdv` MCP，参数以实际工具 schema 为准。MCP 未加载、版本不明或查询失败时，改用 CLI，例如 `antdv info <组件名> --ver <实际版本> --format json`。配置文件存在不等于工具已可调用；`--ver` 指定组件库版本，`--version` 打印 CLI 版本。
3. **先查询后编码**：按 `info → demo → 编码` 顺序执行，必要时补充 `doc`。确认 Props、Events、Slots、类型、默认值和弃用提示后再实现；以匹配版本的结果为依据，不直接套用旧版 Ant Design Vue 或 React Ant Design 的 API。`antdv-next` 的离线参考资料仅在版本适用时使用。
4. **样式与主题**：主题修改查询 `token`，DOM 与样式挂钩查询 `semantic`，整体视觉设计按需读取 `design.md`。沿用仓库现有视觉规范，优先使用该版本公开的 Token 和样式接口。
5. **修改后验证**：按实际命令支持情况运行 `antdv lint <修改文件或目录> --format json`，并执行受影响包现有的 lint、类型检查和相关测试。若 CLI 仅回显参数、功能未实现或不支持目标版本，明确记录限制，改用仓库现有检查及对应版本文档复核，不把退出码 `0` 单独视为检查通过。
6. **升级与迁移**：先核对版本间的 Changelog 和迁移指南，再决定替换方案；CLI 支持时使用 `changelog`、`migrate` 辅助查询。仅为获取资料不得顺带升级项目依赖或重写配置。CLI 用法有疑问时以本机 `--help` 和官方说明交叉核验。

### 参考资料

- Antdv Next：[Skills](https://www.antdv-next.cn/docs/vue/skills-cn)、[MCP](https://www.antdv-next.cn/docs/vue/mcp-cn)、[CLI](https://antdv-next.com/docs/vue/cli-cn.md)、[Agent 指南](https://antdv-next.com/docs/vue/for-agents-cn.md)。
- [Antfu Skills](https://github.com/antfu/skills)；项目内已安装的 Skill 以 `.agents/skills/` 为准。

## Agent skills

### Issue tracker

规格与任务使用本地 Markdown，按功能存放于 `.scratch/<feature>/`。发布、读取及任务编号规则见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认的 5 个 triage 标签；分流与更新状态时读取 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context，共享根目录 `GLOSSARY.md` 和 `docs/adr/`。探索领域代码前按 `docs/agents/domain.md` 读取相关资料。
