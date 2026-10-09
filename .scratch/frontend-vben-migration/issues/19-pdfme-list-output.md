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
- [x] 35 项 pdfme / 公共表格单元测试通过，ESLint 通过。
- [x] 全仓 `hiprint`、`vue-plugin-hiprint` 与旧打印样式引用清零。
- [x] 桌面真实隔离验收：跨页选择、当前页、选中项、全部匹配结果、中文 PDF、Excel 内容和停机草稿保留通过。
- [x] 稳定桌面截图及生成 PDF 渲染检查通过；实际打印服务仅按隔离 HTTP 接收合同验收。

## Comments

- 2026-10-09：撤销 completed。此前未验证真实清单、列设置和打印布局，新增的真实脚本尚未完整通过。缺少设备不是列表/API 验收的阻塞条件。

- 2026-10-09：与第 20 项共用 pdfme 模板模型、生成器与编辑器；真实 API 浏览器隔离验收待后续具有可用打印设备或服务时补充。
- 2026-10-09：真实浏览器报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-3394081d559c4f1fb8ea66a57d65a8a3/evidence/print-browser-baseline.json` 通过，清理通过；输出范围、中文内容和错误态已核验。PDF 发送到隔离本地服务，不代表物理打印完成；构建大 chunk 保留为性能观察项。
- 2026-10-09：扩展到 25 条记录并验证跨页选中、全部 PDF 文本、Excel 工作簿内容；稳定截图与 `positions-all.pdf` 渲染通过。
- 2026-10-09：最终 Edge 真实报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-e30696eb456943838ba342a482455478/evidence/print-browser-baseline.json` 的 6 阶段和清理通过；含隐藏状态列、上移编码列、跨页 PDF、Excel 文件和原生浏览器打印调用。配置页 6 项 Mock 契约通过。`Status` 保留 triage 标签，完成由 `Execution` 表示。
- 2026-10-09：脚本最终修订后的 Edge 真实报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-777e64f7213f404c85a7cadacb7b90b3/evidence/print-browser-baseline.json` 通过，清理通过；补充确认模板分页、输入保护和租户过滤。
