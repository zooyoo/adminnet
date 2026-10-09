# 18 Office 与媒体文件预览

Status: ready-for-agent
Execution: completed
Blocked by: 17（已完成）

来源：`doc/frontend-vben-tickets-draft.md` 第 18 项。仅桌面验收。

## 统一实施计划

1. 第 17 项恢复文件管理、元数据白名单、权限与租户边界、真实上传下载及图片。
2. 第 18 项在同一受认证读取合同上接入既有 Vue Office 引擎和浏览器媒体能力；不使用远程样本。
3. 统一补齐取消、切换、卸载与身份变化时的资源释放。
4. 分别记录单元/契约、生产桌面真实集成、截图及清理；完成后更新进度并提交相关代码。

## 验收清单

- [x] 真实 DOCX、XLSX、PDF、音视频加载与关闭。
- [x] 不支持类型、损坏文件和服务失败有明确反馈。
- [x] 取消、切换、卸载及旧会话响应不残留资源。
- [x] 私有文件经受认证 API 读取，预览不能绕过权限及租户隔离。
- [x] 工程检查、生产桌面、稳定截图及隔离数据清理通过。

## 交付与证据

- 同一文件弹窗延迟加载既有 Vue Office DOCX、Excel、PDF 引擎；音视频复用浏览器原生播放能力。使用认证下载得到的 ArrayBuffer/Blob，不把令牌放到资源 URL，不使用远程预览服务。
- 关闭、切换、卸载、缓存页离开和身份变化时中止请求、撤销对象 URL；引擎回调检查当前代次。未知类型、损坏文件、加载超时有明确反馈。
- 本地生成真实 PNG、DOCX、XLSX、PDF、WAV 和 WebM；另生成 TXT 与损坏 DOCX。实际核验文档文字、工作簿内容、非空 PDF、媒体播放进度及关闭释放，不下载远程样本。
- 真实报告与第 17 项共用最终目录：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-0901fd2c1db24262b0592aeb6e232b4b/evidence/`，`file-browser-baseline.json` 中 7 阶段及清理全部通过。
- 视觉证据：`file-preview-文档.png`、`file-preview-工作簿.png`、`file-preview-阅读.png`、`file-preview-音频.png`、`file-preview-视频.png`、`file-preview-说明.png`、`file-preview-损坏.png`。已直接查看实际截图，正文、控制条及关闭按钮可达。
- 前端相关单元 37 项、桌面契约 10 项、后端 232 项、类型/lint/前后端构建通过；具体命令边界、既有警告和完整结果见第 17 项。生产契约报告在 `C:/Users/zoyo/AppData/Local/Temp/adminnet-file-ui-SjUf9F/`。
- 本项不改旧直播/流媒体工具，不将本地文件播放当作第 41 项已完成。媒体格式仍取决于浏览器解码能力；不支持或解码失败时明确反馈。

## Comments

- 2026-10-09：按用户本轮要求统一推进 17、18；旧交接中的“不提前推进 18”不作为本轮限制。
- 2026-10-09：完成并与 17 联合提交，真实测试资料全部由本地生成。已复核并更新真实浏览器 Skill 的可复用经验。
