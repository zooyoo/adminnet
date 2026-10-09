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
- [x] 35 项 pdfme / 公共表格单元测试通过，ESLint 通过。
- [x] 全仓 `hiprint`、`vue-plugin-hiprint` 与旧打印样式引用清零。
- [x] 模板保存重开、中文 PDF 发送、隔离打印服务回执及服务不可达反馈通过。
- [x] A4 文档、商品清单、100 × 80 mm 标签常用模板入口，参数校验、重复提交保护、取消/会话隔离及稳定桌面视觉通过。

## Comments

- 2026-10-09：撤销 completed。真实隔离 API 新增与无权查询拒绝通过；设计器、更新重开、服务实际接收、失败反馈和视觉仍待最终通过。不能将配置字段存在视为执行功能完成。

- 2026-10-09：浏览器构建通过；构建报告提示 pdfme UI 产生大于 2 MB 的按页打印 chunk，作为后续性能观察项。
- 2026-10-09：真实浏览器报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-3394081d559c4f1fb8ea66a57d65a8a3/evidence/print-browser-baseline.json` 通过，清理通过；字体 HTTP 加载、模板持久化、重开、服务 202 回执和不可达失败已验证。隔离服务只确认任务接收，不宣称物理打印。
- 2026-10-09：模板弹窗改为视口内固定高度，配置区与设计器保持可操作；A4 稳定截图无遮挡，字体与 `positions-all.pdf` 渲染通过。字体实际为 Noto Serif CJK SC 2.003，保留 `SourceHanSerifSC` 历史键兼容旧模板。
- 2026-10-09：最终 Edge 真实报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-e30696eb456943838ba342a482455478/evidence/print-browser-baseline.json` 的 6 阶段和清理通过，包含真实应用商品清单模板。`antdv lint` 只回显参数，不计为通过；采用实际 ESLint、类型和运行验收。离线 frozen install 通过，字体来源与自定义服务协议见 `doc/pdfme-print-service.md`。
- 2026-10-09：脚本最终修订后的 Edge 真实报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-777e64f7213f404c85a7cadacb7b90b3/evidence/print-browser-baseline.json` 通过，清理通过；补充确认模板分页、输入保护和租户过滤。
