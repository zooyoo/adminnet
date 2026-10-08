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
