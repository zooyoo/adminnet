# 开发与验证

## 当前结构

后端解决方案为 `Admin.NET/Admin.NET.sln`。`Admin.NET.Core` 提供共享模型与基础设施，`Admin.NET.Application` 放置应用服务，`Admin.NET.Web.Core` 负责 Web 配置，`Admin.NET.Web.Entry` 是 API 入口。`Admin.NET.Test` 使用 xUnit v3；`Plugins/` 是可选插件，是否启用须检查实际项目引用和启动注册。

前端为 `Web/` 下的 pnpm workspace。业务应用在 `apps/web-antdv-next/`，其静态资源在应用自己的 `public/`，生产产物由该应用的 Vite `outDir` 统一输出到 `Web/dist/`。`packages/` 为共享代码，`internal/` 为工具配置，`scripts/` 为开发、部署和发布辅助脚本。旧版 `Web/src/` 与其他前端应用不再作为开发入口。

## 环境准备

- 安装 .NET 10 SDK。各后端工程的目标框架以 `.csproj` 为准；`Admin.NET/global.json` 当前只选择 Microsoft.Testing.Platform，未固定 SDK 版本。
- Node.js 与 pnpm 版本以 `Web/package.json` 为准：当前 Node.js 为 `^22.18.0 || ^24.12.0`，`packageManager` 为 `pnpm@11.16.0`。使用仓库现有 lockfile，不为安装资料而升级依赖。
- Windows 原生脚本使用 PowerShell 7+。配置独立的开发或测试 PostgreSQL，不要把自动建库、种子数据或测试清理指向生产数据库。
- 数据库、缓存、OAuth、文件存储等服务按本机环境配置。配置字段参考项目提供的配置结构，凭据通过本机忽略文件或部署环境注入，文档和日志中不记录真实密码。

## 后端命令

以下命令在 `Admin.NET/` 目录运行：

```powershell
dotnet restore Admin.NET.sln
dotnet build Admin.NET.sln -c Debug
dotnet run --project Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj
```

API 的地址、端口与协议以实际启动配置及输出为准。首次启动可能初始化表和种子数据，运行前确认数据库用途。

测试同样在 `Admin.NET/` 运行：

```powershell
dotnet test --project Admin.NET.Test/Admin.NET.Test.csproj
```

该目录的 `global.json` 会选择 Microsoft.Testing.Platform，使用其 `--project` 入口。从仓库根目录直接运行 `dotnet test` 可能选择 VSTest，不能混用运行器的参数或过滤选项。查看参数时在同一工作目录运行 `dotnet test --help`。

测试依赖的浏览器、外部服务或数据库须按具体测试准备；构建通过、CLI 帮助可用不等于集成测试通过。只需验证局部改动时选择现有测试和适当范围，避免运行会触发外部业务副作用的无关场景。

## 前端命令

以下命令在 `Web/` 运行，完整说明见 [前端 README](../Web/README.md)：

```powershell
pnpm install --frozen-lockfile
pnpm dev
pnpm build
pnpm lint
pnpm check:type
pnpm test:unit
```

`dev`、`build` 和 `check:type` 指向 `@vben/web-antdv-next`。`lint` 当前检查业务应用的 `src/`，共享包改动须补充对应范围的检查。`lint-fix` 和 `format` 会写入源码，不要在只读检查时执行。

前端代理、API 地址和生产路由须与实际部署一致。不要把移植阶段端口、截图地址或个人机器路径当作默认配置。后端接口变化后通过 [SDK 生成说明](../Web/api_build/readme.md) 更新客户端，并检查归一化后的差异。

## 验收范围

- 纯逻辑使用 Vitest；后端使用现有 xUnit v3 测试；桌面浏览器流程使用 Playwright。移动端不在当前验收要求内。
- 真实数据库验收使用独立 PostgreSQL，覆盖本次受影响的读写、权限、租户边界和清理操作，不使用 SQLite 替代。
- HTTP Mock 和浏览器 Mock 适合验证错误分支及隔离逻辑，报告中需明确其范围。缺少真实服务的场景保持待验收状态。
- 桌面 E2E 的统一入口为 `pnpm test:e2e`；先核对 `Web/playwright.config.ts`、目标用例和环境变量要求。使用真实后端还是 Mock 由场景决定，不能把命令退出码等同于所有业务集成通过。
- 涉及打印、通知、任务调度或第三方插件时，使用隔离服务和测试数据；接口接受操作、消息提交、打印服务接收等状态与外部实际执行结果分别核验。
- 单项工具调试超过 30 分钟仍未解决时，停止扩展临时驱动，记录限制、可用的 Mock 结果及 1～2 步人工核验方法。

文档维护只需核对事实、路径、命令、引用和差异。本轮维护不构成业务回归或重新确认历史移植验收结果。部署准备与回退见 [发布说明](../Web/scripts/deploy/CUTOVER.md)。
