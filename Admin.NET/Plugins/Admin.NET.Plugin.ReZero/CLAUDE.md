[根目录](../../../../CLAUDE.md) > [Admin.NET](../../../) > [Plugins](../../) > **Admin.NET.Plugin.ReZero**

# Admin.NET.Plugin.ReZero

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：SuperApiAop 完整拦截逻辑（JWT 校验、日志记录、错误处理） |
| 2026-03-01 | 初始生成 |

---

## 模块职责

ReZero 超级 API 插件，提供：
- 动态 API 生成（无需编写 Controller，通过配置生成接口）
- AOP 拦截（JWT 权限校验、操作日志记录）
- 菜单种子数据注入

---

## 入口与启动

```csharp
public class Startup : AppStartup { }
```

配置选项：`Option/ReZeroOptions.cs`

---

## 对外接口

### SuperApiAop

文件：`Service/SuperApiAop.cs`

继承自 `DefaultSuperApiAop`，集成 Admin.NET 权限体系到 ReZero 动态 API。

| 方法 | 触发时机 | 说明 |
|------|----------|------|
| `OnExecutingAsync(aopContext)` | 接口执行前 | JWT Bearer 认证校验 + Token 有效性验证，失败抛出 `Oops.Oh` 异常 |
| `OnExecutedAsync(aopContext)` | 接口执行后 | 记录 `Information` 级别操作日志 |
| `OnErrorAsync(aopContext)` | 接口执行异常 | 记录 `Error` 级别错误日志 |

### 权限校验流程

```
1. HttpContext.AuthenticateAsync(JwtBearerDefaults) — Bearer 认证
2. 若认证失败 → 抛出 "没权限 Unauthorized"
3. JWTEncryption.Validate(token) — 验证 Token 有效性
4. 若 Token 无效 → 抛出 "Token 无效"
5. 调用 base.OnExecutingAsync() — 继续 ReZero 默认处理
```

### 日志记录内容

日志通过 `ILoggerFactory` 写入系统日志（`CommonConst.SysLogCategoryName`），使用 `ScopeContext` 携带结构化数据：

```json
{
  "requestUrl": "/api/rezero/...",
  "httpMethod": "POST",
  "displayTitle": "接口名称",
  "controllerName": "ReZero动态-{GroupName}",
  "remoteIPv4": "x.x.x.x",
  "userAgent": "...",
  "returnInformation": { "httpStatusCode": 200 },
  "authorizationClaims": [
    { "type": "Account", "value": "admin" },
    { "type": "RealName", "value": "管理员" }
  ],
  "exception": null
}
```

---

## 相关文件清单

```
Admin.NET.Plugin.ReZero/
├── Option/ReZeroOptions.cs
├── SeedData/SysMenuSeedData.cs     # 菜单种子数据
├── Service/SuperApiAop.cs          # AOP 拦截器（JWT 校验 + 日志）
├── GlobalUsings.cs
└── Startup.cs
```
