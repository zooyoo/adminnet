# 仓库指南

## 适用范围与事实来源

本文件提供全仓通用约定。修改目标目录前，读取该路径上适用的 `AGENTS.md` 和最近的 `CLAUDE.md`；子目录规则补充本层约定。用户当前要求和会话中的工具权限优先。以磁盘源码、项目配置和 `git diff` 为事实依据，文档或检索索引与源码冲突时先核对并修正文档。

所有沟通使用简体中文，技术名、命令、API 和代码标识符保留英文。中文与英文、数字之间留空格。

## 项目结构

- `Admin.NET/`：后端解决方案。`Admin.NET.Core` 承载领域模型与基础设施，`Admin.NET.Application` 实现应用服务，`Admin.NET.Web.Core` 负责 Web 配置，`Admin.NET.Web.Entry` 是 API 入口，`Admin.NET.Test` 是测试项目，`Plugins/` 放置可选集成。
- `Web/`：pnpm workspace。业务应用在 `Web/apps/web-antdv-next/`，共享代码在 `Web/packages/`，工具配置在 `Web/internal/`。先读 [前端规则](Web/AGENTS.md) 和 [前端说明](Web/README.md)，不要使用已移除的 `Web/src/`、`Web/public/` 或旧应用路径。
- `docker/`：部署资源，使用前核对 [Docker 说明](docker/README.md) 与对应脚本。
- `docs/`：长期维护的说明与协作约定，入口为 [文档索引](docs/README.md)。`docs/assets/images/`、`docs/assets/shop/` 保留上游展示资源。
- `.scratch/`：默认忽略的临时工作区，少量历史文件已被 Git 跟踪；不作为运行依赖或长期文档目录。清理边界见 [维护说明](docs/maintenance.md)。

## 开发与验证

从仓库根目录执行后端命令：

```powershell
dotnet restore Admin.NET/Admin.NET.sln
dotnet build Admin.NET/Admin.NET.sln -c Debug
dotnet run --project Admin.NET/Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj
```

API 入口与测试项目使用 .NET 10；其他工程的目标框架以各自 `.csproj` 为准。`Admin.NET/global.json` 选择 Microsoft.Testing.Platform，当前未固定 SDK 版本。测试须在 `Admin.NET/` 目录执行，使用该运行器的参数：

```powershell
dotnet test --project Admin.NET.Test/Admin.NET.Test.csproj
```

前端在 `Web/` 下使用 `package.json` 的 `packageManager` 指定版本运行：

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm lint
pnpm check:type
pnpm test:unit
```

按改动范围选择检查，不把列出的全部命令作为每次任务的固定门禁。`pnpm lint-fix`、`pnpm format` 会写文件，只对明确需要格式化的范围使用，并检查差异。前后端联调和桌面 E2E 的环境前提见 [开发与验证](docs/development.md)。

- 后端使用现有 xUnit v3 测试项目；涉及数据库的集成验证使用隔离的真实 PostgreSQL，不使用 SQLite 替代。
- 前端逻辑使用 Vitest；浏览器流程使用 Playwright，仅要求桌面端。CapsLock、快捷键和 Notification 在浏览器层通过 Playwright API 或 Mock 验证，不编写 Windows 原生 Hook。
- 测试类采用 `*Tests`，方法采用 `Method_Scenario_ExpectedResult`，遵循 Arrange、Act、Assert。
- 沿用标准测试框架，不自研底层驱动、时序探测器或临时协议，不堆积散碎 `.tmp` 证据。按场景记录退出码、关键截图和 PostgreSQL 数据核验结果。
- 单项测试调试超过 30 分钟仍未解决时，停止扩展测试工具；可用 Mock 验证可隔离的逻辑，并列出 1～2 步人工核验方法。明确标注真实集成验收仍未完成，不能将 Mock 结果记作真实联调通过。
- 仅文档改动通常核对路径、命令、事实、链接与差异即可；不要因此启动业务服务、创建测试数据库或运行修改型全仓格式化。

## 代码与提交

后端遵循 `Admin.NET/.editorconfig`：C# 使用 4 空格、CRLF、文件范围命名空间，类型和成员使用 `PascalCase`，接口以 `I` 开头。新增 C# 文件保留版权声明。前端遵循目标包的现有配置，业务应用格式参考 `Web/.prettierrc.cjs`，不要为统一文档顺带重排共享包源码。

提交信息采用中文 Conventional Commits，例如 `docs: 更新前端开发与验收说明`。PR 写明问题、行为变化、受影响模块、关联 Issue 和验证结果；界面变更提供必要截图。保留用户已有改动。不要提交密钥、连接凭据、证书、业务上传文件或构建产物，不因文档维护升级依赖。

## 检索与工具

1. 定位实现、分析依赖或修改代码前，优先调用 `codegraph_explore`；`projectPath` 始终传当前仓库的绝对路径，查询包含具体符号、文件或行为。
2. Codegraph 返回的带行号源码视为已读取，不立即重复打开同一段。修改公共方法或核心流程前核对调用方、配置入口、测试和影响范围。
3. Codegraph 不可用、命中不相关或索引与源码不一致时，说明实际限制并用定向 `rg`、`git grep` 或文件读取补充。仅在索引缺失且确有需要时建议用户执行 `codegraph init <仓库绝对路径>`；不自行升级、删除或重建索引，也不在工具正常时声称不可用。
4. 文件盘点、文档更新和已知路径的精确读取可直接使用 `rg` 和文件工具。不要检索或输出 `.env`、认证文件、密钥、令牌或证书内容。
5. 使用会话实际暴露且可调用的 Skill、MCP 和 CLI，不将配置文件存在视为工具已加载。外部库 API 问题按需查询匹配版本的文档；普通文档整理优先使用本地事实。

Windows 原生命令与仓库 PowerShell 脚本使用 PowerShell 7+，不要调用旧版 `powershell.exe` 或 `cmd.exe`。PowerShell 脚本以 `$ErrorActionPreference = 'Stop'` 开始，文件读写显式使用 UTF-8，检查外部命令退出码。工具宿主规定的 Shell 与沙箱边界优先，不混用 Bash / PowerShell 转义，不绕过权限限制。删除或移动前核验解析后的绝对路径及其用途。

## 协作与文档维护

- Issue / map 操作先按 [任务跟踪约定](docs/agents/issue-tracker.md) 确认当前 workspace 和 backend；不得把 `.scratch/` 中的旧任务表当作当前权威状态。
- 分流标签按 [标签约定](docs/agents/triage-labels.md) 理解，并服从实际 tracker 的状态与必备标签。
- 领域资料与架构决策按 [领域文档约定](docs/agents/domain.md) 查阅；不因可选术语表或 ADR 不存在而阻塞任务。
- 文档只记录可复用的配置、契约和流程。阶段交接、任务编号、截图日志和机器绝对路径留在临时工作区；任务完成后提炼必要结论再清理。更新入口、脚本或契约时，同步修改相应说明和本地链接。
