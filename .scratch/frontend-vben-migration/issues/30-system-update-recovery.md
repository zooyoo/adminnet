# 提案30：系统更新、记录与恢复

- Status: ready-for-agent
- Execution: completed
- Proposal: 30 / 48
- Workspace: `E:\pri\Admin.NET`
- Started: 2026-10-10
- Completed: 2026-10-10

## 交付边界

迁移旧 `/system/update/index` 页面，兼容菜单 `/platform/update`。保留备份列表、更新日志、更新、确认还原、清空日志和显式复制 WebHook 密钥，沿用原有六项 `sysUpdate:*` 按钮权限。更新执行不增加与旧页冲突的确认流程，还原必须确认具体备份；取消不得执行还原。

真实文件操作仅在带独立标识、明确授权且可还原的隔离部署中执行。测试源码位于本次临时 API 运行目录，目标部署、发布输出与备份位于另一个带同一运行标识的临时目录，两者路径互不包含。不得覆盖当前开发工作区、当前 API 运行目录或生产实例；没有授权目标时禁用执行。

## 已核对的旧合同

- `POST /sysUpdate/list` 返回备份文件名与创建时间，物理路径由 DTO 的两种 JSON Ignore 隐藏。
- `GET /sysUpdate/logs` 返回日志数组；旧页激活时按 300ms 刷新。
- `POST /sysUpdate/update` 下载仓库 ZIP、发布后端、保留排除文件、备份并部署，按配置清理旧备份。
- `POST /sysUpdate/restore` 接收 `{ fileName }`；旧页先确认选中备份。
- `GET /sysUpdate/clear` 清空更新日志；`GET /sysUpdate/webHookKey` 获取密钥并复制。
- 已修复备份不存在假成功、发布未检查退出码、输出与错误流处理不完整、授权部署路径未限定等失败边界。

## 验收记录

- 工程检查：后端 API 构建、137 项后端边界 / 权限 / 压测回归、77 项前端会话 / 路由单元、前端类型与生产构建通过。新页面与契约 ESLint 通过；共享 fixture 的 13 项既有强制 lint 问题与 HEAD 一致，默认 ignore 与仅回显的 antdv lint 不记为通过。后端构建的 12 条既有 CS0618 警告保留记录。
- 真实 API / PostgreSQL / 隔离部署：最终报告 `C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-1e8c1da78f2b447e9920de5afe4489ba/evidence/update-browser-baseline.json` 为 `passed=true`，15 个真实阶段通过，执行器退出码 0。验证可启动的 v1 / v2 / v3 发布、授权普通账号执行、匿名及未授权拒绝、单任务互斥、排除配置保留、完整快照还原移除新增文件、仅清理所属旧备份、真实编译失败不改变文件或备份、缺失与非法还原拒绝、WebHook 稳定密钥 / 签名 / 过期 / 重放 / 日志脱敏。
- 生产桌面 Mock 契约：最终 Edge `--project=desktop` 11 / 11 通过（22.4s），覆盖普通授权账号、旧别名、确认取消、忙状态、失败保留、权限、轮询离页与密钥不泄漏。
- 生产桌面真实浏览器：真实更新、确认还原与取消不请求、成功后清日志、真实剪贴板复制且 DOM / storage / console 不泄漏、真实编译失败保留选择、KeepAlive 离页停止观察、marker 不匹配时网络前禁用、停机后错误反馈并保留备份选择和部署文件通过。
- 明暗视觉检查：已实际查看生产 Mock 1440×1000 页面及 1134×420 日志截图；最终真实 1680×1100 明暗页面、1374×420 明暗日志、520×204 还原确认以及编译失败 / 停机页面均已查看。按钮、备份选择、长日志换行和错误反馈清晰；日志使用滚动容器，页面与日志分别取证。
- 清理：最终报告 `cleanupPassed=true`、`cleanupErrors=[]`。浏览器、生产代理、隔离 API 与 ZIP 接收端释放；带标签的 PostgreSQL 容器及卷移除，独立部署目录按 GUID marker 核验后移除，证据保留。`containerRemoved` / `apiStopped` / `deploymentRemoved` / `receiverClosed` 均为 true。

## 授权目标配置

`Admin.NET.Application/Configuration/CDConfig.example` 默认关闭，不含凭据。启用前须明确配置独立的绝对根目录、根目录下的部署目录和 GUID 标识，并在根目录写入同值 `.adminnet-update-target`。根目录及部署目录必须与当前 API、工作目录和源码仓库隔离，禁止链接。可选隔离 ZIP 来源仅允许无凭据、无 query 的数字 IP URL；为空沿用原 Gitee 仓库合同。快照限制为 10,000 条目 / 512MiB，超过限制在执行前拒绝；更新和还原均先生成经过校验的原子快照。还原和更新使用同一互斥门，清日志也使用该门。失败的切换若无法回滚，会保留 `previous` 恢复目录并报告失败。WebHook 保持 HMAC(timestamp + 换行 + 密钥) 格式，要求 5 分钟内时间戳和未使用签名；SM2 / 未知模式稳定派生，明确 MD5 / SM4 保留旧值。

## 本轮已验证的运行经验

每次执行前已复核真实浏览器基线 Skill 与 lessons。前端处理 KeepAlive 离页、权限变化、请求取消与迟到响应；离页取消观察不等于服务端回滚，页面明确提示重新打开查看结果。真实、Mock、视觉及清理分别取证。

首轮 Mock 入口断言误用 `/assets/`，实际生产模块位于 `/jse/`；核对真实 HTML 入口后修正。第二轮别名跳转期间有限路由动画同时保留新旧页面，按 DOM 证据等待页面数量恢复为 1；最终 11 项通过。

首次真实报告 `adminnet-vben-833de3e9bbd54a0da376bdfad8daf35c/evidence/update-browser-baseline.json` 记录 14 个阶段通过、最终停机文本断言失败，`passed=false`、`cleanupPassed=true`；API、PostgreSQL、接收端和部署均已清理。失败 DOM 确认选择仍存在，原断言把隐藏 Select 辅助节点的重复标签和双字按钮间距混入整个表单 innerText。改为核对所选备份文件名，最终同一完整流程 15 阶段通过。通用经验已补充至 `.agents/skills/real-browser-baseline/references/lessons.md`。
