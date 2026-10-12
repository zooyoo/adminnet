# 45：运行时配置与生产代理

Status: ready-for-agent
Execution: completed

来源：`doc/frontend-vben-tickets-draft.md` 第 45 项；依赖 01、03、17。

- [x] 同一份 `Web/dist` 在相对及绝对 API 配置下真实登录，修改外置配置并刷新后生效，无重复前缀。
- [x] 两份实际 Nginx 模板通过语法及 HTTP/TLS 代理验证。
- [x] 真实上传、图片预览、鉴权下载及公开资源字节一致。
- [x] SignalR WebSocket 与已有调度 SSE 在代理后真实连接和收到事件。
- [x] HTML、运行时配置、哈希资源的缓存响应与深链接刷新正确。
- [x] 桌面截图和 PostgreSQL、API、文件、Nginx 所有权清理通过；补部署说明。

已完成：67 项 API / 会话 / 资源回归、ESLint、类型检查、生产构建以及 13 个真实 Nginx 验收阶段，passed 和 cleanupPassed 均为 true。

证据：`.scratch/frontend-vben-migration/runtime45-acceptance.json`，绑定源码、脚本、日志、最终报告及实际查看的桌面截图。两份模板验证 HTTP / TLS 下的登录、外置配置刷新、文件字节、SignalR 与真实调度 SSE；关闭浏览器后 PostgreSQL 在线连接数回到初始值。文件元数据、物理文件、菜单及关联、任务、Nginx、API 和 PostgreSQL 均已回收。

第 41 项真实播放依用户指令暂缓，不计完成。

TLS 代理使用本次隔离自签名证书；正式域名证书和外部发布待部署环境验收。

Dockerfile 的目标应用和 Web/dist 输出路径已核对；本项实际运行生产产物和两份 Nginx 模板，未执行完整多阶段构建镜像。
