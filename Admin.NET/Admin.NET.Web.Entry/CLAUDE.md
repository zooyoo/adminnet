[根目录](../../CLAUDE.md) > [Admin.NET](../) > **Admin.NET.Web.Entry**

# Admin.NET.Web.Entry

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 初始生成（补扫 Program.cs） |

---

## 模块职责

程序宿主入口，负责：
- 启动 ASP.NET Core 应用（`Serve.Run`）
- 配置 Kestrel 服务器参数（超时、上传大小）
- 设置日志过滤规则
- 托管静态资源（`wwwroot/`）

---

## 入口与启动

文件：`Program.cs`

```csharp
// 顶级语句，一行启动
Serve.Run(RunOptions.Default.AddWebComponent<WebComponent>());

public class WebComponent : IWebComponent
{
    public void Load(WebApplicationBuilder builder, ComponentContext componentContext)
    {
        // 日志过滤：屏蔽 Microsoft.Hosting / Microsoft.AspNetCore 的 Info 以下日志
        builder.Logging.AddFilter((provider, category, logLevel) =>
        {
            return !new[] { "Microsoft.Hosting", "Microsoft.AspNetCore" }
                .Any(u => category.StartsWith(u)) && logLevel >= LogLevel.Information;
        });

        // Kestrel 配置
        builder.WebHost.ConfigureKestrel(u =>
        {
            u.Limits.KeepAliveTimeout = TimeSpan.FromMinutes(30);      // 长连接保活 30 分钟
            u.Limits.RequestHeadersTimeout = TimeSpan.FromMinutes(30); // 请求头超时 30 分钟
            u.Limits.MaxRequestBodySize = null;                        // 不限制请求体大小（支持大文件上传）
        });
    }
}
```

实际的服务注册（DI、中间件管道）由 `Admin.NET.Web.Core` 的 `Startup.cs` 通过 Furion 组件机制完成，`WebComponent` 仅负责宿主级配置。

---

## 关键配置说明

| 配置项 | 值 | 说明 |
|--------|-----|------|
| `KeepAliveTimeout` | 30 分钟 | 适配长时间文件上传/下载场景 |
| `RequestHeadersTimeout` | 30 分钟 | 同上 |
| `MaxRequestBodySize` | `null`（无限制） | 允许上传任意大小文件，生产环境建议配合 Nginx 限制 |
| 日志级别 | `>= Information` | 过滤掉 ASP.NET Core 框架的 Debug/Trace 噪音日志 |

---

## 常见问题 (FAQ)

**Q: 如何修改监听端口？**
在 `Admin.NET.Application/Configuration/App.json` 中修改 `Urls` 配置，或通过环境变量 `ASPNETCORE_URLS` 覆盖。

**Q: 上传大文件报 413 错误？**
`MaxRequestBodySize = null` 已在 Kestrel 层取消限制，若部署在 Nginx 反向代理后，还需在 Nginx 配置 `client_max_body_size`。

**Q: 如何修改日志级别？**
修改 `Program.cs` 中的 `logLevel >= LogLevel.Information` 阈值，或在 `appsettings.json` 的 `Logging` 节点配置。

---

## 相关文件清单

```
Admin.NET.Web.Entry/
├── Program.cs              # 启动入口（Kestrel 配置、日志过滤）
├── wwwroot/                # 静态资源（前端构建产物、上传文件目录）
├── Properties/
│   └── launchSettings.json # 开发环境启动配置（端口、环境变量）
└── Admin.NET.Web.Entry.csproj
```
