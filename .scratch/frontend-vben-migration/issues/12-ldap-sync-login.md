# 12 LDAP 配置、同步与登录

Status: ready-for-agent
Execution: completed
Blocked by: 01（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 12 项。仅桌面验收。

## 验收清单

- [x] 迁移原有 LDAP 配置 CRUD、详情及同步入口，保留字段与协议。
- [x] 配置与同步操作具备明确权限及租户边界，密码不回传、不写日志。
- [x] 使用隔离目录及测试账号验证真实连接、同步、重复同步、账号映射与登录。
- [x] 验证连接失败、错误输入与服务失败恢复。
- [x] 生产桌面、契约、相关测试、类型、lint、构建及稳定截图通过。
- [x] 清理隔离数据，更新进度及交接，复核 Skill 并随本项提交代码。

## 实现

- 新增 Antdv-Next 配置列表与编辑器，复用 AdminTable、生成 SDK、既有路由 `/system/ldap`。保留主机、端口、DN、过滤器、版本、属性映射和状态，绑定密码仅输入，编辑留空保留。
- 后端按当前身份约束租户、保护更新归属、排除停用和删除配置。密码使用可逆 SM2 加密，兼容已有密文，查询不回传密码；配置写接口抑制敏感日志。
- 域登录转义过滤器中的账号，空密码不允许匿名绑定；查询失败返回通用错误，不泄漏目录诊断和凭据。
- 同步账户按当前租户的本地账号映射，重复账号拒绝，事务内替换。查询异常中止，不接受部分结果。
- 同步组织按目录编码更新当前租户，保留既有主键与非目录机构，不再调用会清空机构表的旧批量方法。兼容文本组织编码和 AD 的二进制 GUID；`syncDept` 映射到旧 `sysLdap:syncOrg` 权限。
- 删除配置软删除，同时移除该租户的域账号映射。

## 证据

- 使用临时 `osixia/openldap:1.5.0` 容器，只映射本机随机端口，实际导入 OU 与目录账号；目录密码随机生成且不输出。安装方法通过 Context7 与项目 README 核对，来源 `https://github.com/osixia/container-openldap/blob/main/README.md`。此旧镜像只用于短期隔离验收，不作为生产选型。
- 最终真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-16afcd95f2aa45559cee387e81e96f2c/evidence/ldap-browser-baseline.json`，`passed`、`cleanupPassed` 均为 `true`。
- 真实桌面新增/校验、密码留空编辑、查询脱敏、普通账号拒绝、跨租户变更拒绝、重复同步、原机构保留、目录密码登录、目录停机失败与映射保留通过。
- 已查看编辑器、同步列表、域登录与目录停机截图；凭据已遮罩，关键操作可达。
- 后端相关 193 项通过；随后新增 2 项，LDAP 专项 10 项全部通过。生产桌面契约 8 项通过：`C:/Users/zoyo/AppData/Local/Temp/adminnet-ldap-ui-f8NIHw/`。前端 lint、类型、生产构建及后端构建通过，仅既有告警；Antdv CLI lint 仍仅回显参数。
- 配置软删除、域映射清空、同步机构删除、域登录开关恢复；API 已停止，容器及匿名卷已按标签验证后删除。数据库和截图保留。Skill 已复核并补充 LDAP 验收经验。

## Comments

- 2026-10-09：第 11 项提交 `0eb5382dd` 后开始。已发现新前端仅有生成 SDK，LDAP 页面尚未迁移；正在核对旧页面和隔离目录服务可用性。
