# Issue tracker：本地 Markdown

本仓库的规格和任务以本地 Markdown 为准，不自动同步到 GitHub、GitLab 或 Gitee。

## 文件约定

- 每个功能一个目录：`.scratch/<feature-slug>/`，目录标识采用英文 kebab-case。
- 规格：`.scratch/<feature-slug>/spec.md`。
- 实施任务：`.scratch/<feature-slug>/issues/<NN>-<slug>.md`，从 `01` 开始编号，每个任务独立一个文件。
- 规格和任务的 triage 标签记录在顶部 `Status:` 行，取值见 `docs/agents/triage-labels.md`。
- 评论和讨论历史追加到文末 `## Comments` 下，保留已有内容。
- 普通任务编号在功能目录内唯一；读取时结合所属功能定位。

## 技能操作映射

- “发布到 Issue tracker”：在对应功能目录创建规格或任务文件，不调用远程 Issue API。
- “读取相关任务”：读取用户指定的本地文件；按编号查找时限定到对应功能目录。
- “应用 triage 标签”：更新对应文件顶部的 `Status:` 行。
- 生成任务时检查现有编号，继续使用未占用的编号，保留已有文件及讨论。

## Wayfinding 操作

本节仅在使用 `wayfinder` 时适用。此类探索任务使用独立的生命周期状态，不改变普通任务的 triage 标签含义。

- 总览：`.scratch/<effort>/map.md`，记录 Notes、Decisions-so-far 和 Fog。
- 子任务：`.scratch/<effort>/issues/<NN>-<slug>.md`，每个问题一个文件，从 `01` 编号。
- `Type:` 记录 `research`、`prototype`、`grilling` 或 `task`。
- `Status:` 记录 `open`、`claimed` 或 `resolved`，新任务为 `open`。
- `Blocked by:` 记录同一功能目录内的依赖编号；所有依赖均为 `resolved` 时才解除阻塞。
- 选择任务时按编号寻找 `open` 且无阻塞的任务；开始工作前写入 `Status: claimed`。
- 完成后在 `## Answer` 追加结果，改为 `Status: resolved`，并在总览的 Decisions-so-far 追加结论摘要与任务链接。
