# @vben-core

本目录承载前端框架的基础能力，作为当前 pnpm workspace 中的多个 `@vben-core/*` 包使用。不要在 core 层引入 Admin.NET 业务页面、业务 API 或应用专用依赖。

| 目录 | 用途 |
| --- | --- |
| [base/](base/README.md) | 基础类型、工具、图标与设计能力 |
| `composables/` | 可复用的 Vue 组合式函数 |
| `preferences/` | 框架偏好设置 |
| [ui-kit/](ui-kit/README.md) | 框架 UI 组件 |

业务通用适配放在 `packages/effects/` 或对应公共包；应用专用实现放在 `apps/web-antdv-next/`。消费 core 能力时使用各包 `package.json` 的公开入口，不依赖未公开文件。

修改共享接口前检查调用方与相关测试。当前目录没有统一的 npm 发布承诺，版本和构建方式以各包配置为准。环境与验证命令见[前端说明](../../README.md)。
