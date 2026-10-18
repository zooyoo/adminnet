# 基础布局

本目录属于 `@vben/layouts`，组织应用的页头、菜单、标签页和内容区域。当前业务应用位于 `apps/web-antdv-next/`，应用侧布局在其 `src/layouts/` 中集成。

## 页头插槽顺序

自定义页头插槽沿用 `header-left-n`、`header-right-n` 命名，`n` 用于排序。已有布局保留内置功能的位置，新增插槽时核对当前实现，避免占用内置位置。

- 左侧顺序：`0～19`、`breadcrumb`、`21` 及以后。
- 右侧顺序：`0～49`、`global-search`、`51～59`、`theme-toggle`、`61～69`、`language-toggle`、`71～79`、`fullscreen`、`81～89`、`notification`、`91～149`、`user-dropdown`、`151` 及以后。

修改共享布局前检查应用调用方和桌面导航、主题、语言等受影响场景。环境与验证边界见[前端说明](../../../../../README.md)，实现规则见[前端规则](../../../../../AGENTS.md)。
