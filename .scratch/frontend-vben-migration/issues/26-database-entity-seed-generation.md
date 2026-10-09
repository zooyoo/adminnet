# 26 实体与种子数据生成

Status: ready-for-agent
Execution: completed
Blocked by: 24（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 26 项。用户要求顺序完成、每项提交，使用隔离 PostgreSQL，仅桌面验收。提案 25 提交：`459ce0f83`。

## 验收

- [x] 从第 24 项所选连接和表进入实体 / 种子生成，保持目标上下文。
- [x] 保留实体名、基类、命名空间、种子后缀和已有数据过滤选项；种子生成沿用已加载实体的合同。
- [x] 预览与写入共用生成结果；输出文件存在、非法目标、未授权和失败场景不覆盖无关文件。
- [x] 代表性真实 PostgreSQL 结构生成实体可编译，真实行生成的种子在隔离 PostgreSQL 可使用。
- [x] 中文、引号、换行、数字、日期、Guid、二进制等值正确编码；字段配置与类型保留。
- [x] 生产 Edge 桌面、权限、失败草稿、工程检查、清理和进度更新通过。

## 当前发现

- 原 `CreateEntity` / `CreateSeedData` 直接写文件，没有预览和已有文件保护；目标 `Position` 未限制到配置中的命名空间。
- 旧实体模板在无基类时缺少 using，注释 / 默认值未进行 C# 转义；旧种子字符串、decimal、Guid、byte[] 等格式存在编译风险。
- 种子依赖已编译实体，旧页面明确提示生成新实体后需要重新编译 / 启动；不将前端页面 CRUD 生成混入本项。

## 验收证据

- 真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-144a86b70fd2470da7e98280087a7046/evidence/database-generation-browser-baseline.json`，`passed: true`、`cleanupPassed: true`。
- 报告覆盖真实 PostgreSQL 实体预览 / 写入、预览摘要和目标文件保护、非法命名空间 / 基类、已编译 `SysPos` 种子、已有种子过滤、匿名 / 未授权拒绝、生成代码编译、种子真实回放、Edge 桌面预览 / 确认、明暗主题和停机反馈。
- 截图：同目录 `26-entity-preview-light.png`、`26-seed-preview-dark.png`，已实际复核字段上下文、目标路径、代码预览、按钮和主题可读。
- 生产契约报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-database-ui-3rUIe4/database-contract-baseline.json`，11 项通过，包含实体 / 种子预览、确认写入、失败保留草稿和旧预览失效场景。
- 工程验证：API / Core 构建、前端生产构建、类型检查、ESLint、数据库生成专项 xUnit `2 / 2`、权限回归 `38 / 38`、`node --check` 均通过。

## Comments

- 2026-10-10：提案 25 已提交，按编号开始 26；不提交用户已有 `AGENTS.md` 和提案原文改动。
- 2026-10-10：完成提案 26。新增实体 / 种子预览接口，预览和写入共享内容哈希；目标文件写入使用隔离根目录、符号链接检查、临时文件替换、目标摘要校验和明确覆盖确认。新增 Antdv-Next 生成编辑器，保留命名空间、基类、后缀、过滤已有数据和真实表上下文。修复 C# 模板 using、PostgreSQL `bytea` 类型和特殊值 literal，真实生成代码编译并在隔离 PostgreSQL 回放通过。
