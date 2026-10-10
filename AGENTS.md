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
### 用pgsql测试，不要用sqlite

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

## 项目检索规则

进行代码分析、定位实现、追踪调用链或修改代码前，优先使用 `codegraph` 和 `fast-context`，避免无目的地遍历整个仓库。

### 工具选择

- 已知类名、函数、接口、文件或业务入口时，优先调用 `codegraph_explore`。
- 需要理解调用链、依赖关系、数据流或修改影响范围时，优先使用 `codegraph_explore`。
- 不知道代码位置，仅有自然语言需求、错误现象或业务描述时，先调用 `fast_context_search`。
- `codegraph` 没有索引、查询失败或结果不足时，使用 `fast_context_search`。
- `fast-context` 找到候选文件或符号后，如项目存在 Codegraph 索引，再用 `codegraph_explore` 追踪调用关系和影响范围。

### Codegraph 使用规范

- 调用时始终传入当前项目的绝对路径 `projectPath`。
- 查询应包含具体符号、文件名、业务流程或待修改行为，避免只有“分析项目”之类的宽泛描述。
- Codegraph 返回的带行号源码视为已经读取过，不要立即重复打开同一段代码。
- 修改共享方法、公共接口或核心流程前，使用 Codegraph 检查调用方和影响范围。
- 如果项目没有 `.codegraph` 索引，立即切换到 `fast_context_search` 或本地检索继续任务，不要中断工作，也不要重复调用 Codegraph。
- 同时说明 Codegraph 当前不可用于该项目，并提供用户可执行的 `codegraph init` 命令。
- 不得自行升级 Codegraph，或删除、重建现有索引；发现版本、损坏或索引过期问题时，说明原因和建议操作。

### Fast-context 使用规范

- 调用时传入当前项目的绝对路径 `project_path`。
- 查询应描述要寻找的行为、入口、数据流或故障现象，而不只是关键词列表。
- 默认使用轻量检索：
  - `include_code_snippets: false`
  - `max_turns: 1-3`
  - `max_results: 5-10`
  - `tree_depth: 0`，让工具自动选择
- 排除 `.git`、`node_modules`、`dist`、`build`、`coverage`、日志及其他生成目录。
- 只有候选文件不足时才增加 `max_turns`、目录深度或启用代码片段。
- Fast-context 返回的是候选位置，不应直接视为最终事实；修改前必须读取对应源码或用 Codegraph进一步验证。

### 标准检索流程

1. 判断是否已有明确符号或入口。
2. 明确入口时调用 `codegraph_explore`；入口不明确时调用 `fast_context_search`。
3. 根据结果进行一次有针对性的补充检索。
4. 必要时再使用 `rg`、`git grep`、`Select-String` 或文件读取工具核实具体内容。
5. 修改前确认定义位置、调用方、配置入口、测试位置和潜在影响范围。
6. 以当前磁盘源码和 `git diff` 为最终依据；工具索引与源码冲突时，以源码为准。

### 检索约束

- 不要同时对两个工具发起相同的宽泛查询。
- 不要重复读取工具已经返回的完整源码。
- 不要为了探索代码而自动修改、初始化或升级项目。
- 不得检索或输出 `.env`、密钥、令牌、证书及其他敏感内容。
- 回答时区分“源码已验证”“工具推断”和“仍需确认”的内容。



## Agent skills

### 提案推进门禁

按编号推进提案、恢复执行或复用子智能体前，读取 `docs/agents/proposal-closeout.md`。当前批次业务验收完成且全部子智能体经宿主确认关闭后，才可派发下一批次；缺少关闭能力或回执时，记录阻塞并停留在当前批次。

### Issue tracker

规格与任务使用本地 Markdown，按功能存放于 `.scratch/<feature>/`。发布、读取及任务编号规则见 `docs/agents/issue-tracker.md`。

### Triage labels

使用默认的 5 个 triage 标签；分流与更新状态时读取 `docs/agents/triage-labels.md`。

### Domain docs

采用 single-context，共享根目录 `GLOSSARY.md` 和 `docs/adr/`。探索领域代码前按 `docs/agents/domain.md` 读取相关资料。
