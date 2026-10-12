# 第 48 项本地发布候选验收复现

本轮已验范围通过，整项仍待第 47 项闭票和独立生产发布授权。完成数为 44 / 48。候选来自第 47 项已验清理副本；应用基线为 3f381c3633880462a0903301a1c74136c7e5e1f0，清理清单和源码另以 SHA256 绑定。

## 已验证结果

- 发布工具 lint 通过，10 项 Node 回归覆盖拒绝损坏包、路径和锁保护、安装与失败恢复；4 项新增测试先复现 Windows 大小写别名与悬空目录联接问题，再验证修复，全部测试在 Windows 上执行且无跳过。故障注入仅用于文件系统回归，真实浏览器未 mock API。
- ZIP 实际重新解压后 verify 435 文件通过；ZIP SHA256 为 6d4ed611ace487465b6f96b61c9e4ae7e27da3c4fb74ea632f669315f37a95d4，清单 SHA256 为 cf2c1ec2ee00b085adee59b21c4b70b0d3093d4451ef777efb0d1cdf4c415838。
- 真实 Nginx HTTP / TLS 执行损坏包拒绝、原站点保留及新包切换，正常结束无长期旧发布备份；父目录挂载已验证。
- 每种协议带有效旧 token Cookie 和 8 个历史存储键访问，手动登录前鉴权请求为 0；新生产命名空间出现，旧键字节保留。
- 17 阶段真实桌面浏览器验收、文件逐字节校验、SignalR 服务端 PG 归零、独立调度 SSE 真实事件及清理通过。6 张截图已实际查看并固定哈希。

## 执行入口

使用仓库运行时提供的 Node 和 pnpm，交互式命令在 PowerShell 7 中执行并设置 `$ErrorActionPreference = 'Stop'`。

```powershell
node --test Web/scripts/deploy/frontend-release.test.mjs
node .scratch/frontend-vben-migration/prepare-release48-browser-baseline.mjs
node .scratch/frontend-vben-migration/run-release48-browser-baseline.mjs 5158
node .scratch/frontend-vben-migration/seal-release48-acceptance.mjs <本轮隔离运行目录>
```

真实流程使用 `.scratch/frontend-vben-migration/release48-control.tmp.json` 和 `cleanup47-control.tmp.json` 指向的自有临时包、候选 Release API、实际 Playwright / Edge 及隔离 PostgreSQL。控制文件不提交，既有路径仅在保留本轮候选期间有效；重建候选后须重新验证、实际查看截图并更新固定哈希。封存器只读复查端口、容器和进程，写入本功能的证据文件。

发布包通用制作、核对、自动切换、维护窗口及现场配置命令见 [CUTOVER.md](../../Web/scripts/deploy/CUTOVER.md)。当前测试使用临时自签证书；正式域名、证书、配置及生产发布由独立授权环境验收。

## 地址与证据

测试站点为 `http://127.0.0.1:51555/#/auth/login`、`https://127.0.0.1:63746/#/auth/login`，独立看板路径为 `/schedule/`。这些地址在测试清理后已关闭，仅作为历史证据。正式地址尚未授权确定。

- 发布候选：`C:/Users/zoyo/AppData/Local/Temp/adminnet-release48-7a5e852efc554e3b9f77df0f943ebbb1/adminnet-vben-candidate.zip`。
- 脱敏报告和已查看图片哈希：[release48-acceptance.json](./release48-acceptance.json)。
- 独立只读清理核验：[release48-cleanup-audit.json](./release48-cleanup-audit.json)。
- 原始真实浏览器报告：`C:/Users/zoyo/AppData/Local/Temp/adminnet-vben-f34fcf88bc5d4bd89383691f04002118/evidence/release48-browser-baseline.json`。
