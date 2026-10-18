# 框架 UI 组件

本目录管理框架通用 UI 与不同 UI 组件库的基础封装。当前子目录包括 `form-ui/`、`layout-ui/`、`menu-ui/`、`popup-ui/`、`shadcn-ui/` 和 `tabs-ui/`，分别按各自 `package.json` 暴露能力。

- core 组件保持业务无关；Admin.NET 页面和业务接口放在 `apps/web-antdv-next/`。
- 当前应用使用 Antdv Next，应用侧适配位于 `apps/web-antdv-next/src/adapter/`。不要把旧模板中的其他 UI 应用当作当前入口。
- 修改公共 Props、Events、Slots 或类型前检查调用方，并遵循[前端规则](../../../AGENTS.md)中的组件查询与版本核对流程。

菜单能力见[菜单说明](menu-ui/README.md)，分层原则见 [core 说明](../README.md)。根 `pnpm lint` 和 `pnpm check:type` 以业务应用为目标，需按修改影响补充共享组件检查。
