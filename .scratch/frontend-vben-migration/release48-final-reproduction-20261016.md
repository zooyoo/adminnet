# 第 48 项最终本地切换与验收

2026-10-16（Asia/Shanghai）：按用户调整后的范围完成。第 47 项已提交 `bd6fc1f6fbd524051534bb7e6e0cce5180c863c2`；本项复用其 447 个生产文件，未再次构建。生产部署未执行，仍须独立授权。

## 新包与真实验收

- 官方新包有 452 个载荷文件，ZIP 共 453 个 entry；清单 SHA256 为 `88ed326897062e279a46530ff9c49411c53088d03ae279ac93bbd893152c7d38`，ZIP SHA256 为 `93e704e27a0db9d54845454c28e8d9b846bb0faf5e614765b672216994da91ef`。损坏候选被拒，合格候选激活到本轮 D:/tmp 本地目标，实际入口 HTML 与选定清单一致。
- HTTP 与 TLS 分别验证首次手动登录。有效旧 Cookie 和 8 个旧存储键未触发自动登录，手动登录前鉴权请求均为 0；定向清理旧键后登录业务码均为 200，其他存储保留。
- 真实 PostgreSQL、API、桌面 Playwright 验证菜单 CRUD、文件上传/图片预览/鉴权下载、SignalR 业务帧与主动退出，以及独立调度看板认证和 SSE。该业务测试未 Mock API；调度夹具无触发器，不代表实际任务执行验收。
- 8 张 1680 × 1100 截图已由主会话实际 read_image 并核对 SHA256。看板 iframe 自身保持浅色；上传及 TLS 登录图有成功提示，按瞬态记录。
- 文件表全行、物理文件、配置、完整原授权、稳定行摘要与在线连接已恢复，随后才停止本轮资源并删除 PostgreSQL 容器。原始失败现场不借销毁容器冒充恢复。

## 标准测试结果与留存

Playwright Test 1.64.0：1 个 worker，retries=0，2 项通过、0 项失败、0 项 flaky，退出码 0。其中 1 项为上述真实桌面 PostgreSQL 业务流程，另 1 项只验证 Mock 页面下的浏览器存储生命周期。

已执行命令：

```powershell
$ErrorActionPreference = 'Stop'
& 'D:/tool/PowerShell/pwsh.exe' -NoLogo -NoProfile -NonInteractive -File 'D:/tmp/main48-playwright-final-09025bd2f9764b409be03b18e444fd2e/run-tests.ps1'
if ($LASTEXITCODE -ne 0) { throw 'Playwright 验收失败' }
```

本轮实际执行时间为 2026-10-16 15:56:17 至 15:59:01（Asia/Shanghai）。报告、截图和完整日志保留在 `D:/tmp/main48-playwright-final-09025bd2f9764b409be03b18e444fd2e`；`playwright-report.json` 是标准框架报告，`acceptance.json` 和 `engine-e2e/runs/.../evidence/main47-desktop.json` 保存真实业务与 PostgreSQL 恢复记录。本轮成功后没有重复执行。脚本固定了当时的 Git 基线，未来回归应使用新的隔离测试上下文和当前基线，不覆写原报告。

## 限定结论与人工核验

页面关闭后在同浏览器新页恢复登录的真实检查未通过且调试超过 30 分钟，依据当前 AGENTS.md 第 50 行熔断。Mock 只证明浏览器 localStorage/sessionStorage 的生命周期，不证明产品会话恢复；该产品分支保持 realValidationPassed=false。人工待核验：

1. 在本地验收环境手动登录后关闭当前页，在同一浏览器重新打开文件管理地址，核对是否维持登录。
2. 若显示登录页，手动登录并确认文件列表可见，最后退出登录。

回退演练按用户 2026-10-16 明确要求取消：cancelled-by-user / passed=false / executed=false。没有激活旧包。原 3 项 Native 与第 41 项真实播放继续按用户豁免，passed=false。生产现场域名、证书、配置与切换不在本次授权范围。测试代理地址已随清理关闭，本地候选目录仅作为留存产物。

当前小索引：[release48-final-acceptance-20261016.json](./release48-final-acceptance-20261016.json)。旧 release48-acceptance.json、旧失败报告及其 flags 保留为历史，不改写为成功。
