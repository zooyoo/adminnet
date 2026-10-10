# 28 服务器与运行时监控

Status: ready-for-agent
Execution: completed
Blocked by: 无

来源：`doc/frontend-vben-tickets-draft.md` 第 28 项。提案 27 提交：`64e971ada`。用户要求仅桌面端、隔离 PostgreSQL、按编号逐项提交。

## 验收

- [x] 新页面展示当前授权隔离服务的真实运行时、CPU / 内存 / 磁盘等硬件和 NuGet 信息。
- [x] 沿用现有监控 API，支持手动与自动刷新；空值、GPU 采集失败和接口失败明确展示。
- [x] 自动刷新在页面离开、缓存失活和会话变化时释放，请求取消及迟到响应不污染新状态；身份变化清除旧数据，隐藏页权限恢复不重启轮询。
- [x] 原菜单地址可直达与刷新，普通 / 匿名拒绝和明确授权读取通过。
- [x] 生产 Edge 桌面明暗主题、图表、停机反馈、隔离 PostgreSQL 清理、工程验证通过。

## 验收证据

- 最终真实报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-8e5066890d1e4dc79e69e84567593d81/evidence/server-browser-baseline.json`，`passed`、`cleanupPassed`、`containerRemoved` 均为 `true`。API、Edge、代理和隔离 PostgreSQL 容器已停止 / 清理。
- 当前运行时进程 ID 与隔离 API marker 一致，数据库为 PostgreSQL；CPU 真实使用率、总 / 已用内存、磁盘读数和 46 个程序集名称 / 版本均来自当前服务。Windows CPU / 内存采集使用 WMI 并释放查询对象，动态缓存为 5 秒；运行时响应移除命令行参数。
- 超管可读，普通账号及匿名拒绝；临时租户明确获得 `sysServer:page` 后读取同一授权测试服务通过。服务指标为服务器级，未声明为租户独占资源。
- 生产桌面保留 `/platform/server` 入口，直达 / 刷新、真实读数、自动轮询、离页 12 秒无新增监控请求、回到页面、真实停机 3 类错误及最近成功读数保留通过。
- 已实际查看最终明色、暗色和底部依赖截图；后台采集失败明确显示，依赖版本可读。主题卡片背景分别为 `rgb(255, 255, 255)` 和 `rgb(28, 30, 35)`，有限动画结束后取证，不仅依赖 `html.dark`。
- 前端 Vitest 6 / 6、后端路由权限 53 / 53、ESLint、类型检查、API / Test 构建、前端生产构建和脚本语法通过。Antdv CLI lint 仍只回显参数，不计有效检查；既有构建警告保留。仅桌面验收。

## Comments

- 2026-10-10：提案 27 已提交，开始提案 28。旧 `system/server/index.vue` 的 CPU / 内存刷新函数被注释，新应用仅有生成的 SysServerApi，尚无监控页面；不复制旧假空值或默认 0% 逻辑。
- 2026-10-10：提案 28 完成，真实报告、清理及稳定截图通过。补齐 WMI 动态读数、显式授权、生命周期、空值 / 失败反馈和依赖版本显示；下一项为 29。
