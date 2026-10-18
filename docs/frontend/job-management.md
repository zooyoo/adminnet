# 任务调度与 Cron 预览

前端入口为 [任务页面](../../Web/apps/web-antdv-next/src/views/system/job/index.vue)，后端实现为 [SysJobService](../../Admin.NET/Admin.NET.Core/Service/Job/SysJobService.cs)，Cron 计算为 [JobCronPreview](../../Admin.NET/Admin.NET.Core/Service/Job/JobCronPreview.cs)。

## 管理行为

- 任务支持 HTTP、C# 脚本的创建与编辑，并显示已有内置任务。编辑不允许变更任务编号和创建类型。
- 任务和触发器的运行、暂停、启动、取消、删除等操作以当前调度引擎结果为准。操作成功表示引擎接受请求，不代表长任务已经执行完成。
- 全局启动、暂停、唤醒、持久化及清空记录会影响全局任务或记录，不能按当前筛选结果理解操作范围；应向操作者说明影响并确认目标。
- Cron、周期及既有自定义触发器保留各自的类型、程序集与构造参数。参数按引擎构造参数 JSON 保存，不按逗号拆分 Cron 表达式。
- 任务与集群沿用系统级数据语义，不额外假设具有租户字段。接口仍须核对明确的按钮权限；分组、触发器列表和 Cron 预览复用查询权限。

## Cron 预览契约

接口为 `POST /api/sysJob/cronPreview`，复用服务端调度引擎的解析与时间计算。`format` 与引擎枚举对应：

| format | 字段 |
| --- | --- |
| `0` | 分、时、日、月、周 |
| `1` | 分、时、日、月、周、年 |
| `2` | 秒、分、时、日、月、周 |
| `3` | 秒、分、时、日、月、周、年 |

未填 `fromTime` 时使用服务端当前时间；计算起点取 `fromTime` 与 `startTime` 的较晚值，不包含起点本身。接口返回服务端实际时区 ID 和最多 5 次运行时间；不把浏览器时区当成调度时区。

格式错误、无后续时间、非法时间窗口和不同的时区会被拒绝。随机 `R` / `H` 规则不能提供与保存后严格一致的确定预览，因此不接受这类预览请求。

## 独立看板与部署

[任务看板](../../Web/apps/web-antdv-next/src/views/system/job/dashboard.vue) 嵌入原 `/schedule` 看板并保留新窗口入口，使用其独立登录协议，不在 URL 中传递应用 Bearer Token。

生产环境使用相对 API 前缀代理时，需要额外转发根路径 `/schedule` 及子路径，覆盖看板页面、静态资源与其独立 API。只代理 `/prod-api/api` 不足以使用看板，代理重定向也不应暴露本机上游地址。具体配置见 [发布与回退](../../Web/scripts/deploy/CUTOVER.md)。

## 验证

现有后端用例位于 [Schedule](../../Admin.NET/Admin.NET.Test/Schedule/)，桌面契约为 [job-contract.spec.ts](../../Web/apps/web-antdv-next/e2e/job-contract.spec.ts)。按场景使用独立 PostgreSQL、带唯一前缀的测试任务和本机 HTTP fixture；全局控制只在隔离环境验证，并清理任务、触发器和记录。

Mock 或浏览器契约不代替真实引擎、集群和持久化验收。通用环境与命令见 [开发与验证](../development.md)。
