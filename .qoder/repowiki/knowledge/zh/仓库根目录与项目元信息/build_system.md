## 1. 整体方案
仓库采用 .NET (Furion) 后端 + Vue3 前端的双技术栈，分别由两套独立的构建系统管理：
- 后端：`.sln` + `csproj` 项目模型，由 `dotnet build/publish` 驱动，使用 `global.json` 指定测试运行器。
- 前端：pnpm monorepo + Turbo，通过 `turbo.json` 任务编排 `build/preview/dev/typecheck/test:e2e` 等任务。
- API SDK：通过 `Web/api_build/` 下的脚本调用 Swagger Codegen (`swagger-codegen-cli.jar`) 从运行时 `/swagger/{Default}/swagger.json` 生成 TypeScript Axios 客户端。
- 容器化：`docker/docker-compose.yml` 编排 Nginx、MySQL、Redis、MinIO、TDengine 以及 Admin.NET Web Entry；Entry 目录自带 Dockerfile（但镜像基础版本为 6.0，而 compose 运行时使用 aspnet:9.0）。