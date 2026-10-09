# 16 真实首页、工作台与日程

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 16 项。仅桌面验收。

## 验收清单

- [x] 核对旧首页各组件的数据来源与交互，恢复已实现功能，明确区分静态说明和未实现示例。
- [x] 工作台组件、布局配置可保存、取消和恢复，配置按身份隔离。
- [x] 日程新增、修改、删除及完成状态使用真实 API，输入校验、所有权和租户边界正确。
- [x] 核验既有提醒行为，保留关于页及明确错误反馈，不新增未实现业务。
- [x] 生产桌面真实流程、契约、相关测试、类型、lint、构建、稳定视觉和清理通过。

## 功能对应

| 旧组件或入口 | 新行为 |
| --- | --- |
| `/home`、`/home/index`、工作台 | 真实工作台 `/dashboard/home`，保留旧菜单组件路径和首页直达刷新 |
| `welcome`、静态 NoticeBar | 当前品牌欢迎文字、文档入口；原通知条没有业务 API，不伪造通知数据 |
| `myapp` | 真实收藏查询、选择、排序、保存及清空，服务端校验可访问菜单，读取过滤权限撤销结果 |
| `schedule`、`scheduleEdit` | Antdv-Next 日历、月切换、当天日程、农历、CRUD、完成/恢复；修改完成项仍先恢复未完成 |
| 布局自定义 | 1—3 列、移动、排序、添加隐藏、保存取消与默认恢复；本地键按租户及用户隔离，损坏配置恢复默认 |
| `timer` | 当前真实时钟，卸载清理计时器 |
| `about`、`version` | 项目说明、独立关于页与当前 workspace 版本，移除写死的“最新 v2.0.0” |
| `commit` | 按需请求既有 Gitee 公共记录，独立无凭据 fetch，加载失败与重试明确 |
| `echarts`、`progressing` | 旧代码为随机收入、固定 99.9% 示例，新工作台不显示虚构业务指标 |

检索日程实体、服务、Job 和旧页面未发现提醒投递实现；保留既有日程标记，不新增提醒协议。关于页、认证错误和 404 沿用实际路由。农历使用浏览器 Intl 中国历法，无旧 Element Plus 依赖。

## 证据

- 最终真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-0a99e9ba8b9b4deebbcacd3199ff6ff2/evidence/home-browser-baseline.json`；`passed`、`cleanupPassed` 均为 `true`。
- 真实 API：当前用户/租户写入、伪造身份限制、跨账号和跨租户详情/修改/删除/完成拒绝、匿名拒绝、空内容/逆序时间/非法状态拒绝、普通账号自身新增成功；数据库核对通过。
- 生产桌面：新增校验、创建/编辑/完成/恢复/删除、刷新、快捷入口保存/跳转/清空、布局取消/隐藏/恢复/刷新及同浏览器身份切换通过。公共更新接口获得真实记录；没有使用 Mock 冒充外网成功。
- 真实停止服务后返回 `502`，日程弹窗保留草稿并恢复保存按钮，数据库无写入。日程 fixture 及原收藏恢复通过；API、代理、浏览器和数据库连接全部释放。
- 已查看最终 `home-schedule.png`、`home-light.png`、`home-outage.png`：明暗主题、顶部内容、日历与操作、停机草稿清晰可见。
- 后端 209 项通过（新增日程 10 项；排除既有 Selenium `UserTest`）；前端单元 4 项、最终生产桌面契约 14 项通过。契约目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-home-ui-qNSsrm/`。
- 类型、ESLint、前后端构建通过；保留 3 条既有 lint 警告。CLI lint 仍只回显参数，不计为有效检查。后端输出：`Temp/adminnet-vben-build-16`、`Temp/adminnet-vben-test-16`。
- `.NET 10` 下旧 `dotnet test` VSTest 目标不可用，改用已构建的 xUnit v3 可执行运行器；测试不是因命令退出失败而被跳过。真实脚本首轮误用详情 query 地址，按 SDK 合同改为 `/detail/{id}` 后通过。
- 已复核真实浏览器 Skill，并补充详情路径和截图滚动恢复经验。

## Comments

- 2026-10-09：从第 15 项提交 `d03911048` 接续。初查日程详情、更新、删除和状态操作缺少所有者条件，需随真实流程补齐并验证。保留用户提案及 `DeepSeek.example` 修改。
