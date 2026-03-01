[根目录](../../../../CLAUDE.md) > [Admin.NET](../../../) > [Plugins](../../) > **Admin.NET.Plugin.WorkWeixin**

# Admin.NET.Plugin.WorkWeixin

## 变更记录 (Changelog)

| 日期 | 说明 |
|------|------|
| 2026-03-01 | 补扫：所有 HTTP 代理接口完整方法（Auth/Department/AppChat/Tag）、配置项详情 |
| 2026-03-01 | 初始生成 |

---

## 模块职责

企业微信集成插件，提供：
- 企业微信 access_token 获取
- 部门管理（创建/修改/删除/查询）
- 标签管理
- 群聊会话管理与应用消息推送

---

## 入口与启动

```csharp
public class Startup : AppStartup { }
```

配置选项：`Option/WorkWeixinOptions.cs`

```csharp
public class WorkWeixinOptions : IConfigurableOptions
{
    public string CorpId { get; set; }      // 企业ID
    public string CorpSecret { get; set; }  // 企业微信凭证密钥
}
```

---

## 对外接口

所有接口均为 HTTP 代理（Furion `IHttpDeclarative`），直接调用企业微信 OpenAPI。

### IWorkWeixinAuthHttp

文件：`Proxy/Auth/IWorkWeixinAuthHttp.cs`

| 方法 | HTTP | URL | 说明 |
|------|------|-----|------|
| `GetToken(corpId, corpSecret)` | POST | `https://qyapi.weixin.qq.com/cgi-bin/gettoken` | 获取企业微信接口凭证（access_token） |

### IDepartmentHttp

文件：`Proxy/Department/IDepartmentHttp.cs`

| 方法 | HTTP | 说明 |
|------|------|------|
| `Create(accessToken, body)` | POST | 创建部门，返回新部门 ID |
| `Update(accessToken, body)` | POST | 修改部门信息 |
| `Delete(accessToken, id)` | GET | 删除部门 |
| `SimpleList(accessToken, id)` | GET | 获取部门 ID 列表 |
| `Get(accessToken, id)` | GET | 获取部门详情 |

### IWorkWeixinAppChatHttp

文件：`Proxy/AppChat/IWorkWeixinAppChatHttp.cs`

| 方法 | HTTP | 说明 |
|------|------|------|
| `Create(accessToken, body)` | POST | 创建群聊会话 |
| `Update(accessToken, body)` | POST | 修改群聊会话 |
| `Get(accessToken, chatId)` | GET | 获取群聊会话详情 |
| `Send(accessToken, body)` | POST | 应用推送消息到群聊 |

### ITagHttp

文件：`Proxy/Tag/ITagHttp.cs`

标签相关操作（创建/修改/删除/查询标签及成员）。

---

## 数据模型

无独立实体，通过 HTTP 代理与企业微信 API 交互。

基础响应：`Utils/BaseHttpOutput.cs`（`ErrCode`、`ErrMsg`）

---

## 常见问题 (FAQ)

**Q: access_token 如何管理？**
当前插件不内置 Token 缓存，调用方需自行缓存 `GetToken()` 返回的 access_token（企业微信 Token 有效期 7200 秒）。

**Q: 如何扩展新的企业微信 API？**
在 `Proxy/` 下新建对应目录，定义继承 `IHttpDeclarative` 的接口，在 `Startup.cs` 中注册即可。

---

## 相关文件清单

```
Admin.NET.Plugin.WorkWeixin/
├── Const/WorkWeixinConst.cs
├── Option/WorkWeixinOptions.cs         # CorpId + CorpSecret
├── Proxy/
│   ├── Auth/
│   │   ├── IWorkWeixinAuthHttp.cs      # 获取 access_token
│   │   └── Dto/WorkWeixinAuthHttpOutput.cs
│   ├── Department/
│   │   ├── IDepartmentHttp.cs          # 部门 CRUD
│   │   └── Dto/
│   ├── AppChat/
│   │   ├── IWorkWeixinAppChatHttp.cs   # 群聊 + 消息推送
│   │   └── Dto/
│   └── Tag/
│       ├── ITagHttp.cs                 # 标签管理
│       └── Dto/
├── Utils/BaseHttpOutput.cs
├── GlobalUsings.cs
└── Startup.cs
```
