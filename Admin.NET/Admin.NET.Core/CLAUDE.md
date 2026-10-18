# Admin.NET.Core

本文件补充[仓库规则](../../AGENTS.md)，适用于本项目。这里同时包含系统领域服务与共享基础设施，不是只放实体的纯领域库。

## 职责与依赖

- 承载认证、用户、租户、角色、菜单、组织、文件等系统能力，以及 SqlSugar、缓存、事件、调度和日志的公共实现。
- `Admin.NET.Application` 和各插件依赖本项目；本项目不反向引用应用层、Web 宿主或插件。共享能力应放在适当的现有目录，具体集成留给上层组装。
- 当前目标框架为 `net8.0;net10.0`，以 [Admin.NET.Core.csproj](Admin.NET.Core.csproj) 的条件引用为准。

## 定位入口

| 变更内容 | 入口 |
| --- | --- |
| 登录、刷新与退出 | [SysAuthService](Service/Auth/SysAuthService.cs) |
| 用户状态、角色与组织关联 | [SysUserService](Service/User/SysUserService.cs) |
| 租户生命周期与库隔离 | [SysTenantService](Service/Tenant/SysTenantService.cs) |
| 数据库注册、初始化与过滤器装配 | [SqlSugarSetup](SqlSugar/SqlSugarSetup.cs) |
| 机构、数据范围与自定义过滤 | [SqlSugarFilter](SqlSugar/SqlSugarFilter.cs) |
| 实体隔离与审计字段 | [EntityBase.cs](Entity/EntityBase.cs)、`Entity/` |
| 缓存注册 | [CacheSetup](Cache/CacheSetup.cs) |

服务通常通过 Furion 动态 API 暴露。修改公开方法前检查路由、DTO、授权特性和现有调用方；不要仅凭方法名推断 HTTP 契约。实际启动与基础设施注册由 [Web.Core](../Admin.NET.Web.Core/CLAUDE.md) 组装。

## 必须保持的领域约束

- 用户账号和手机号的唯一性检查包含跨租户查询；修改 `ClearFilter()` 时核对它服务的业务约束及显式条件。普通业务查询不能借此绕过租户、机构或数据权限。
- 用户类型和管理员权限有独立校验。新增、更新、禁用、删除用户时，检查角色与组织关联、在线状态、事件发布及缓存失效是否仍配套执行；不能只更新用户主表。
- 登录、刷新和退出共同维护 JWT、用户状态、黑名单与在线用户状态。改变其中一个入口时同时核对其他入口，不能把令牌签名有效等同于当前用户仍有权限。
- 租户包含 Id 隔离和独立数据库两类路径。租户切换、数据库作用域、初始化与租户缓存需要一起检查；跨租户管理入口仍须保留管理员权限和目标租户约束。
- `SqlSugarSetup` 装配软删除、租户与权限过滤，`SqlSugarFilter` 计算机构和数据范围。调整实体继承、过滤接口或查询时，核对普通用户、管理员和不同租户的结果。组织或权限变更须同步考虑 `DeleteUserOrgCache`、`DeleteCustomCache` 等缓存失效入口。
- 建表、种子数据初始化受配置开关控制。实体、种子和初始化流程的修改可能影响已有数据库，必须说明数据兼容与重复执行行为。

## 构建与验收

以下命令从 `Admin.NET/` 执行：

```powershell
$ErrorActionPreference = 'Stop'
dotnet build Admin.NET.Core/Admin.NET.Core.csproj -c Debug
if ($LASTEXITCODE -ne 0) { throw 'Core 构建失败' }
dotnet test --project Admin.NET.Test/Admin.NET.Test.csproj
if ($LASTEXITCODE -ne 0) { throw '后端测试失败' }
```

测试项目按 `User/`、`Tenant/`、`Role/`、`File/` 等领域组织，扩展现有测试时先核对被测方法与测试替身。测试使用 `Admin.NET/global.json` 选择的 Microsoft.Testing.Platform，不能把仓库根目录下的 VSTest 参数直接套用。

涉及租户隔离、权限过滤、事务或初始化的变更，需要在隔离的真实 PostgreSQL 上核验查询结果与数据变化；Mock 只能证明相应逻辑，不能替代这些集成结论。其他通用测试与文档检查要求遵循仓库规则。
