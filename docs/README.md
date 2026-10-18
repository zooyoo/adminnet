# 文档索引

本仓库的前端移植已完成，当前应用为 `Web/apps/web-antdv-next/`（Vue 3、Vben、antdv-next）。长期说明统一从本目录进入，具体版本与命令以源码配置为准。

| 资料 | 内容 |
| --- | --- |
| [项目说明](../README.md) | 技术栈、启动入口与上游资料 |
| [开发与验证](development.md) | 目录职责、环境要求、前后端命令和测试边界 |
| [前端说明](../Web/README.md) | pnpm workspace、业务应用、接口生成与前端检查 |
| [接口 SDK 生成](../Web/api_build/readme.md) | 受维护的 PowerShell 入口与生成流程 |
| [桌面发布与回退](../Web/scripts/deploy/CUTOVER.md) | 当前部署、切换和回退流程 |
| [部署脚本](../Web/scripts/deploy/README.md) | 部署脚本的参数、前提与使用限制 |
| [Docker 说明](../docker/README.md) | 容器资源、配置要求与模板限制 |
| [文件管理与预览](frontend/file-management.md) | 文件读写、权限、存储与预览约定 |
| [任务调度与 Cron](frontend/job-management.md) | 调度行为、Cron 预览契约和独立看板部署 |
| [PDF 输出与打印服务](frontend/pdfme-print-service.md) | PDF 生成、浏览器打印和 HTTP 服务协议 |
| [仓库维护](maintenance.md) | 临时资料清理、历史资源与文档维护边界 |

## Agent 协作规则

- [根规则](../AGENTS.md)：全仓公共约定。
- [前端规则](../Web/AGENTS.md)：前端目录、Skill、组件 API 查询和检查方式。
- 后端模块的 `CLAUDE.md`：Core、Application、Web.Core、Web.Entry 及各插件的局部约定。
- [任务跟踪](agents/issue-tracker.md)、[分流标签](agents/triage-labels.md)、[领域资料](agents/domain.md)：与工具宿主及当前 tracker 配置配合使用。

`Web/CHANGELOG*.md` 是保留的上游历史变更记录；`docs/assets/images/` 和 `docs/assets/shop/` 是历史展示资源。它们不代表当前分支的完整交付清单。已完成移植的阶段交接和任务草案不再作为当前操作入口。
