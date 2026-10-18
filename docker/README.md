# Docker 部署说明

本目录保留后端、前端构建与运行模板。当前模板的 .NET 版本、前端构建方式和 API 端口尚未与项目完全对齐，使用前须完成下列核对。文档中的命令以 `docker/` 为工作目录，使用 Docker Compose v2 的 `docker compose`。

## 文件与已知差异

| 文件 | 当前内容与使用边界 |
| --- | --- |
| [docker-compose-builder.yml](docker-compose-builder.yml) | `net-builder` 使用 SDK 9.0 并执行解决方案构建，不能构建当前 .NET 10 入口；`web-builder` 使用 npm 安装与构建，仍沿用旧单包配置挂载，需按当前 pnpm workspace 调整。 |
| [docker-compose.yml](docker-compose.yml) | `adminNet` 使用 ASP.NET 9.0，挂载 `bin/Release/net9.0/`；需统一为 .NET 10 运行时和实际发布目录。 |
| [Web 入口 Dockerfile](../Admin.NET/Admin.NET.Web.Entry/Dockerfile) | 基础镜像仍为 ASP.NET 6.0，不能直接运行当前 .NET 10 发布物；它通过 `COPY . .` 接收预先发布的内容，未提供 SDK 构建阶段。 |
| [nginx.conf](nginx/conf/nginx.conf) | 静态目录挂载自 `../Web/dist/`，`/prod-api/` 与 `/schedule` 代理到 `adminNet:5005`；Compose 的 API 映射却为 `9102:5050`，须与应用实际监听端口统一。 |
| [wait-for-it.sh](app/wait-for-it.sh) | 当前 API 启动命令等待 `mysql:3306`，且 `depends_on` 包含 MySQL、Redis；切换数据库时须同步调整依赖和等待目标。TCP 可连接不代表数据库初始化或 API 已就绪。 |

运行模板包含 Nginx、MySQL、Redis、MinIO、TDengine 和 API，未使用 `profiles` 隐藏其中的数据库服务。直接对运行模板执行 `up -d` 会尝试启动全部服务，不能认为 MySQL、TDengine 默认未启用。

## 构建与配置准备

1. 安装 Docker Engine / Docker Desktop 和 Compose v2。宿主构建后端需可用的 .NET 10 SDK；前端版本要求以 [Web 说明](../Web/README.md) 和 `Web/package.json` 为准。
2. 核对部署用数据库、缓存与外部服务配置。`app/Configuration/` 会覆盖发布目录中的同名配置，不能假定其中的 `Database.json` 无须修改。容器内的服务地址应与 Compose 网络名称或外部服务地址一致，Redis 服务端与客户端的认证设置须匹配。
3. 按上表调整镜像、发布目录、依赖和端口。数据库测试使用隔离的真实 PostgreSQL；当前模板没有 PostgreSQL 服务，需另行准备连接，不能用模板中的 MySQL 或 SQLite 代替验收环境。
4. 核对前端 API 基础地址与 Nginx 的 `/prod-api/` 前缀，按当前应用配置设置；不要沿用旧单包应用的环境文件路径。HTTPS 还需按自己的域名配置证书与 Nginx 挂载，不使用示例证书作为部署凭据。

可以先在宿主生成后端发布物，再将 `adminNet` 的 `/app` 挂载指向该目录：

```powershell
$ErrorActionPreference = 'Stop'
dotnet publish ../Admin.NET/Admin.NET.Web.Entry/Admin.NET.Web.Entry.csproj -c Release -f net10.0 -o ../Admin.NET/Admin.NET.Web.Entry/bin/Release/net10.0/publish
if ($LASTEXITCODE -ne 0) { throw '后端发布失败' }
```

前端从 workspace 根目录构建。当前应用的 Vite 配置将输出指向 `Web/dist/`，与 Nginx 的静态目录挂载对应：

```powershell
$ErrorActionPreference = 'Stop'
Push-Location ../Web
try {
    pnpm install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw '前端依赖安装失败' }
    pnpm build
    if ($LASTEXITCODE -ne 0) { throw '前端构建失败' }
}
finally {
    Pop-Location
}
```

若选择容器内构建，先修正 `docker-compose-builder.yml` 的 SDK、pnpm 工具链、构建命令与挂载路径；现有 `dotnet build` 产物不应与完整的 `dotnet publish` 发布目录混用。

## 检查与运行

完成配置对齐后，先检查 Compose 语法。`--quiet` 避免把展开后的配置和凭据打印到终端：

```powershell
$ErrorActionPreference = 'Stop'
docker compose -p adminnet -f docker-compose.yml config --quiet
if ($LASTEXITCODE -ne 0) { throw '运行模板检查失败' }
docker compose -p adminnet-builder -f docker-compose-builder.yml config --quiet
if ($LASTEXITCODE -ne 0) { throw '构建模板检查失败' }
```

语法检查不能证明镜像版本、挂载内容和连接配置可用。确认所需服务及初始化行为后启动，并检查状态：

```powershell
$ErrorActionPreference = 'Stop'
docker compose -p adminnet -f docker-compose.yml up -d
if ($LASTEXITCODE -ne 0) { throw '容器启动失败' }
docker compose -p adminnet -f docker-compose.yml ps
if ($LASTEXITCODE -ne 0) { throw '容器状态查询失败' }
```

使用固定且一致的项目名管理同一套容器。运行模板与构建模板使用不同项目名，避免互相清理容器。停止并移除运行容器的命令为：

```powershell
$ErrorActionPreference = 'Stop'
docker compose -p adminnet -f docker-compose.yml down
if ($LASTEXITCODE -ne 0) { throw '运行容器清理失败' }
```

若使用过构建模板，以 `docker compose -p adminnet-builder -f docker-compose-builder.yml down` 清理其容器；`down` 是子命令，不能写成 `up down`。清理前确认项目名，不添加删除数据卷的参数。

## 访问与验收

按当前端口映射，前端 HTTP 入口是 `http://<主机>:9100`，HTTPS 入口是 `https://<域名>:9103`；HTTPS 需证书配置有效。API 映射的宿主端口为 `9102`，能否访问取决于修正后的容器监听端口。MinIO 映射 `9104` 为 API、`9105` 为控制台，其他暴露端口以运行模板为准。

首次验收检查静态页面、桌面端登录、API 请求与反向代理，以及必要的文件资源访问。涉及数据库的场景核对真实 PostgreSQL 数据；同时确认容器重启后的服务和持久化状态。容器显示 `running`、TCP 检查通过或 Mock 通过均不足以证明真实集成验收完成。
