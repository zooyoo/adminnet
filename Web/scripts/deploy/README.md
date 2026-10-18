# Admin.NET 前端部署

在 Web 目录使用仓库指定的 pnpm 版本：

```powershell
pnpm install --frozen-lockfile
pnpm --filter @vben/web-antdv-next typecheck
pnpm --filter @vben/web-antdv-next build
```

生产交付目录为 Web/dist。开发命令仍为 pnpm --filter @vben/web-antdv-next dev，开发 Vite 将 /prod-api 和 /schedule 转发到本地 5005 端口。开发服务和 vite preview 仅用于开发及预览。

## 外置运行时配置

构建产物 index.html 在应用脚本之前加载 _app-config-<版本>-<哈希>.js。部署后修改该文件中的 VITE_GLOB_API_URL，再刷新浏览器即可生效；修改 API 挂载位置无需重新构建。以 index.html 实际引用的文件名为准，保留其余配置和初始化逻辑，不在配置中放入认证信息。

VITE_GLOB_API_URL 支持以下形式：

| 配置值                            | 请求示例                                           |
| --------------------------------- | -------------------------------------------------- |
| /prod-api 或 prod-api/            | /prod-api/api/sysAuth/login                        |
| https://api.example.com/prod-api/ | https://api.example.com/prod-api/api/sysAuth/login |
| https://api.example.com           | https://api.example.com/api/sysAuth/login          |
| 空字符串或 /                      | 当前站点的 /api/sysAuth/login                      |

该值是后端服务及挂载路径，不需要再添加业务 /api。尾部斜杠会统一去除；带查询、片段或用户信息的地址会在初始化时拒绝。SDK、鉴权文件资源和 /hubs/onlineUser 使用同一个地址规则。空地址要求当前站点直接承载后端 /api 与 /hubs，或配置相应根路径代理；这里提供的 Nginx 模板默认使用 /prod-api。使用不同域名或端口的 API 时，后端需允许该前端来源的 CORS 请求；HTTPS 页面应使用 HTTPS / WSS API。

## Nginx

Web/scripts/deploy/nginx.conf 用于 8080 HTTP 容器；docker/nginx/conf/nginx.conf 保留 80 HTTP 与 443 TLS 部署入口。将 Web/dist 挂载到 /usr/share/nginx/html，将对应配置放到 /etc/nginx/nginx.conf。TLS 配置中的证书和私钥路径应指向部署环境自己的文件。

两份配置中的 http://adminNet:5005 为后端服务地址，部署时替换成实际内部地址。

- /prod-api/ 的 proxy_pass 末尾含 /，只去除一次挂载前缀，保留 /api、上传资源和 /hubs 路径。
- /schedule 代理保留完整路径，供独立调度看板、其登录、资源、API 与已有事件流使用。它使用前端同源根路径，应随主 API 一起转发到实际后端。
- API 与调度代理关闭响应缓冲和代理缓存。WebSocket 显式转发 Upgrade / Connection，SSE 保持长连接。
- index.html 和外置 _app-config*.js 返回 Cache-Control: no-store；带内容哈希的资源返回一年 immutable 缓存；普通静态文件要求重新验证。
- 未匹配静态文件的页面路径回到 index.html，支持 hash 路由及刷新。
- 上传上限为 100 MB，实际允许的大小及文件类型仍由后端检查。

应用配置后先执行 nginx -t，再重载 Nginx。验证 /prod-api/api/sysConfig/sysInfo 返回业务 JSON、实际登录、文件上传预览下载、在线用户连接和调度看板事件流。仅修改外置配置时确认刷新读取到新值，HTML 与配置不应返回长缓存。

## 验证边界

本地集成验证使用隔离的真实 PostgreSQL、API、Nginx 和生产 `Web/dist/`，按目标场景核对代理、认证、上传、Hub 和事件流。逻辑 Mock 或开发服务器测试不能替代这条链路。TLS 使用临时自签名证书时，只能证明对应测试环境的代理行为；正式域名、证书与外部发布需要在目标环境核验。环境准备和桌面测试边界见[开发和验证](../../../docs/development.md)。

## 发布包、自动切换与首次登录

使用 frontend-release.mjs 将已验证的 Web/dist 打成带 SHA256 清单的发布目录；传输或解压后重新 verify，再用核对过的清单哈希执行 activate。切换先校验新目录，完整成功后清除本次临时备份，不长期保留旧发布版本。命令、Nginx 父目录挂载要求、故障恢复及现场配置边界见 [CUTOVER.md](./CUTOVER.md)。

浏览器缓存以 `VITE_APP_NAMESPACE-VITE_APP_VERSION-prod` 隔离，旧版本的 token Cookie 和冒号存储键不导入；首次访问新应用重新登录。站点登录地址为 `/#/auth/login`，独立调度看板为 `/schedule/`。测试夹具使用的临时地址随测试结束关闭，实际访问地址以当前部署环境为准。发布步骤与验收结果记录在本次交付材料中，长期维护规则见[维护说明](../../../docs/maintenance.md)。
