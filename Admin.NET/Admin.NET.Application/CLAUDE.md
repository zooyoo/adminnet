[根目录](../../CLAUDE.md) > [Admin.NET](../) > **Admin.NET.Application**

# Admin.NET.Application

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 初始生成 |

---

## 模块职责

应用扩展层，是二次开发的主要落地点。负责：
- 引用 Core 层和插件，组合成完整应用
- 提供业务配置文件（Configuration/）
- 定义应用级常量、自定义实体、事件订阅
- 提供 OpenAPI 示例（DemoOpenApi.cs）

---

## 入口与启动

```csharp
// Startup.cs — 优先级 100，在 Web.Core Startup（MaxValue）之前执行
[AppStartup(100)]
public class Startup : AppStartup
{
    public void ConfigureServices(IServiceCollection services) { }
    public void Configure(IApplicationBuilder app, IWebHostEnvironment env) { }
}
```

目标框架：`net8.0;net10.0`

---

## 对外接口

- `OpenApi/DemoOpenApi.cs`：开放接口示例
- `EventBus/SysUserEventSubscriber.cs`：用户事件订阅（登录/登出/刷新Token）

---

## 关键依赖与配置

项目引用：
- `Admin.NET.Core`
- `Admin.NET.Plugin.ApprovalFlow`
- `Admin.NET.Plugin.DingTalk`
- `Admin.NET.Plugin.GoView`

### 配置文件（Configuration/）

| 文件 | 关键配置项 |
|------|-----------|
| `App.json` | 端口(5005)、雪花ID、SM2密钥、多语言、跨域 |
| `Database.json` | 数据库类型/连接串、表初始化开关、种子数据开关 |
| `JWT.json` | Token 过期时间、刷新Token配置 |
| `Cache.json` | 缓存类型（Memory/Redis）、Redis连接 |
| `Upload.json` | 上传大小限制、允许的文件类型 |
| `Email.json` | SMTP 服务器配置 |
| `SMS.json` | 阿里云/腾讯云短信配置 |
| `OAuth.json` | 微信/Gitee OAuth 配置 |
| `Wechat.json` | 微信公众号/小程序 AppId/Secret |
| `Alipay.json` | 支付宝应用配置 |
| `ElasticSearch.json` | ES 节点地址 |
| `CodeGen.json` | 代码生成器模板路径 |
| `EventBus.json` | RabbitMQ 连接配置 |
| `Captcha.json` | 验证码类型/过期时间 |
| `Limit.json` | 接口限流规则 |
| `Logging.json` | 日志级别/输出配置 |
| `Swagger.json` | Swagger 分组/标题配置 |
| `CDConfig.json` | 内容分发配置 |
| `Enum.json` | 枚举扩展配置 |

---

## 数据模型

- `Entity/TestViewSysUser.cs`：视图实体示例

---

## 测试与质量

无独立测试，由 `Admin.NET.Test` 项目覆盖。

---

## 常见问题 (FAQ)

**Q: 在哪里添加自定义业务服务？**
直接在本项目下创建 `Service/` 子目录，实现 `IDynamicApiController, ITransient`，Furion 会自动注册。

**Q: 如何修改默认端口？**
修改 `Configuration/App.json` 中的 `Urls` 字段。

**Q: 如何更换 SM2 密钥对？**
调用接口 `GET /api/sysCommon/smKeyPair` 获取新密钥对，更新 `App.json` 中的 `PublicKey`/`PrivateKey`，同步更新前端 `VITE_SM_PUBLIC_KEY`。

---

## 相关文件清单

```
Admin.NET.Application/
├── Configuration/          # 所有配置文件（JSON）
├── Const/ApplicationConst.cs
├── Entity/TestViewSysUser.cs
├── EventBus/SysUserEventSubscriber.cs
├── GlobalUsings.cs
├── OpenApi/DemoOpenApi.cs
└── Startup.cs
```
