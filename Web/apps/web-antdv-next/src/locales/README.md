# 应用国际化

本目录扩展 `@vben/locales`，加载当前 `web-antdv-next` 应用的语言资源，并衔接 Antdv Next 与 dayjs 的语言切换。入口见 [index.ts](index.ts)，应用文案位于 `langs/`。

新增业务文案沿用已有语言目录、命名空间和键结构。框架通用文案在 `Web/packages/locales/` 维护；不要将旧 Ant Design Vue 模板的初始化方式直接套到当前 Antdv Next 应用。

修改加载或切换逻辑时核对应用初始化和 UI 语言同步，使用现有桌面场景验证。环境、目录和检查命令见[前端说明](../../../../README.md)。
