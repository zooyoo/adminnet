# 任务调度迁移与验收

日期：2026-10-09。范围为提案 21、22、23，仅桌面；不执行其他提案或生产切换。

## 功能对应

| 原有行为 | Vben / Antdv-Next 实现 | 服务与验收边界 |
| --- | --- | --- |
| `/platform/job`，组件 `/system/job/index` | 任务查询、分组、HTTP / C# 脚本新建编辑，显示内置类型 | 复用 `SysJobApi`；编辑禁止变更编号和创建类型，保留额外 JSON 与 HTTP 配置 |
| 任务运行、暂停、启动、取消、删除 | 图标操作、明确名称、目标确认、请求失败保留目标 | 查询使用真实引擎触发器状态；成功响应代表引擎接受操作，不代表长任务已经执行完成 |
| 全局启动 / 暂停、唤醒、持久化、清空记录 | 独立全局操作与确认 | 仍影响全部任务或记录，不改为当前查询结果或选中项 |
| Cron / 周期 / 既有自定义触发器 | Antdv-Next 编辑器、字段编辑、常用规则、时间窗口及次数和重试 | 保留非 Cron 的类型、程序集和构造参数；不引用旧 UI 组件 |
| Cron 后续运行预览 | `POST /api/sysJob/cronPreview` | 复用当前 Furion 4.9.9.92 `Crontab`；沿用 `sysJob:pageJobDetail` 权限 |
| 作业 / 触发器运行记录 | 按任务、触发器筛选的分页表格 | 真实结果、耗时、状态和时间；保留每个触发器最近 30 条的原有策略 |
| 集群信息 | 集群表格与失败重试 | 读取 `SysJobCluster`；配置 `JobSchedule:ClusterId` 时注册现有 `JobClusterServer` |
| `/schedule` 独立看板 | `/platform/job/dashboard` 嵌入原 Sundial.Dashboard，保留新窗口入口 | 不替换内部页面，使用原独立登录协议，URL 不传应用 Bearer Token |

## Cron 合同

`format` 保持引擎枚举：`0` 为分、时、日、月、周；`1` 在其后加年；`2` 在其前加秒；`3` 同时包含秒和年。宏由同一引擎解析。参数保存为引擎构造参数 JSON，不按逗号拆分表达式。

未填 `fromTime` 使用服务端当前时间；计算起点取 `fromTime` 与 `startTime` 的较晚值，不包含起点本身。服务端返回实际时区 ID 和最多 5 次运行时间；不把浏览器时区当作调度时区。格式错误、无后续时间、非法窗口和不匹配时区明确拒绝。随机 `R` / `H` 规则不能提供确定一致的预览，明确拒绝。

## 权限与隔离

任务与集群是原有系统级数据，不新增虚构的租户字段。所有 `sysJob` API 必须具有明确按钮权限，普通账号不再因菜单未登记而默认放行；分组、触发器列表和 Cron 预览复用查询权限。存量非超级管理员需要按现有菜单授权流程分配新增操作权限。

真实验收只运行带唯一前缀的脚本任务与本机 HTTP fixture。`-JobFixture` 仅在 `IsolatedIntegration` 环境禁止预加载内置作业，并设置隔离集群；脚本拒绝在已有任务的数据库中执行全局控制。不连接生产数据库，不发送外部通知。

## 复跑

在仓库根目录先启动经过构建的隔离 API，再使用启动输出的目录：

```powershell
$ErrorActionPreference = 'Stop'
pwsh -NoProfile -File .scratch/frontend-vben-migration/start-isolated-api.ps1 -JobFixture -CrudFixture
node .scratch/frontend-vben-migration/run-job-browser-baseline.mjs <RuntimeRoot>
node .scratch/frontend-vben-migration/run-job-contract-baseline.mjs
```

真实脚本核验生产产物 `Web/dist`、真实 API 与只读 SQLite，最后清理任务 / 触发器 / 记录并停止经过 marker 校验的隔离进程。`--cancel-only` 可执行连续 10 次真实启动后取消的窄范围诊断。Mock 契约使用默认拒绝未声明 API 的独立代理，不能代替真实联调。

生产相对 API 前缀代理需同时转发根路径 `/schedule` 及其子路径，原看板的资源和独立 API 使用该根路径；不要只代理 `/prod-api/api`。代理重定向不得暴露本机上游地址。绝对 API 地址使用该服务原地址。当前生产构建代理用于入口、独立登录和数据请求验证，不将本机结果冒充未经授权的生产发布。

最终验收报告、截图、工程验证结果与已知工具限制记录在 `.scratch/frontend-vben-migration/issues/21-job-definition-control.md`、`22-job-trigger-cron-preview.md`、`23-job-record-cluster-dashboard.md`。
