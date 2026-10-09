# 27 访问、操作、异常与数据差异日志

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 27 项。提案 26 提交：`bd92e8b4d`。用户要求仅桌面端、隔离 PostgreSQL、按编号逐项提交。

## 验收

- [x] 新界面筛选访问、操作、异常和数据差异日志，分页 / 日期 / 租户 / 账号等字段沿用真实 API 合同。
- [x] 真实测试操作产生相应日志，列表、详情和差异比较展示与持久化记录一致。
- [x] 导出有效，清空确认支持取消和确认后的持久化清理；不扩展旧模块没有的操作。
- [x] 日志类别和详情按权限隔离，敏感请求 / 返回 / 异常 / 差异字段沿用后端脱敏规则。
- [x] 生产 Edge 桌面、停机失败、隔离 PostgreSQL 清理、相关测试、lint、类型和前后端构建通过。
- [x] 稳定截图视觉复核；已检查操作日志明色、差异详情暗色和差异列表暗色，内容、主题、表格、弹窗和按钮均可读。

## 验收证据

- 最终报告：C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-3061b2b9c3da4f279ecf6bf09b0cad08/evidence/log-browser-baseline.json，passed、cleanupPassed、containerRemoved 均为 true；API、代理、Edge 和 PostgreSQL 容器均已停止 / 清理，5016 端口已释放。
- 真实服务阶段覆盖四类日志写入、分页、日期空结果、详情、差异比较、XLSX 导出、普通账号和匿名拒绝；持有日志查询权限的临时租户进一步验证跨租户分页、详情为空和清空拒绝。
- 后端日志服务统一执行租户过滤、日期范围校验、详情权限校验和超级管理员清空；SysConfig 更新产生真实差异记录。历史日志详情、导出、请求 / 返回 / 异常和差异敏感列由 LogDataSanitizer 脱敏，差异 SQL / 无上下文参数不再返回。
- 生产 Edge 桌面覆盖操作、异常、访问、差异四页，操作 / 异常详情、差异详情、明暗主题、清空取消 / 确认和停机后的可见错误反馈；截图位于同一 evidence 目录。
- 工程验证：LogDataSanitizerTests、RoutePermissionUtilTests 合计 56 / 56 通过；API / Test 构建、前端生产构建、类型检查、ESLint、node --check 通过。dotnet test 在本机 .NET 10 + Microsoft Testing Platform 下拒绝旧 VSTest target，改用构建后的测试 DLL 直接执行；antdv lint 仅回显参数，不计为有效检查。

## Comments

- 2026-10-10：提案 26 已提交，开始核对旧日志服务、实体和菜单权限。暂未修改提案原文或用户已有 `AGENTS.md`。
- 2026-10-10：提案 27 完成。最终 Edge 真实报告与清理通过，已用 view_image 检查操作日志明色、差异详情暗色和差异列表暗色；只提交本项相关文件，下一项为 28。
