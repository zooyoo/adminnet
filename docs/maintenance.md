# 仓库维护

## 文档与历史资料

长期说明集中在 `docs/`，入口为 [文档索引](README.md)。开发与测试说明见 [开发与验证](development.md)，前端和部署工具的用法仍放在对应代码目录，避免维护两份相互冲突的操作手册。

原 `doc/` 已合并至 `docs/`：

- `doc/img/` → `docs/assets/images/`，保留上游展示图片。
- `doc/shop/` → `docs/assets/shop/`，保留上游展示资源。
- `doc/pdfme-print-service.md` → [PDF 输出与打印服务](frontend/pdfme-print-service.md)，保留请求格式、回执和取消等协议。
- 文件管理与任务调度的可复用约定分别整理至 [文件管理](frontend/file-management.md) 与 [任务调度](frontend/job-management.md)。

已完成前端移植的规格、任务草案、阶段交接、工具命令和验收记录不再作为当前操作入口。原有已跟踪资料可通过 Git 历史查看；清理过的临时构建、截图和数据库不承诺在工作区继续存在。`Web/CHANGELOG*.md` 及共享包的历史记录保留原有版本语境，不改写为当前分支的新发布记录。

## 临时工作区

`.scratch/` 用于可再生成的工作产物和短期调查资料，默认受忽略规则保护；少量历史文件已被 Git 跟踪，清理时必须同时核对 `git status` 与 `git diff`，不能只依据 `.gitignore` 判断。

本轮已清理前端移植目录 `.scratch/frontend-vben-migration/`，包括隔离构建、临时脚本、夹具、截图、日志和阶段证据；同时清理仓库内的安装包提取物、一次性提取脚本、调试截图与空探针目录。正式 E2E 用例位于 `Web/apps/web-antdv-next/e2e/`，不依赖这些临时脚本。其余与独立 DSH 修复和恢复工作有关的资料保留：

- `.scratch/proposal-agent-lifecycle/`：含独立源码、补丁及尚未确认收尾的事项。
- `.scratch/dsh-fast-mode-priority-fix/`：含源码、原始文件与测试。
- `.scratch/session-recovery/`：跨任务恢复资料。

这些保留目录中的历史证据可能提及已退休的移植路径；应按当时提交查证，不作为本轮重新验收或当前任务状态。相关补丁是否已在其他仓库落地，须在后续对应任务中确认。

## 后续清理边界

1. 删除或移动前核对解析后的绝对路径、目录用途、正式代码与脚本的引用，以及是否含未提交源码、补丁或业务数据。
2. 阶段性结论先提炼到对应长期说明，再清理原始工具输出。路径和本地链接须与移动同步更新。
3. `bin/`、`obj/`、`dist/`、`test-results/`、`playwright-report/` 等构建或测试产物可再生成，确认没有运行中任务依赖后按需清理；不要连同测试源码删除。
4. `node_modules/` 和 pnpm 缓存涉及开发环境，不属于日常文档清理的默认范围。
5. 数据库文件、上传目录、证书、环境配置和凭据不得仅因扩展名或目录名看似临时就批量删除。仓库外的系统 Temp 与其他工作区也不在默认清理范围。
6. `.agents/skills/` 是外部技能安装内容，`.claude/skills/` 包含指向它的目录联接；不在普通文档维护中遍历联接并批量改写或删除技能。按任务维护仓库自有规则，技能更新走其安装流程。

当前任务跟踪方式由 [任务跟踪约定](agents/issue-tracker.md) 和实际 workspace / backend 决定，旧 `.scratch` 任务表不构成权威状态。
