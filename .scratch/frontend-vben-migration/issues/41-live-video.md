# 41：直播与视频工具

Status: ready-for-agent
Execution: completed

来源：doc/frontend-vben-tickets-draft.md，第 41 项。

## 范围

复用旧页面实际使用的 ezuikit-js 8.0.5、Token / ezopen 输入和 standard 控制栏。SDK 的播放、停止、录制及全屏控制保留；旧树和多窗口占位未接业务。只验证桌面端，使用真实 API 与 PostgreSQL。SDK 独立 iframe 随停止、切换或离页移除，不保留示例凭据。

## 验收

- [x] 9 项输入及会话边界回归、ESLint、应用类型检查和生产构建通过。
- [x] 授权测试设备真实出帧与原有标准控制的验收要求由用户明确豁免；生产 SDK 资源 HTTP 200 已验证，真实播放未确认。
- [x] 真实错误认证、加载中停止、显式退出及同文档离页关闭播放器；草稿保留和退出清除可验证。
- [x] 桌面明暗截图实际复核，无横向溢出。
- [x] 测试菜单四关联表、API 和隔离 PostgreSQL 资源清理通过。

## 已通过证据

新应用锁定 ezuikit-js 8.0.5。安装版本源码确认 standard 模板返回的 iframe 播放器没有 destroy；通过可移除的独立执行 iframe 释放事件、网络和局部认证。真实生产报告 adminnet-vben-8034bd3905dc4045b9b098e18435a2af/evidence/live-browser-baseline.json 为 production-error-and-resource-cleanup 范围，7 个阶段 passed=true、cleanupPassed=true，realPlaybackConfirmed=false。错误提示和重试可用，浏览器无异常，离页后外部播放器 iframe 与 WebSocket 关闭，菜单四关联表和摘要恢复，API / PostgreSQL 已回收。已实际查看两张 1680×1100 明暗截图；详细报告、源码与截图 SHA256 见 ../live-error-cleanup-acceptance.json。

## 用户暂缓历史

2026-10-12，用户明确表示“暂时没有，先跳过吧”。第 41 项不计为完成，继续第 42 项。官方动态 Token 接口成功不代表设备权限；当前 README 明确设备 BD3957004 的真实 device/info 返回 10031，两个官方静态示例配对返回 10002。没有输出或持久化 Token 原值，也未以假播放器代替真实首帧。

恢复时需要本机授权测试配置 JSON，含同主体或已分享设备权限的 accessToken 与 ezopen url；随后执行生产真实播放、停止、录制或全屏等已支持控制，并验证切换及清理。错误处理范围的成功报告不能替代该项完整验收。

## 用户最新验收决定

2026-10-13：用户明确要求“不需要进行真实播放验收，41直接通过”。本决定替代此前暂缓及恢复条件，第 41 项按用户豁免完成。已有单测、生产资源、错误处理、停止、离页清理及桌面视觉证据保留；realPlaybackConfirmed 仍为 false，不声称真实首帧或播放控制已经验证。

## Comments

2026-10-13：Issue 插件上报 41 返回 not-found，本项按仓库既有编号 Markdown 约定更新；未创建远端票或新的地图。完成数更新为 45 / 48，继续第 46 项。
