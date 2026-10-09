# 23 运行记录、集群与保留调度看板

Status: ready-for-agent
Execution: completed
Blocked by: 21（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 23 项。与 21、22 统一开发，仅桌面验收。

## 验收

- [x] 从任务 / 触发器筛选查看真实执行记录，覆盖成功、失败、分页、耗时和结果。
- [x] 展示真实集群状态，保留唤醒、持久化和清空记录的原操作语义及明确确认。
- [x] 保留 `/schedule` 的 Sundial.Dashboard，不替换内部页面；核验入口、独立登录、未认证拒绝和生产构建代理兼容。
- [x] 使用 21 的隔离任务产生证据，不运行生产任务；权限、服务失败、稳定桌面截图和清理通过。

## 验收证据

- 共用最终真实报告、测试命令及工具限制见任务 21；8 阶段与清理均通过。任务 API 和独立看板的鉴权分别核验，不以应用按钮隐藏代替拒绝。
- 真实 HTTP 成功 / HTTP 503 失败任务生成不同状态的记录，读取真实结果及耗时；按任务 / 触发器筛选与第 1、2 页不重叠的分页通过。真实浏览器查看成功、失败记录与 `isolated-job-cluster`。
- 全局唤醒、持久化与清空记录保持原语义，操作确认明确全部范围；修复 SQLite 无 `sqlite_sequence` 的清空错误，真实 API、生产页面与新增后端回归通过。保留原最近 30 条记录策略。
- Sundial.Dashboard 内部页面未替换。最终 iframe、资源、独立登录及 POST 数据接口均经同源 `/schedule` 代理，认证后作业列表非空；无认证 POST 数据读取被拒绝，不暴露测试任务。应用 Bearer Token 未写入看板 URL。
- 修复相对 API 前缀下错误嵌入 `/prod-api/schedule/` 导致原看板路由白屏；相对配置采用 `/schedule/`，绝对 API 配置采用服务地址。Vite、Docker Nginx 与验收代理补根路径和事件流兼容；Nginx 本机未安装，容器 `nginx -t` 未执行，配置做静态复核，生产页面同源代理真实流程已通过。
- 稳定截图 `23-job-records.png`、`23-job-cluster.png`、`23-dashboard-login.png`、`23-dashboard-authenticated.png` 已查看；登录成功通知消失后取证，清理后的测试实体为 0，隔离 API 停止。
- 任务、集群和记录沿用系统级模型。存量普通账号按现有菜单授权流程分配任务操作权限；未声明的 `sysJob` 权限不再默认放行。记录 / 集群服务失败与只读权限由独立 Mock 契约补充，不能替代真实 API 权限验收。

## Comments

- 2026-10-09：独立看板使用现有认证协议；不会把应用 Bearer Token 写入看板 URL。
