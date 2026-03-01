[根目录](../../CLAUDE.md) > [Admin.NET](../) > **Admin.NET.Core**

# Admin.NET.Core

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：SysAuthService 完整登录流程（账号/手机/注册/刷新Token/退出/验证码） |
| 2026-03-01 | 补扫：SqlSugarFilter、Utils 全目录、SysUserService、SysTenantService |
| 2026-03-01 | 初始生成 |

---

## 模块职责

核心基础库，承载整个平台的：
- 所有系统实体（SysUser、SysTenant、SysMenu 等 40+ 张表）
- 所有系统服务（Auth、User、Tenant、Role、Org、Menu、CodeGen 等 50+ 个服务）
- 基础设施（SqlSugar ORM、缓存、SignalR、ElasticSearch、日志）
- 公共特性（Attribute）、枚举（Enum）、常量（Const）、工具类（Utils）

---

## 入口与启动

Core 层本身不含 `Program.cs`，由 `Admin.NET.Web.Core` 的 `Startup.cs` 调用以下扩展方法完成注册：

```csharp
services.AddCache();
services.AddSqlSugar();
services.AddElasticSearchClients();
services.AddLoggingSetup();
services.AddCaptcha();
```

SqlSugar 初始化入口：`SqlSugar/SqlSugarSetup.cs`

---

## 对外接口

所有服务均实现 `IDynamicApiController`，由 Furion 自动生成 REST API 端点。主要服务分组：

| 服务 | 路径 | 说明 |
|------|------|------|
| `SysAuthService` | `Service/Auth/` | 登录、退出、刷新Token、验证码、用户注册 |
| `SysUserService` | `Service/User/` | 用户 CRUD、重置密码、角色分配、状态管理 |
| `SysTenantService` | `Service/Tenant/` | 租户管理、租户数据库初始化、菜单授权、租户切换 |
| `SysRoleService` | `Service/Role/` | 角色管理、菜单权限分配 |
| `SysOrgService` | `Service/Org/` | 机构树管理 |
| `SysMenuService` | `Service/Menu/` | 菜单树、按钮权限 |
| `SysCodeGenService` | `Service/CodeGen/` | 代码生成器（读表结构、生成前后端代码） |
| `SysDatabaseService` | `Service/DataBase/` | 数据库管理（建表、字段管理） |
| `SysJobService` | `Service/Job/` | 定时任务管理 |
| `SysFileService` | `Service/File/` | 文件上传/下载（本地/OSS/SSH） |
| `SysLogOpService` | `Service/Log/` | 操作日志、访问日志、异常日志、差异日志 |
| `SysNoticeService` | `Service/Notice/` | 系统通知（SignalR 推送） |
| `SysOnlineUserService` | `Service/OnlineUser/` | 在线用户管理 |
| `SysConfigService` | `Service/Config/` | 系统参数配置 |
| `SysDictTypeService` / `SysDictDataService` | `Service/Dict/` | 数据字典 |
| `SysWechatService` | `Service/Wechat/` | 微信公众号/小程序/支付 |
| `SysAlipayService` | `Service/Alipay/` | 支付宝支付 |
| `SysOAuthService` | `Service/OAuth/` | 第三方 OAuth 登录 |
| `SysOpenAccessService` | `Service/OpenAccess/` | 开放接口（Signature 认证） |
| `SysLangService` / `SysLangTextService` | `Service/Lang/` | 多语言管理 |
| `SysScheduleService` | `Service/Schedule/` | 自定义调度任务 |
| `SysServerService` | `Service/Server/` | 服务器硬件信息 |
| `SysPluginService` | `Service/Plugin/` | 插件管理 |
| `APIJSONService` | `Service/APIJSON/` | APIJSON 动态查询 |

SignalR Hub：`Hub/OnlineUserHub.cs`（接口：`IOnlineUserHub`）

---

## SysAuthService 接口详情

文件：`Service/Auth/SysAuthService.cs`

依赖注入：`UserManager`、`SysUserService`、`SysTenantService`、`SysMenuService`、`SysOnlineUserService`、`SysConfigService`、`SysSmsService`、`SysLdapService`、`SysCacheService`、`IEventPublisher`、`ICaptcha`

| 方法 | 访问控制 | 说明 |
|------|----------|------|
| `Login(LoginInput)` | `[AllowAnonymous]` | 账号密码登录，支持验证码、密码错误次数限制、LDAP 域登录 |
| `LoginPhone(LoginPhoneInput)` | `[AllowAnonymous]` | 手机号 + 短信验证码登录 |
| `UnLockScreen(password)` | 已登录 | 验证锁屏密码（支持 LDAP） |
| `GetUserInfo()` | 已登录 | 获取当前登录用户完整信息（机构、职位、按钮权限、角色、水印） |
| `GetRefreshToken(accessToken)` | 已登录 | 刷新 Token（黑名单校验 + JWT 验证） |
| `Logout()` | 已登录 | 退出登录，Token 写入黑名单，发布 `LoginOut` 事件 |
| `GetCaptcha()` | `[AllowAnonymous]` | 获取验证码（返回 Base64 图片 + CodeId） |
| `UserRegistration(UserRegistrationInput)` | `[AllowAnonymous]` | 用户自助注册（需租户开启注册功能，按注册方案分配角色/机构） |
| `SwaggerCheckUrl()` | `[AllowAnonymous]` | Swagger 登录状态检查（返回 200/401） |
| `SwaggerSubmitUrl(SpecificationAuth)` | `[AllowAnonymous]` | Swagger 登录提交（临时禁用验证码后调用标准登录） |

### 账号密码登录流程

```
1. 检查密码错误次数缓存（超限抛 D1027）
2. 若开启验证码，校验验证码（失败抛 D0008）
3. GetLoginUserAndTenant() — 查用户 + 查租户（租户禁用抛 Z1003）
4. 检查账号状态（禁用抛 D1017）
5. 若开启 LDAP 域登录：
   - 有域账号 → LDAP 验证
   - 无域账号 → 本地密码验证（SM2 解密后比对）
6. 清空密码错误次数缓存
7. CreateToken() — 生成 JWT + RefreshToken
```

### CreateToken 内部流程

```
1. SingleLogin() — 单用户登录踢出旧会话
2. JWTEncryption.Encrypt() — 生成 AccessToken
   Claims: UserId, TenantId, Account, RealName, AccountType,
           OrgId, OrgName, OrgType, LangCode
3. GenerateRefreshToken() — 生成 RefreshToken
4. SetTokensOfResponseHeaders() — 写入响应头
5. 更新用户最后登录 IP / 地址 / 时间 / 设备
6. IEventPublisher.PublishAsync(SysUserEventTypeEnum.Login, payload)
```

### 密码验证规则

- 前端传输：固定使用 SM2 加密
- 存储验证：根据 `CryptoType` 配置选择 MD5 或 SM2/SM4 解密后比对
- 错误计数：缓存 30 分钟，超过 `SysPasswordMaxErrorTimes`（默认 5 次）锁定

### Token 黑名单机制

退出时将 Token 写入缓存 `blacklist:token:{token}`，过期时间与 Token 有效期一致，刷新 Token 时也会检查黑名单。

---

## SysUserService 接口详情

文件：`Service/User/SysUserService.cs`

依赖注入：`UserManager`、`SysOrgService`、`SysUserExtOrgService`、`SysUserRoleService`、`SysConfigService`、`SysOnlineUserService`、`SysUserMenuService`、`SysCacheService`、`SysUserLdapService`、`IEventPublisher`

| 方法 | 说明 |
|------|------|
| `Page(PageUserInput)` | 分页查询用户，支持按机构/账号/姓名/职位/手机过滤，关联机构、职位、角色、域账号 |
| `AddUser(AddUserInput)` | 新增用户，校验账号/手机唯一性，禁止越权创建管理员，默认密码取系统配置，发布 `Add` 事件 |
| `RegisterUser(AddUserInput)` | 注册用户（`[NonAction]`，供内部调用），发布 `Register` 事件 |
| `UpdateUser(UpdateUserInput)` | 更新用户，角色/机构变更时强制下线，清除机构缓存，发布 `Update` 事件 |
| `DeleteUser(DeleteUserInput)` | 删除用户，禁止删除租户默认账号和开放接口绑定账号，级联删除角色/扩展机构/域账号/收藏菜单 |
| `GetBaseInfo()` | 获取当前登录用户基本信息 |
| `UpdateBaseInfo(SysUser)` | 更新当前用户基本信息（忽略账号、密码、类型、机构、职位） |
| `SetStatus(UserInput)` | 启用/禁用账号，禁用时加入黑名单缓存并强制下线 |
| `GrantRole(UserRoleInput)` | 授权用户角色，发布 `UpdateRole` 事件 |
| `ChangePwd(ChangePwdInput)` | 修改密码，前端 SM2 加密传输，支持 MD5/SM2/SM4 验证，可配置密码强度校验 |
| `ResetPwd(ResetPwdUserInput)` | 重置密码为随机6位字符，清空密码错误次数缓存 |
| `UnlockLogin(UnlockLoginInput)` | 解除登录锁定，清空密码错误次数缓存 |
| `GetOwnRoleList(userId)` | 获取用户已拥有的角色 ID 列表 |
| `GetOwnExtOrgList(userId)` | 获取用户扩展机构列表 |
| `SetLangCode(langCode)` | 更新当前用户界面语言 |

关键业务规则：
- 超级管理员（`AccountTypeEnum.SuperAdmin`）不可被非超管创建/更新/删除
- 账号和手机号全局唯一（跨租户 `ClearFilter()` 检查）
- 角色或机构变更时自动触发强制下线

---

## SysTenantService 接口详情

文件：`Service/Tenant/SysTenantService.cs`

| 方法 | 说明 |
|------|------|
| `Page(PageTenantInput)` | 分页查询租户，关联用户/机构信息 |
| `GetList()` | `[AllowAnonymous]` 获取启用中的租户列表（用于登录页租户选择） |
| `GetCurrentTenantSysInfo()` | 根据当前请求 Host 匹配租户信息 |
| `GetTenantDbList()` | 获取库隔离类型的租户列表 |
| `AddTenant(AddTenantInput)` | 新增租户，自动初始化机构/角色/职位/管理员账号/默认菜单 |
| `UpdateTenant(UpdateTenantInput)` | 更新租户，同步更新机构名/管理员账号/手机/邮箱 |
| `DeleteTenant(DeleteTenantInput)` | 删除租户，级联删除用户/角色/机构/职位/菜单/关联数据 |
| `SetStatus(TenantInput)` | 启用/禁用租户（不可操作默认租户） |
| `GrantMenu(TenantMenuInput)` | 授权租户菜单，自动追加父级菜单，检查重复路由 |
| `GetTenantMenuList(BaseIdInput)` | 获取租户已授权菜单 ID 集合 |
| `ResetPwd(TenantUserInput)` | 重置租户管理员密码 |
| `ChangeTenant(BaseIdInput)` | 切换当前用户所属租户，返回新 Token |
| `GoTenant(BaseIdInput)` | 超管进入租管端，以租户管理员身份获取 Token |
| `SyncGrantMenu(BaseIdInput)` | 同步授权菜单（版本升级后用于补齐新菜单） |
| `CreateDb(TenantInput)` | 为库隔离租户创建独立数据库并初始化表结构 |
| `UserList(TenantIdInput)` | 获取租户下所有用户列表 |
| `GetTenantDbConnectionScope(tenantId)` | 获取租户数据库连接作用域（懒加载，线程安全） |
| `CacheTenant(tenantId)` | 刷新租户缓存，连接字符串以 SM2 加密存储 |

租户类型：
- `TenantTypeEnum.Id`：ID 隔离，共用主库，通过 `TenantId` 字段区分数据
- `TenantTypeEnum.Db`：库隔离，每个租户独立数据库连接

---

## 数据权限过滤器（SqlSugarFilter）

文件：`SqlSugar/SqlSugarFilter.cs`

三层过滤机制，在 SqlSugar 查询时自动注入：

| 方法 | 触发时机 | 说明 |
|------|----------|------|
| `SetOrgEntityFilter(db)` | 每次查询 | 根据用户最大数据范围（`DataScopeEnum`）注入机构 ID 过滤条件 |
| `SetDataScopeFilter(db)` | 内部调用 | 若数据范围为"仅本人"，对所有 `EntityBaseOrg*` 实体追加 `CreateUserId` 过滤 |
| `SetCustomEntityFilter(db)` | 每次查询 | 加载实现 `IEntityFilter` 接口的自定义过滤器 |
| `DeleteUserOrgCache(userId, dbConfigId)` | 用户更新时 | 清除用户机构集合、最大数据范围、按钮权限缓存 |
| `DeleteCustomCache(userId, dbConfigId)` | 用户更新时 | 清除自定义过滤器缓存 |

数据范围枚举（`DataScopeEnum`）：
- `All`：全部数据
- `Self`：仅本人数据（追加 `CreateUserId = userId` 条件）
- 其他值：按机构 ID 集合过滤（`IOrgIdFilter` 接口）

自定义过滤器扩展点：实现 `IEntityFilter` 接口，返回 `IEnumerable<TableFilterItem<object>>`，框架启动时自动发现并注册。

---

## 工具类（Utils/）

共 29 个文件，按功能分类：

### 通用工具

| 文件 | 主要方法 | 说明 |
|------|----------|------|
| `CommonUtil.cs` | `GetFixedHashCode`、`GetIpAddress`、`GetClientDeviceInfo`、`ExportExcelTemplate/Data`、`ImportExcelData`、`ParseList` | 通用静态工具，IP 解析（IPTools）、设备信息（UAParser）、Excel 导入导出（Magicodes.IE） |
| `DateTimeUtil.cs` | `ConvertUnixTime`、`GetTodayRange`、`GetWeekRange`、`GetMonthRange`、`GetYearRange` 等 | 时间工具，支持 Unix 时间戳互转、各种时间范围计算 |
| `SafeMath.cs` | 安全数学运算 | 防溢出数学计算 |
| `ReflectionUtil.cs` | `GetDescriptionValue<T>` | 反射工具，获取字段自定义特性 |
| `RegularValidate.cs` | 正则验证 | 常用正则校验（手机、邮箱等） |
| `PathTreeBuilder.cs` | 路径树构建 | 目录树结构生成 |

### 加密工具

| 文件 | 说明 |
|------|------|
| `CryptogramUtil.cs` | 统一加密入口，支持 MD5 / SM2 / SM4（ECB/CBC）三种模式，从配置读取 `CryptoType`、公私钥 |
| `TripleDES.cs` | 3DES 加解密 |
| `GM/GMUtil.cs` | 国密算法实现（SM2/SM4），底层调用 BouncyCastle |
| `GM/GM.cs` | 国密算法辅助 |

### 文件与 Excel

| 文件 | 说明 |
|------|------|
| `FileHelper.cs` | 文件操作辅助 |
| `ExcelHelper.cs` | Excel 操作（Magicodes.IE） |
| `MiniExcelUtil.cs` | 轻量 Excel 读写（MiniExcel） |
| `XlsxFileResult.cs` | Excel 文件响应结果 |
| `VerifyFileExtensionName.cs` | 文件扩展名校验 |

### 基础输入/输出模型

| 文件 | 说明 |
|------|------|
| `BaseIdInput.cs` | 单 ID 输入基类 |
| `BasePageInput.cs` | 分页输入基类（Page、PageSize、SearchKey） |
| `BaseStatusInput.cs` | 状态输入基类 |
| `BaseFilter.cs` | 基础过滤器 |
| `BaseImportInput.cs` | 导入输入基类 |
| `AdminResultProvider.cs` | 统一响应结果包装 |

### 其他工具

| 文件 | 说明 |
|------|------|
| `ComputerUtil.cs` | 服务器硬件信息（CPU、内存、磁盘） |
| `CodeGenUtil.cs` | 代码生成辅助方法 |
| `SSHHelper.cs` | SSH 连接与文件传输（SSH.NET） |
| `GiteeHelper.cs` | Gitee API 调用辅助 |
| `ChinaDateTimeConverter.cs` | 中国时区 DateTime JSON 转换器 |
| `CustomJsonPropertyConverter.cs` | 自定义 JSON 属性转换器 |
| `NewtonsoftJsonSerializerProvider.cs` | Newtonsoft.Json 序列化提供者 |
| `TenantHeaderOperationFilter.cs` | Swagger 租户 Header 参数过滤器 |

---

## 关键依赖与配置

主要 NuGet 包（`Admin.NET.Core.csproj`）：

| 包 | 用途 |
|----|------|
| `Furion.Pure 4.9.7` | 框架核心（DI、动态API、异常、配置） |
| `SqlSugarCore 5.1.4` | ORM（多库、多租户、Code First） |
| `SqlSugar.MongoDbCore` | MongoDB 支持 |
| `NewLife.Redis` | Redis 客户端 |
| `Elastic.Clients.Elasticsearch 9.x` | ES 客户端 |
| `Magicodes.IE.*` | Excel/PDF/Word 导入导出 |
| `MiniExcel` | 轻量 Excel 读写 |
| `OnceMi.AspNetCore.OSS` | OSS 对象存储（阿里云/腾讯云/MinIO） |
| `SKIT.FlurlHttpClient.Wechat.*` | 微信 SDK |
| `AlipaySDKNet.Standard` | 支付宝 SDK |
| `BouncyCastle.Cryptography` | 国密 SM2/SM4 |
| `Yitter.IdGenerator` | 雪花ID |
| `Lazy.Captcha.Core` | 验证码 |
| `AspNetCoreRateLimit` | 接口限流 |
| `RabbitMQ.Client` | RabbitMQ 消息队列 |
| `SSH.NET` | SSH 文件传输 |
| `log4net` | 日志 |
| `IPTools.Core` | IP 地址解析 |
| `UAParser` | User-Agent 设备信息解析 |

---

## 数据模型

### 实体基类层次

```
EntityBaseId          (Id: long 雪花ID)
  └── EntityBase      (+ CreateTime, UpdateTime, CreateUserId, UpdateUserId)
        ├── EntityBaseDel         (+ IsDelete, DeleteTime) — 软删除
        ├── EntityBaseOrg         (+ OrgId) — 机构数据权限
        │     └── EntityBaseOrgDel
        ├── EntityBaseTenant      (+ TenantId) — 租户隔离
        │     └── EntityBaseTenantDel
        └── EntityBaseTenantOrg   (+ TenantId + OrgId) — 租户+机构双隔离
              └── EntityBaseTenantOrgDel
```

### 核心实体（Entity/）

| 实体 | 说明 |
|------|------|
| `SysUser` | 用户（账号、密码、角色、机构、职位、登录信息） |
| `SysTenant` | 租户（类型、数据库连接、域名、注册配置） |
| `SysOrg` | 机构（树形结构） |
| `SysRole` / `SysRoleMenu` / `SysRoleOrg` | 角色及权限关联 |
| `SysMenu` | 菜单（路由、按钮、权限标识） |
| `SysConfig` | 系统参数 |
| `SysDictType` / `SysDictData` | 数据字典 |
| `SysFile` / `SysFileProvider` | 文件记录 |
| `SysJobDetail` / `SysJobTrigger` / `SysJobTriggerRecord` | 定时任务 |
| `SysLogOp` / `SysLogEx` / `SysLogVis` / `SysLogDiff` | 各类日志 |
| `SysNotice` / `SysNoticeUser` | 通知 |
| `SysOnlineUser` | 在线用户 |
| `SysCodeGen` / `SysCodeGenConfig` | 代码生成配置 |
| `SysWechatUser` / `SysWechatPay` | 微信用户/支付 |
| `SysAlipayAuthInfo` / `SysAlipayTransaction` | 支付宝 |
| `SysLang` / `SysLangText` | 多语言 |
| `SysTemplate` | 消息模板 |
| `SysRegion` | 行政区划 |
| `SysOpenAccess` | 开放接口密钥 |

---

## 测试与质量

- 测试项目：`Admin.NET.Test`（独立项目，引用 Core）
- 测试框架：xUnit + Furion.Xunit
- 当前覆盖：工具类（DateTimeUtil、SafeMath）、用户基础操作
- 缺口：服务层业务逻辑、多租户场景、权限过滤器

---

## 常见问题 (FAQ)

**Q: 如何新增一个业务实体并自动建表？**
继承合适的 `EntityBase*` 基类，添加 `[SugarTable]` 特性，启动时 `EnableInitTable: true` 会自动建表。

**Q: 如何切换数据库类型？**
修改 `Configuration/Database.json` 中的 `DbType` 和 `ConnectionString`，支持 SQLite / MySQL / PostgreSQL / SQL Server / Oracle 等。

**Q: 如何开启 Redis 缓存？**
修改 `Configuration/Cache.json`，将 `CacheType` 改为 `Redis`，并配置连接字符串。

**Q: 多租户如何隔离数据？**
实体继承 `EntityBaseTenant*`，SqlSugar 全局过滤器（`SqlSugarFilter.cs`）会自动追加 `TenantId` 条件。

**Q: 如何实现自定义数据权限过滤？**
实现 `IEntityFilter` 接口，在 `AddEntityFilter()` 方法中返回 `TableFilterItem<object>` 集合，框架会自动发现并注册。

**Q: 密码加密如何配置？**
在 `App.json` 的 `Cryptogram` 节点配置 `CryptoType`（MD5/SM2/SM4）、公私钥。前端传输固定使用 SM2，存储加密类型可独立配置。

---

## 相关文件清单

```
Admin.NET.Core/
├── Attribute/          # 自定义特性（数据脱敏、字典、幂等、种子数据等）
├── Cache/              # 缓存注册（CacheSetup.cs）
├── Const/              # 常量（CacheConst、ClaimConst、ConfigConst、SqlSugarConst）
├── ElasticSearch/      # ES 客户端工厂与注册
├── Entity/             # 所有实体模型（40+ 个）
├── Enum/               # 枚举定义
├── Extension/          # 扩展方法
├── Hub/                # SignalR Hub（OnlineUserHub）
├── Logging/            # 日志配置（log4net）
├── Service/            # 所有系统服务（50+ 个，按业务分子目录）
│   ├── Auth/SysAuthService.cs      # 登录认证（账号/手机/注册/Token/退出）
│   ├── User/SysUserService.cs      # 用户管理（含事件发布）
│   └── Tenant/SysTenantService.cs  # 租户管理（含库隔离初始化）
├── SignalR/            # SignalR 注册
├── SqlSugar/           # ORM 初始化、过滤器、仓储
│   └── SqlSugarFilter.cs           # 数据权限过滤器（机构/本人/自定义）
└── Utils/              # 工具类（29 个文件）
    ├── CommonUtil.cs               # 通用工具（IP、设备、Excel、XML）
    ├── CryptogramUtil.cs           # 加密工具（MD5/SM2/SM4 统一入口）
    ├── DateTimeUtil.cs             # 时间工具（范围计算、Unix 互转）
    ├── GM/                         # 国密算法（SM2/SM4）
    └── ...                         # 其余 25 个工具文件
```
