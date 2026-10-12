# 47：旧前端清理与可发布构建

Status: ready-for-agent
Execution: in-progress

## 目标与范围

在隔离 worktree 删除旧源码及无消费者依赖，证明生产构建只使用新应用，保留专业引擎与后端调度看板。主清理依赖第 46 项整体闭票；第 41 项按用户指令暂缓，不能由清理静默关闭。

## 验收

- [x] 固定 770 文件清单、逐文件 SHA256、本地回退引用及 4 份部署配置备份。
- [x] 隔离副本移除 7 个无消费者 catalog，真实静态/动态构建依赖图无旧 UI 包，保留 9 个专业/目标包。
- [x] 无原 node_modules 或共享 junction，冻结离线安装且锁文件哈希不变；手写 lint、类型检查、473 项回归、生产构建通过。
- [x] 独立后端 Release 解决方案构建、140 项代码生成和 5 项菜单事务回归通过。
- [x] 清理副本经真实 Nginx HTTP/TLS、PostgreSQL、登录、文件、SignalR、调度 SSE 13 阶段验证，临时记录、物理文件、代理、API、PG 均回收。
- [ ] 第 41 项真实播放及第 46 项整体闭票后，将已核对清单应用主工作区并确认正式清理完成。

## 证据

- cleanup47-acceptance.json：完整脱敏浏览器报告、源码/工具/日志/依赖图/产物及已实际查看截图哈希。
- cleanup47-plan.json：固定清单及保留范围，无旧源码正文或凭据。
- cleanup47-reproduction.md：可复现命令和输出边界。
- 真实报告：C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-cd51b915027946bb9a2f7e0cc5db150e/evidence/cleanup47-browser-baseline.json。

## 进度

2026-10-13：已验范围通过；主工作区 770 个旧文件的原始字节仍保留，完成数维持 44 / 48。继续准备第 48 项本地发布候选，不进行外部生产切换。
