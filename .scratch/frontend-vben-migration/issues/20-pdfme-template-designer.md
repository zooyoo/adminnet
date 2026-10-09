# 20 打印模板编辑、预览与执行

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 20 项。仅桌面验收，与第 19 项统一实施。

## 交付

- 增加 `@pdfme/common`、`@pdfme/generator`、`@pdfme/schemas`、`@pdfme/ui`。
- 通过 `pdfme` `Designer` 编辑模板，保存为 `SysPrint.Template` JSON；重开时恢复设计器状态。
- 提供默认打印清单模板、预览数据、浏览器 PDF 预览、打印参数和客户端服务地址配置。
- 删除旧 `hiprint` 组件、类型声明、全局初始化和打印 CSS，不保留该引擎引用。

## 验证

- [x] `pnpm --filter @vben/web-antdv-next typecheck`
- [x] `pnpm --filter @vben/web-antdv-next build`
- [x] 全仓 `hiprint`、`vue-plugin-hiprint` 与旧打印样式引用清零。

## Comments

- 2026-10-09：浏览器构建通过；构建报告提示 pdfme UI 产生大于 2 MB 的按页打印 chunk，作为后续性能观察项。
