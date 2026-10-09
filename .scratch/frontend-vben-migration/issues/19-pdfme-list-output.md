# 19 真实列表导出与打印

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 19 项。仅桌面验收，与第 20 项统一实施。

## 交付

- 新 Vben 打印页使用 `pdfme` 的模板与输入数据生成浏览器 PDF；打印预览数据以 JSON 保存，支持中文字段。
- `SysPrint` 继续使用现有 API、权限码、租户、状态、排序与备注字段，不改动既有服务端合同。
- 浏览器预览失败明确提示，不会显示为已输出。

## 验证

- [x] `pnpm --filter @vben/web-antdv-next typecheck`
- [x] `pnpm --filter @vben/web-antdv-next build`
- [x] 全仓 `hiprint`、`vue-plugin-hiprint` 与旧打印样式引用清零。

## Comments

- 2026-10-09：与第 20 项共用 pdfme 模板模型、生成器与编辑器；真实 API 浏览器隔离验收待后续具有可用打印设备或服务时补充。
