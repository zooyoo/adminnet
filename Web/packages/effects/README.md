# Effects 目录

本目录集中维护依赖状态、路由、浏览器环境或第三方库的共享适配。它位于 `@vben-core` 基础层与业务应用之间，业务页面和应用专用 API 仍放在 `apps/web-antdv-next/`。

| 目录 | 用途 |
| --- | --- |
| `access/` | 权限与访问控制 |
| `common-ui/` | 通用业务 UI |
| [hooks/](hooks/README.md) | 共享组合式函数 |
| `layouts/` | 布局与框架集成 |
| [plugins/](plugins/README.md) | 第三方库适配 |
| `request/` | 请求封装 |

共享状态与对外偏好接口分别位于 `packages/stores/`、`packages/preferences/`，不在本目录内。新增能力前先核对已有分层与公开导出，避免在 core 中引入上层业务依赖。

环境、目录和检查命令见[前端说明](../../README.md)，实现约束见[前端规则](../../AGENTS.md)。
