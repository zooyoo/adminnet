# Vben / Antdv Next 发布候选与切换

发布包包含 html/、两份 Nginx 配置、发布工具和 release-manifest.json。清单逐文件记录大小与 SHA256，包含源代码提交号和实际外置配置文件名。打包只读取 Web/dist，不包含后端数据库配置、生产证书或浏览器登录状态。

本地发布候选通过不等于生产发布授权。正式切换前按当前提案状态完成依赖，并取得针对发布环境的独立授权；外部服务的未验业务不能由清理和发布流程静默关闭。

## 创建与核对发布包

在仓库根目录用 PowerShell 7 执行，先按 Web/README.md 的命令安装、检查并构建新应用。Node 使用本机已配置的版本。

```powershell
$ErrorActionPreference = 'Stop'
$commit = git rev-parse HEAD
if ($LASTEXITCODE -ne 0) { throw 'Cannot read source commit' }
node Web/scripts/deploy/frontend-release.mjs pack --dist Web/dist --output C:/releases/adminnet-candidate --commit $commit --version adminnet-vben-1
if ($LASTEXITCODE -ne 0) { throw 'Release packaging failed' }
node Web/scripts/deploy/frontend-release.mjs verify --root C:/releases/adminnet-candidate
if ($LASTEXITCODE -ne 0) { throw 'Release verification failed' }
```

保存工具输出的 manifestSha256 并随发布审批核对。发布目录必须是新的输出位置。传输目录或压缩包后，在目标机器重新 verify；未知文件、缺失文件、文件哈希改变或链接都会拒绝。需要 ZIP 时对发布根目录内容压缩，解压后 release-manifest.json 应位于根目录。

## 自动切换

先将包上传到独立候选目录，核对获批的清单哈希。替换现有目录必须加 --replace；目标目录应仅存前端发布文件，不存上传附件、证书或其它持久数据。

```powershell
$ErrorActionPreference = 'Stop'
node C:/releases/adminnet-candidate/deploy/frontend-release.mjs activate --release C:/releases/adminnet-candidate --target C:/sites/adminnet/current --sha <核对后的清单SHA256> --replace
if ($LASTEXITCODE -ne 0) { throw 'Release activation failed' }
```

工具先复制并校验全部候选文件，再以同一父目录内的重命名切换。独占锁防止并发切换同一目录；新目录发布失败时恢复本次临时备份，完整成功后删除本次备份，不长期保留旧发布版本。若报恢复未完成，按错误中的临时备份路径处理，不删除该备份。此机制不替代数据库备份。两个目录重命名之间有短暂窗口，发布时应安排维护时段或入口流量控制。

Nginx 的 root 指向 current/html。Docker 应挂载 current 的父目录，避免将 current 本身作为不可替换的挂载点。包中 nginx-http.conf 默认 root 为 /usr/share/nginx/html；根据实际挂载位置更新 root。把 http://adminNet:5005 换为真实内部后端地址，TLS 模板使用部署环境自己的证书。应用配置前执行 nginx -t，再重载。

运行时 API 地址按 README.md 更新 current/html 中 index.html 引用的 _app-config*.js；无需重新构建。清单记录原始候选配置，现场覆盖值应另行记录，保留不可变候选包供 verify。API、文件、Hub 共用 /prod-api，调度看板独立走同源 /schedule。

## 首次登录与验证

新应用的浏览器命名空间为 VITE_APP_NAMESPACE-VITE_APP_VERSION-prod，与旧 Vue Next Admin 的冒号键和 token Cookie 分离。旧登录不自动导入，用户首次访问重新输入账号和密码；不清除其它应用的缓存。后续新应用的同版本刷新可继续使用其自身会话。

切换后核验访问地址：站点根 /#/auth/login、已授权业务深链、/prod-api/api/sysConfig/sysInfo，以及业务页面打开的 /schedule/。检查 HTML 和 _app-config 为 no-store、带哈希资源为 immutable，真实登录、图片上传预览下载、在线用户 Hub 和调度看板独立认证与 SSE。正式域名、证书和后端权限必须在获批环境中验证。

本仓库第 48 项本地验收的地址、发布包路径和哈希记录在 .scratch/frontend-vben-migration/release48-acceptance.json。自动化完成后会关闭自有测试站点；文档中的本地历史地址不作为持续在线服务。
