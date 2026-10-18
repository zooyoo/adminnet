# 任务跟踪约定

## 确认当前后端

使用会话中实际可调用的 deck 插件管理 Issue / map 时，先调用一次 `deck_context`，以返回的 workspace 和 backend 为准。不要从 Git remote、历史文档或 `.scratch/` 推断当前后端；工具返回与仓库旧说明冲突时，以工具结果为准。

- 工具返回没有 workspace 或未选择 backend 时，停止调用其他 deck 工具，并说明需要用户选择后端。
- 预检发现对应 CLI、认证或连接不可用时，报告实际限制；不自行改换 backend 或创建一套本地任务记录来伪装同步成功。
- 工具未加载时，保留当前任务上下文，可直接完成用户已授权且不依赖 tracker 的工作；需要读写 Issue 时再说明缺少的能力。

## Issue 与 map 操作

按目标选择 `deck_issue_get`、`deck_issue_list`、`deck_issue_create`、`deck_issue_patch` 或 map 工具，不把正文中的链接当作已写入真实依赖边。需要任务全量关系时读取完整关系；仅查单张票且不需要反向阻塞边时，可按工具支持使用 `blocking=false`。

开始处理、切换或完成已有 Issue 时，按插件要求调用 `deck_issue_report`。关闭正文或状态使用 `deck_issue_patch`，关闭动作不替代完成上报。所有操作核对返回结果，不因请求已发出就宣称成功。

## 本地资料边界

`.scratch/<feature>/` 仅用于临时调查、草稿和测试产物，不固定规格文件名、任务编号或生命周期格式。只有当前后端明确选择本地 Markdown 时，才遵循该后端返回的文件与编号约定。

阶段交接和本地旧任务表不是远程 Issue 状态的权威来源。完成任务后把可复用的配置、契约和决策整理到 `docs/` 或模块说明，再按 [维护约定](../maintenance.md) 清理临时资料。

任务标签的含义见 [分流标签](triage-labels.md)，领域资料的入口见 [领域文档](domain.md)。
