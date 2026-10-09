# 17 文件管理、上传下载与图片预览

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 17 项。仅桌面验收。

## 验收清单

- [x] 恢复文件查询、上传、编辑元数据、下载、删除和图片预览，使用公共表格及现有 API。
- [x] 保留上传大小和类型限制、取消及失败草稿，重复提交与迟到响应不能污染新会话。
- [x] 验证文件读写权限、租户与公开文件边界，阻止正文改写存储路径及身份。
- [x] 真实下载内容和中文文件名正确，二进制鉴权错误不重复提示，生产图片资源可用。
- [x] 真实 API/生产桌面、契约、工程检查、稳定截图与清理通过；进度和本记录随 17、18 联合提交。

## 交付与证据

- 保留 `/platform/file` 和旧组件地址；新增 Antdv-Next 文件页、公共文件 API 适配层及受认证预览。查询、上传、编辑、删除、中文下载均走现有 API，表格复用公共实现。
- 服务端使用元数据白名单、显式文件权限、租户与公开读写边界、准确字节大小校验。本地私有静态资源在图片处理前被拒绝；删除存储失败保留数据库记录。
- MD5 去重限定名称、后缀、路径、租户和创建者等上下文；修复头像/签名复用相同 ID 后误删文件。真实脚本通过 `-FileDeduplication` 覆盖重复上传。
- 个人头像明确公开；签名保留私有并通过当前用户专用认证读取。通知图片复用同一上传适配层，公开标志显式传入。
- 元数据对应说明见 `doc/frontend-vben-files.md`：旧 `relationName/relationId/belongId` 在当前实体和 SDK 中无持久化合同，保留实际 `DataId/FileAlias`，不虚构关系管理。

| 验收边界 | 结果与证据 |
| --- | --- |
| 后端构建及测试 | API 独立构建通过；测试 exe 232 项通过，包含文件隔离、字段白名单、大小边界和权限映射；排除既有 Selenium `Admin.NET.Test.User.UserTest` |
| 前端单元 | 文件类型/预览生命周期、二进制响应和请求拦截器合计 37 项通过 |
| 工程检查 | 冻结 lockfile 安装、类型检查、ESLint 和生产构建通过；ESLint 3 条既有警告；专业引擎大 chunk 告警保留 |
| 生产桌面契约 | 10 项通过，含上传校验/失败/取消竞态、编辑白名单、权限按钮、二进制错误单次提示、对象 URL 释放及个人设置回归；报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-file-ui-SjUf9F/file-contract-baseline.json` |
| 真实 API 与生产桌面 | 最终 7 阶段 `passed=true`，含跨租户私有拒绝、公开共享只读、普通账号有权操作及无权拒绝、大小/类型/名称校验、直链保护、真实 CRUD、中文内容下载、MD5 和个人图片；报告见下 |
| 视觉 | 已实际查看明暗列表、真实图片、个人头像签名、Office/PDF/媒体及错误截图；稳定成功态与真实 502 错误态分开记录 |
| 清理 | 最终 `cleanupPassed=true`：角色授权、个人图片字段恢复并反查；本项 `SysFile` 与物理文件删除并反查；API、代理及浏览器已停止 |

最终真实证据目录：

`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-0901fd2c1db24262b0592aeb6e232b4b/evidence/`

报告：`file-browser-baseline.json`。图片：`file-list-dark.png`、`file-list-light.png`、`file-image.png`、`file-profile-images.png`、`file-outage.png`。原始测试文件和真实浏览器下载保留在同目录。

真实边界为本地存储与隔离 SQLite，不将其扩写为 OSS/SSH 外部部署已验收。`antdv lint` 仅回显参数，未计为有效检查；实际依据 ESLint、类型和浏览器。部署私有资源与历史公开标志说明见迁移文档。

## Comments

- 2026-10-09：第 16 项提交 `c6c535967` 后开始。旧文件页还提供文件类别、公开状态与关联字段编辑，应一并保留。Office/PDF/媒体引擎由第 18 项接续。
- 2026-10-09：按用户新要求统一完成 17、18，证据分边界记录后联合提交。已复核真实浏览器 Skill，并将取消、身份切换、截图和去重经验补充到 `references/lessons.md`。
