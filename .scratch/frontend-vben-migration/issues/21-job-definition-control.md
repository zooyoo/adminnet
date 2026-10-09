# 21 任务定义与运行控制

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 21 项。用户于 2026-10-09 授权统一推进 21、22、23；仅桌面验收，不执行其他提案或生产切换。

## 统一计划

1. 以 21 为共同基础，恢复 Antdv-Next 任务页面、API 封装与明确权限。
2. 实现 22 的触发器编辑、可视化 Cron 和同引擎运行预览。
3. 实现 23 的运行记录、集群和原独立调度看板入口。
4. 使用生产构建、真实隔离 API、隔离任务和只读数据库核验。
5. 分别更新任务与总进度，检查相关差异并提交代码。

## 验收

- [x] 查询、新建、编辑 HTTP / 脚本任务，保留内置任务、分组、参数与不可修改的任务编号。
- [x] 运行、暂停、启动、取消、删除和全局批量语义，与调度引擎状态一致。
- [x] 权限不足、输入错误、不存在任务及服务失败不能显示成功；保留失败草稿。
- [x] 真实隔离数据、后端测试、前端契约、生产构建与桌面视觉通过并清理。

## 验收证据

- 真实生产桌面报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-7a71174d4166461d9b6dfb40eb65f1e4/evidence/job-browser-baseline.json`，`passed: true`、`cleanupPassed: true`。只运行本机 HTTP fixture 与唯一前缀脚本；全部任务、触发器、记录清理为 0，API、代理和浏览器停止。
- 任务 API：HTTP / 脚本创建、分组与描述查询、JSON 参数保留、重复和不存在拒绝、禁止更改编号或创建类型；真实运行、启动、暂停、取消、全局启停、唤醒和持久化。新建等待数据库持久化，操作检查引擎结果，查询展示引擎即时状态。
- 真实 UI：HTTP / 脚本新建、编辑、重开，输入校验；真实删除与全局操作确认。最后停止 marker 对应 API，保存收到 HTTP 502，错误提示、草稿与可重试按钮保留，没有成功提示或数据库写入。
- 取消窄范围回归：`adminnet-vben-626ba245152140658fbd2542aad48f78/evidence/job-browser-baseline.json`，连续 10 次等待任务正文启动回执后取消通过。引擎“正在运行”可能早于任务正文，不以此状态独自推断取消前提。
- 稳定截图已查看：`21-job-editor.png`、`21-job-list-light.png`、`21-job-list-dark.png`、`21-api-stopped-draft.png`；均位于最终真实报告同目录。仅桌面，未执行手机场景。
- 后端：解决方案构建通过；单独构建测试项目到 `Temp/adminnet-vben-test-21`，使用 `dotnet Admin.NET.Test.dll --filter-not-class '*UserTest'`，251 / 251 通过。排除既有 Selenium `UserTest`，不把排除项算作通过。`dotnet test` 命名管道受限与默认测试 exe 文件锁定使用既有隔离输出方式处理，未停止其他进程。
- 前端：Vitest 表单合同 10 / 10、ESLint、类型检查、生产构建通过。最终 Mock 桌面契约 `Temp/adminnet-job-ui-uIWWU8/job-contract-baseline.json`，10 / 10 通过，边界为 `production-browser-mocked-api`，不代替真实集成。
- 兼容：内置任务以只读创建类型编辑既有配置；原 HTTP 失败策略和额外参数不被无关编辑覆盖，非超管所有 `sysJob` 操作要求明确授权。任务和集群沿用系统级模型，不新增虚构租户字段。
- 工具与观察：Antdv CLI lint 仍仅回显 `Parsed args`，不计为有效检查；依赖未升级。C# 既有过时 / XML 注释警告和打印等既有大 chunk 警告保留为观察项。
- 功能映射与复跑命令见 `doc/frontend-vben-jobs.md`。本轮不推进 24 或生产切换。

## Comments

- 2026-10-09：工作区起始干净，当前分支 `v2`。按 21 → 22 / 23 → 统一验收推进，不沿用历史交接中“不推进 21”的限制。
- 2026-10-09：本轮接续时已有 21、22、23 的相关未提交实现，在其基础上完成并验收；保留已有改动，无无关清理。相关经验已更新 `real-browser-baseline/references/lessons.md`。
