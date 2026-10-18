# Admin.NET 前端

当前业务应用在 [`apps/web-antdv-next/`](apps/web-antdv-next/)，使用 Vue 3、TypeScript、Vben Admin 和 Antdv Next。`Web/` 是 pnpm workspace，保留 `@vben/*` 共享包和上游许可证。开发约定见 [AGENTS.md](AGENTS.md)，全仓联调与验收见[开发和验证](../docs/development.md)。

## 环境与启动

使用 [package.json](package.json) 指定的 `pnpm@11.16.0`，Node 版本满足 `^22.18.0 || ^24.12.0`。在 `Web/` 目录执行：

```powershell
$ErrorActionPreference = 'Stop'
pnpm install --frozen-lockfile
if ($LASTEXITCODE -ne 0) { throw '依赖安装失败' }
pnpm dev
```

`pnpm dev` 启动 `@vben/web-antdv-next`，开发端口以 Vite 实际输出为准。开发代理将 `/prod-api` 和 `/schedule` 转发到本地 API `http://localhost:5005`。业务联调先启动后端并准备隔离的 PostgreSQL，具体步骤见[开发和验证](../docs/development.md)。

## 常用命令

以下命令均从 `Web/` 执行；按改动范围选择检查。

| 命令 | 当前行为 |
| --- | --- |
| `pnpm dev` | 启动业务应用；`pnpm dev:antdv-next` 是同一应用的别名 |
| `pnpm build` | 构建业务应用，产物输出到 `Web/dist/` |
| `pnpm build:analyze` | 使用业务应用的 analyze 模式构建 |
| `pnpm preview` | 本地预览已有构建，不提供生产 API 反向代理 |
| `pnpm check:type` | 业务应用的 `vue-tsc --noEmit --skipLibCheck` |
| `pnpm lint` | 检查 `apps/web-antdv-next/src/` |
| `pnpm lint-fix` | 对上述应用源码执行可写的 ESLint 修复 |
| `pnpm format` | 对上述应用源码执行 `prettier --write` |
| `pnpm test:unit` | 运行根配置下的 Vitest 逻辑测试，使用 happy-dom |
| `pnpm test:e2e` | 运行桌面 Playwright 测试 |
| `pnpm build-api-ps` | 从 Swagger 生成并替换当前应用的 API SDK |

根 `lint` 和 `check:type` 不覆盖整个共享包树。修改共享包时另外检查受影响范围。`pnpm check` 还会串联循环依赖、依赖、类型和拼写检查，其范围及前提与上面的常用命令不同。`pnpm lint-fix`、`pnpm format` 会写文件，运行后检查差异；仅文档整理无需运行。

## 目录与入口

| 路径 | 用途 |
| --- | --- |
| `apps/web-antdv-next/src/main.ts`、`bootstrap.ts` | 应用入口与初始化 |
| `apps/web-antdv-next/src/views/` | 业务页面；`_core/` 放框架页面 |
| `apps/web-antdv-next/src/components/`、`adapter/`、`router/` | 组件、UI 适配与路由 |
| `apps/web-antdv-next/src/api/`、`api-services/` | 业务请求与生成的 API SDK |
| `apps/web-antdv-next/src/locales/` | 应用国际化资源 |
| `apps/web-antdv-next/public/` | 应用静态资源 |
| `apps/web-antdv-next/e2e/` | 桌面浏览器测试 |
| `packages/`、`internal/` | 共享实现与工具配置 |
| `api_build/` | Swagger SDK 生成与后处理 |
| `scripts/deploy/` | Nginx、发布包、清单校验与切换工具 |
| `dist/` | 生产构建输出，不是源码目录 |

应用的 `#/*` 映射到应用 `src/*`。不要使用旧的 `Web/src/`、`Web/public/` 或模板中其他应用的路径。API SDK 更新方法见 [API 生成说明](api_build/readme.md)；业务代码生成器的前端输出同样以当前应用目录为目标。

## 测试与联调

[Vitest 配置](vitest.config.ts) 使用 happy-dom 并排除 `e2e/`。它适合逻辑和组件测试，不能替代真实 API 与数据库验收。

[Playwright 配置](playwright.config.ts) 仅定义 `desktop` 项目，使用 Desktop Chrome，视口为 `1440 × 1000`。未设置 `ADMINNET_E2E_BASE_URL` 时，测试会启动 `http://127.0.0.1:8890` 的 Vite 服务；设置该变量后使用指定服务，不再自动启动前端。

```powershell
$ErrorActionPreference = 'Stop'
pnpm test:e2e --project=desktop
```

测试目录同时包含通过路由拦截隔离逻辑的场景，以及需要真实后端或独立服务的场景。运行前核对目标测试的环境变量和前提；浏览器断言通过不代表真实登录、PostgreSQL、Nginx、上传或事件流已全部验收。需要数据库时只使用隔离的真实 PostgreSQL，不使用 SQLite。详细环境准备与验证边界见[开发和验证](../docs/development.md)。

## 部署与维护

生产交付目录统一为 `Web/dist/`。运行时 API 地址、Nginx、SignalR、SSE、上传和缓存配置见[部署说明](scripts/deploy/README.md)；发布包与目录切换见[发布切换说明](scripts/deploy/CUTOVER.md)。开发服务器和 `vite preview` 仅用于本地开发、预览，生产使用对应 Nginx 配置。

媒体、PDF、Office、富文本和调度看板沿用各自的专业引擎。`Sundial.Dashboard` 由后端提供，通过 `/schedule/` 访问。PDF 打印服务契约见 [PDF 打印服务](../docs/frontend/pdfme-print-service.md)。长期说明统一放在 `docs/`，临时任务记录与机器验收地址不作为文档依赖。

项目及上游许可证分别见 [LICENSE](LICENSE) 和 [LICENSE-VBEN](LICENSE-VBEN)。[CHANGELOG.md](CHANGELOG.md) 保留旧前端的历史记录，不表示当前应用的目录或依赖版本。
