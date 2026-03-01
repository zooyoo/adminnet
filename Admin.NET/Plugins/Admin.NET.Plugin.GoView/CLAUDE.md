[根目录](../../../../CLAUDE.md) > [Admin.NET](../../../) > [Plugins](../../) > **Admin.NET.Plugin.GoView**

# Admin.NET.Plugin.GoView

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：GoViewProService 完整接口、GoViewSysService 登录适配逻辑、预览图/背景图 Base64 存储方案 |
| 2026-03-01 | 初始生成 |

---

## 模块职责

GoView 大屏可视化插件，提供：
- 大屏项目管理（创建、编辑、发布、删除）
- 大屏数据存储（项目配置 JSON + 预览图/背景图 Base64）
- 与 GoView 前端的登录/鉴权适配（复用 Admin.NET 账号体系）

---

## 入口与启动

```csharp
public class Startup : AppStartup { }
```

自定义结果提供器：`Util/GoViewResultProvider.cs`（适配 GoView 前端响应格式，使用 `[UnifyProvider("GoView")]`）

---

## 对外接口

### GoViewProService

文件：`Service/GoViewPro/GoViewProService.cs`

API 路由前缀：`goview/project`

| 方法 | HTTP | 说明 |
|------|------|------|
| `GetList(page, limit)` | GET | 获取项目列表（分页，默认 12 条/页） |
| `Create(input)` | POST `/Create` | 新增项目，返回新项目 ID |
| `Edit(input)` | POST | 修改项目基本信息（忽略空列） |
| `Delete(ids)` | POST `/Delete` | 批量删除项目及其数据（`[UnitOfWork]`） |
| `Publish(input)` | PUT | 修改发布状态（草稿/发布） |
| `GetData(projectId)` | GET `/GetData` | `[AllowAnonymous]` 获取项目详情（含配置 JSON） |
| `SaveData(input)` | POST `/save/data` | 保存项目配置 JSON（存在则更新，不存在则插入） |
| `Upload(file)` | POST | 上传预览图，转 Base64 存入 `GoViewProData.IndexImageData` |
| `GetIndexImage(id)` | GET `/GetIndexImage` | `[AllowAnonymous]` 获取预览图（Base64 转 PNG 流返回） |
| `UploadBackGround(file)` | POST | 上传背景图，转 Base64 存入 `GoViewProData.BackGroundImageData` |
| `GetBackGroundImage(id)` | GET `/GetBackGroundImage` | `[AllowAnonymous]` 获取背景图（Base64 转 PNG 流返回） |

图片存储说明：预览图和背景图均以 Base64 字符串存入数据库，不依赖 OSS。文件名格式 `{projectId}_xxx.png`，从文件名解析项目 ID。

### GoViewSysService

文件：`Service/GoViewSys/GoViewSysService.cs`

API 路由前缀：`goview/sys`

| 方法 | HTTP | 说明 |
|------|------|------|
| `Login(input)` | POST | `[AllowAnonymous]` GoView 登录，复用 `SysAuthService.Login()`，临时禁用验证码，返回 GoView 格式 Token |
| `GetLogout()` | GET | 退出登录，调用 `SysAuthService.Logout()` |
| `GetOssInfo()` | GET | `[AllowAnonymous]` 获取 OSS 上传接口（当前返回空 BucketURL，图片走 Base64 方案） |

登录适配细节：
- 临时将验证码开关缓存设为 `false`，调用标准登录后恢复
- 密码在传入前用 SM2 加密
- 返回 `GoViewLoginOutput`（含 `Userinfo` 和 `Token.TokenValue = "Bearer {accessToken}"`）

---

## 数据模型

| 实体 | 说明 |
|------|------|
| `GoViewPro` | 大屏项目（名称、状态枚举、封面） |
| `GoViewProData` | 大屏项目数据（`Content` JSON、`IndexImageData` Base64、`BackGroundImageData` Base64） |

枚举：`GoViewProStateEnum`（草稿/发布）

---

## 相关文件清单

```
Admin.NET.Plugin.GoView/
├── Const/GoViewConst.cs
├── Entity/GoViewPro.cs
├── Entity/GoViewProData.cs
├── Enum/GoViewProStateEnum.cs
├── Service/GoViewPro/
│   ├── GoViewProService.cs         # 项目 CRUD + 图片上传/获取
│   └── Dto/                        # Input/Output DTO
├── Service/GoViewSys/
│   ├── GoViewSysService.cs         # 登录适配 + OSS 接口
│   └── Dto/                        # Input/Output DTO
├── Util/GoViewResultProvider.cs    # 自定义响应格式
├── GlobalUsings.cs
└── Startup.cs
```
