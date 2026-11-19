## 1. 采用的体系

仓库是 .NET 后端与 Vue/TypeScript 前端共存的混合项目，分别采用两套独立的依赖管理体系：
- **.NET 侧**：使用 NuGet `PackageReference` 直接声明版本，配合 `.sln` 解决方案组织多个项目（Application / Core / Web.Core / Web.Entry / Test / Plugins），目标框架为 `net8.0` 与 `net10.0` 双目标。
- **前端侧**：使用 pnpm v11 monorepo（`Web/pnpm-workspace.yaml`），通过 pnpm 的 `catalog:` 机制集中管理第三方包版本，并使用 Turbo 作为任务编排器（`turbo.json`）。

没有发现 Go、Python、Rust 等其它语言的依赖清单；也没有私有 NuGet 源或 Docker registry 配置。`.npmrc` 仅将 npm 镜像指向国内 `https://registry.npmmirror.com`。

## 2. 关键文件

| 领域 | 关键文件 | 作用 |
|---|---|---|
| .NET 解决方案 | `Admin.NET/Admin.NET.sln` | 列出所有 C# 项目与插件项目 |
| .NET SDK 选择 | `Admin.NET/global.json` | 仅配置测试运行器 `Microsoft.Testing.Platform`，未固定 SDK 版本 |
| .NET 核心依赖 | `Admin.NET/Admin.NET.Core/Admin.NET.Core.csproj` | 集中声明 Furion、SqlSugar、Elasticsearch、Redis、RabbitMQ、MailKit 等第三方包 |
| .NET 测试依赖 | `Admin.NET/Admin.NET.Test/Admin.NET.Test.csproj` | xUnit v3、Selenium、Test.Sdk |
| .NET Web Entry 依赖 | `Admin.NET/Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj` | Windows 服务宿主、OpenAPI Scalar |
| 前端根清单 | `Web/package.json` | 声明 workspace 脚本、`engines`、`packageManager` |
| pnpm 工作区 | `Web/pnpm-workspace.yaml` | 定义 packages/apps/internal/scripts 子包、`catalog` 版本中心、`overrides` |
| npm 镜像 | `Web/.npmrc` | 固定 npm registry 为 npmmirror |
| 锁文件 | `Web/pnpm-lock.yaml` | pnpm 锁定的完整依赖树（提交到仓库） |

## 3. 架构与约定

### .NET 侧
- 每个项目各自维护 `<PackageReference Include=... Version="..." />`，版本硬编码在 csproj 中，无 `Directory.Packages.props` 中央版本表。
- 跨框架差异通过 `<ItemGroup Condition=" '$(TargetFramework)' == 'net8.0' | 'net10.0' ">` 分支处理（如 `Microsoft.AspNetCore.SignalR.StackExchangeRedis`、OAuth Provider 的版本随框架变化）。
- 同一库的多目标不同版本以条件分组显式维护，例如 `AspNet.Security.OAuth.Gitee` 在 net8.0 用 8.3.0、net10.0 用 10.0.0。
- 对同库的不同大版本进行区分：`BouncyCastle.Cryptography` 同时引入并设置 `Aliases="BouncyCastleV2"`。
- 测试项目引用 `Furion.Xunit`、`xunit.v3`、`Selenium.WebDriver.*`，与生产代码解耦。
- 插件目录 `Admin.NET/Plugins/` 下的各插件项目（ReZero、K3Cloud、WorkWeixin 等）各自维护自己的 csproj 与依赖。

### 前端侧
- 使用 pnpm workspace 模式，子包包括 `apps/*`、`packages/*`、`internal/*`、`scripts/*`。
- 第三方包版本集中在 `pnpm-workspace.yaml` 的 `catalog:` 段（约 140+ 个包），包内引用统一写为 `catalog:` 形式，如 `vue: "catalog:"`、`vite: "catalog:"`。
- 内部共享包使用 `workspace:*` 引用（如 `@vben/eslint-config`、`@vben/vite-config` 等）。
- 通过 `overrides:` 强制某些包走 catalog（如 `vue`、`pinia`、`clsx`、`tailwindcss`），避免子包自行升级导致重复。
- `publicHoistPattern` 把 lefthook、eslint、oxfmt、stylelint、postcss、commitlint 等 CLI 工具提升到 workspace 根，减少重复安装。
- `strictPeerDependencies: false`、`autoInstallPeers: true`、`dedupePeerDependents: true` 降低 peer dependency 冲突成本。
- `packageManager: "pnpm@11.16.0"` 锁定 pnpm 版本；`engines.node` 限定 `^22.18.0 || ^24.12.0`。
- `preinstall: npx only-allow pnpm` 强制只能使用 pnpm 安装。
- 变更流程：`changeset` 用于版本管理，`version` 脚本调用 `changeset version && pnpm install --no-frozen-lockfile`；`update:deps` 使用 `taze -r -w` 批量更新 catalog 版本。

### 构建与发布相关
- `Web/api_build/` 下提供 build.bat/build.ps1/build.sh 及 `normalize-sdk.mjs`，用于生成 API 客户端。
- `.dockerignore`、`Dockerfile`（Entry 项目）、`docker-compose.yml` 负责容器化，但依赖下载仍走默认 NuGet/npm 源。

## 4. 约定与约束

- **前端必须使用 pnpm**：由 `package.json` 的 `preinstall: npx only-allow pnpm` 和 `packageManager: "pnpm@11.16.0"` 共同保证，其他包管理器会被拒绝。
- **Node 版本受控**：`engines.node` 限制为 `^22.18.0 || ^24.12.0`，pnpm ≥ 11.0.0。
- **第三方前端包版本统一来自 catalog**：新增或升级第三方包应在 `pnpm-workspace.yaml` 的 `catalog:` 段修改，子包中以 `catalog:` 引用，避免散落的版本号。
- **内部包之间用 `workspace:*` 引用**：`@vben/*` 系列包均如此，确保 monorepo 内同步开发。
- **npm 源固定为 npmmirror**：`Web/.npmrc` 全局生效，不依赖用户本地 npmrc。
- **.NET 包版本按项目就地维护**：不存在中央版本文件，升级需逐个 csproj 修改，并通过 `Condition` 分支分别维护 net8.0/net10.0 版本。
- **CI 中前端安装可解冻 lockfile**：`version` 脚本使用 `--no-frozen-lockfile`，说明在自动化场景允许重新解析依赖（通常发生在 changeset 版本变更后）。
- **未见私有 NuGet/NPM registry 配置**：.NET 使用默认 nuget.org，前端使用 npmmirror，无 GOPRIVATE、`nuget.config` 自定义源或 `.npmrc` 中的 token 配置。
- **lockfile 纳入版本控制**：`Web/pnpm-lock.yaml` 存在于仓库快照中，前后端都依赖它保证可重现安装。