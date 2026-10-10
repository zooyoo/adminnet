// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Globalization;

namespace Admin.NET.Core.Service;

/// <summary>
/// 开放接口身份服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 244)]
public class SysOpenAccessService : IDynamicApiController, ITransient
{
    private static readonly object BindingSnapshotKey = new();
    private readonly SqlSugarRepository<SysOpenAccess> _sysOpenAccessRep;
    private readonly SysCacheService _sysCacheService;
    private readonly UserManager _userManager;

    public SysOpenAccessService(SqlSugarRepository<SysOpenAccess> sysOpenAccessRep,
        SysCacheService sysCacheService, UserManager userManager)
    {
        _sysOpenAccessRep = sysOpenAccessRep;
        _sysCacheService = sysCacheService;
        _userManager = userManager;
    }

    /// <summary>
    /// 生成签名，保持 METHOD&amp;PATH&amp;ACCESSKEY&amp;TIMESTAMP&amp;NONCE 协议
    /// </summary>
    [HttpPost]
    [DisplayName("生成签名")]
    [SuppressMonitor]
    public string GenerateSignature(GenerateSignatureInput input)
    {
        if (!Enum.IsDefined(input.Method)) throw Oops.Oh("请求方法无效");
        var method = input.Method.ToString().ToUpperInvariant();
        var timestamp = input.Timestamp.ToString(CultureInfo.InvariantCulture);
        if (!SignatureProtocol.TryValidate(method, input.Url, input.AccessKey, input.AccessSecret, timestamp, input.Nonce, out var error))
            throw Oops.Oh(error);
        return SignatureProtocol.GenerateSignature(method, input.Url, input.AccessKey, input.AccessSecret, timestamp, input.Nonce);
    }

    /// <summary>
    /// 获取开放接口身份分页列表，授权页面保持密钥明文合同
    /// </summary>
    [HttpPost]
    [DisplayName("获取开放接口身份分页列表")]
    [SuppressMonitor]
    public async Task<SqlSugarPagedList<OpenAccessOutput>> Page(OpenAccessInput input)
    {
        EnsureManagementContext();
        var accountType = (int)_userManager.AccountType.GetValueOrDefault();
        return await _sysOpenAccessRep.AsQueryable()
            .LeftJoin<SysUser>((u, a) => u.BindUserId == a.Id)
            .LeftJoin<SysTenant>((u, a, b) => u.BindTenantId == b.Id)
            .LeftJoin<SysOrg>((u, a, b, c) => b.OrgId == c.Id)
            .WhereIF(!_userManager.SuperAdmin, (u, a, b, c) => u.BindTenantId == _userManager.TenantId &&
                a.TenantId == _userManager.TenantId && (int)a.AccountType <= accountType)
            .WhereIF(!string.IsNullOrWhiteSpace(input.AccessKey), (u, a, b, c) => u.AccessKey.Contains(input.AccessKey))
            .OrderBy((u, a, b, c) => u.Id, OrderByType.Desc)
            .Select((u, a, b, c) => new OpenAccessOutput
            {
                Id = u.Id,
                AccessKey = u.AccessKey,
                AccessSecret = u.AccessSecret,
                BindTenantId = u.BindTenantId,
                BindUserId = u.BindUserId,
                BindUserAccount = a.Account,
                BindTenantName = c.Name
            }, true)
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加开放接口身份")]
    [SuppressMonitor]
    public async Task AddOpenAccess(AddOpenAccessInput input)
    {
        EnsureManagementContext();
        ValidateCredentialFields(input);
        await ValidateBindingAsync(input.BindTenantId, input.BindUserId);
        if (await _sysOpenAccessRep.AsQueryable().AnyAsync(u => u.AccessKey == input.AccessKey))
            throw Oops.Oh("访问标识已存在");
        var openAccess = new SysOpenAccess
        {
            AccessKey = input.AccessKey,
            AccessSecret = input.AccessSecret,
            BindTenantId = input.BindTenantId,
            BindUserId = input.BindUserId
        };
        await _sysOpenAccessRep.InsertAsync(openAccess);
        InvalidateKey(input.AccessKey);
    }

    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新开放接口身份")]
    [SuppressMonitor]
    public async Task UpdateOpenAccess(UpdateOpenAccessInput input)
    {
        EnsureManagementContext();
        var existing = await GetManagedOpenAccessAsync(input.Id);
        ValidateCredentialFields(input);
        await ValidateBindingAsync(input.BindTenantId, input.BindUserId);
        if (await _sysOpenAccessRep.AsQueryable().AnyAsync(u => u.Id != input.Id && u.AccessKey == input.AccessKey))
            throw Oops.Oh("访问标识已存在");
        var openAccess = new SysOpenAccess
        {
            Id = input.Id,
            AccessKey = input.AccessKey,
            AccessSecret = input.AccessSecret,
            BindTenantId = input.BindTenantId,
            BindUserId = input.BindUserId
        };
        await _sysOpenAccessRep.AsUpdateable(openAccess)
            .UpdateColumns(u => new { u.AccessKey, u.AccessSecret, u.BindTenantId, u.BindUserId })
            .ExecuteCommandAsync();
        InvalidateKey(existing.AccessKey);
        InvalidateKey(input.AccessKey);
    }

    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除开放接口身份")]
    [SuppressMonitor]
    public async Task DeleteOpenAccess(DeleteOpenAccessInput input)
    {
        EnsureManagementContext();
        var existing = await GetManagedOpenAccessAsync(input.Id);
        await _sysOpenAccessRep.DeleteAsync(existing);
        InvalidateKey(existing.AccessKey);
    }

    [ApiDescriptionSettings(Name = "Secret"), HttpPost]
    [DisplayName("创建密钥")]
    [SuppressMonitor]
    public async Task<string> CreateSecret()
    {
        return await Task.FromResult(Convert.ToBase64String(Guid.NewGuid().ToByteArray())[..^2]);
    }

    /// <summary>
    /// 获取可绑定租户，以租户组织名称作为显示名称
    /// </summary>
    [HttpGet]
    [DisplayName("获取开放接口绑定租户")]
    [SuppressMonitor]
    public async Task<List<OpenAccessTenantOutput>> TenantList()
    {
        EnsureManagementContext();
        return await _sysOpenAccessRep.Context.Queryable<SysTenant>().ClearFilter()
            .LeftJoin<SysOrg>((t, o) => t.OrgId == o.Id)
            .Where((t, o) => t.Status == StatusEnum.Enable)
            .WhereIF(!_userManager.SuperAdmin, (t, o) => t.Id == _userManager.TenantId)
            .OrderBy((t, o) => o.Name)
            .Select((t, o) => new OpenAccessTenantOutput { Id = t.Id, Name = o.Name })
            .ToListAsync();
    }

    /// <summary>
    /// 获取租户下可绑定的启用用户
    /// </summary>
    [HttpPost]
    [DisplayName("获取开放接口绑定用户")]
    [SuppressMonitor]
    public async Task<List<OpenAccessUserOutput>> UserList(OpenAccessUserListInput input)
    {
        EnsureManagementContext();
        if (input.TenantId <= 0 || !_userManager.SuperAdmin && input.TenantId != _userManager.TenantId)
            throw Oops.Oh("无权访问该租户");
        var tenant = await LoadTenantAsync(input.TenantId);
        if (tenant?.Status != StatusEnum.Enable) throw Oops.Oh("绑定租户不存在或已停用");
        var accountType = (int)_userManager.AccountType.GetValueOrDefault();
        return await _sysOpenAccessRep.Context.Queryable<SysUser>().ClearFilter()
            .Where(u => u.TenantId == input.TenantId && u.Status == StatusEnum.Enable)
            .WhereIF(!_userManager.SuperAdmin, u => (int)u.AccountType <= accountType)
            .OrderBy(u => u.Account)
            .Select(u => new OpenAccessUserOutput { Id = u.Id, Account = u.Account, RealName = u.RealName, TenantId = u.TenantId ?? 0 })
            .ToListAsync();
    }

    /// <summary>
    /// 按访问标识实时读取绑定，避免缓存继续使用已停用或已删除的身份
    /// </summary>
    [NonAction]
    public async Task<SysOpenAccess> GetByKey(string accessKey)
    {
        if (!SignatureProtocol.IsHeaderToken(accessKey, SignatureProtocol.AccessKeyMaxLength)) return null;
        var openAccess = await _sysOpenAccessRep.AsQueryable().FirstAsync(u => u.AccessKey == accessKey);
        if (openAccess == null) return null;
        openAccess.BindTenant = await LoadTenantAsync(openAccess.BindTenantId);
        openAccess.BindUser = await LoadUserAsync(openAccess.BindUserId);
        if (!OpenAccessBinding.IsActive(openAccess)) return null;
        openAccess.BindUser.SysOrg = await _sysOpenAccessRep.Context.Queryable<SysOrg>().ClearFilter()
            .Where(o => o.Id == openAccess.BindUser.OrgId)
            .Select(o => new SysOrg { Id = o.Id, Name = o.Name, Type = o.Type })
            .FirstAsync();
        return openAccess;
    }

    [NonAction]
    private void EnsureManagementContext()
    {
        if (!_userManager.SuperAdmin && (_userManager.TenantId <= 0 || _userManager.AccountType == null ||
            !Enum.IsDefined(_userManager.AccountType.Value))) throw Oops.Oh("当前租户身份无效");
    }

    [NonAction]
    private static void ValidateCredentialFields(AddOpenAccessInput input)
    {
        if (!SignatureProtocol.IsHeaderToken(input.AccessKey, SignatureProtocol.AccessKeyMaxLength)) throw Oops.Oh("访问标识无效");
        if (string.IsNullOrWhiteSpace(input.AccessSecret) || input.AccessSecret.Length > SignatureProtocol.AccessSecretMaxLength)
            throw Oops.Oh("访问密钥无效");
    }

    [NonAction]
    private async Task ValidateBindingAsync(long tenantId, long userId)
    {
        if (tenantId <= 0 || userId <= 0) throw Oops.Oh("绑定租户和用户不能为空");
        if (!_userManager.SuperAdmin && tenantId != _userManager.TenantId) throw Oops.Oh("无权绑定该租户");
        var tenant = await LoadTenantAsync(tenantId);
        var user = await LoadUserAsync(userId);
        var binding = new SysOpenAccess { BindTenantId = tenantId, BindUserId = userId, BindTenant = tenant, BindUser = user };
        if (!OpenAccessBinding.IsActive(binding)) throw Oops.Oh("绑定租户或用户不存在、已停用或不属于该租户");
        if (!OpenAccessBinding.CanManageUser(_userManager.TenantId, _userManager.AccountType, user)) throw Oops.Oh("无权绑定更高权限的用户");
    }

    [NonAction]
    private async Task<SysOpenAccess> GetManagedOpenAccessAsync(long id)
    {
        if (id <= 0) throw Oops.Oh("凭据标识无效");
        var openAccess = await _sysOpenAccessRep.AsQueryable()
            .Where(u => u.Id == id)
            .WhereIF(!_userManager.SuperAdmin, u => u.BindTenantId == _userManager.TenantId)
            .FirstAsync();
        if (openAccess == null) throw Oops.Oh("凭据不存在或无权访问");
        if (!_userManager.SuperAdmin && !OpenAccessBinding.CanManageUser(_userManager.TenantId, _userManager.AccountType,
            await LoadUserAsync(openAccess.BindUserId))) throw Oops.Oh("无权管理该用户的凭据");
        return openAccess;
    }

    [NonAction]
    private Task<SysTenant> LoadTenantAsync(long id)
    {
        return _sysOpenAccessRep.Context.Queryable<SysTenant>().ClearFilter()
            .Where(t => t.Id == id)
            .Select(t => new SysTenant { Id = t.Id, Status = t.Status })
            .FirstAsync();
    }

    [NonAction]
    private Task<SysUser> LoadUserAsync(long id)
    {
        return _sysOpenAccessRep.Context.Queryable<SysUser>().ClearFilter()
            .Where(u => u.Id == id)
            .Select(u => new SysUser
            {
                Id = u.Id, TenantId = u.TenantId, Account = u.Account, RealName = u.RealName,
                AccountType = u.AccountType, OrgId = u.OrgId, Status = u.Status
            })
            .FirstAsync();
    }

    [NonAction]
    private void InvalidateKey(string accessKey)
    {
        _sysCacheService.Remove(CacheConst.KeyOpenAccess + accessKey);
    }

    /// <summary>
    /// Signature 身份验证事件默认实现，沿用本次验证读取的绑定快照
    /// </summary>
    [NonAction]
    public static SignatureAuthenticationEvent GetSignatureAuthenticationEventImpl()
    {
        return new SignatureAuthenticationEvent
        {
            OnGetAccessSecret = async context =>
            {
                context.HttpContext.Items.Remove(BindingSnapshotKey);
                try
                {
                    var service = context.HttpContext.RequestServices.GetRequiredService<SysOpenAccessService>();
                    var openAccess = await service.GetByKey(context.AccessKey);
                    if (openAccess == null) return string.Empty;
                    context.HttpContext.Items[BindingSnapshotKey] = openAccess;
                    return openAccess.AccessSecret;
                }
                catch (Exception ex)
                {
                    var logger = context.HttpContext.RequestServices.GetRequiredService<ILogger<SysOpenAccessService>>();
                    logger.LogError(ex, "开放接口身份验证");
                    return string.Empty;
                }
            },
            OnValidated = async context =>
            {
                context.HttpContext.Items.TryGetValue(BindingSnapshotKey, out var snapshot);
                if (snapshot is not SysOpenAccess openAccess || openAccess.AccessKey != context.AccessKey ||
                    openAccess.AccessSecret != context.AccessSecret ||
                    !OpenAccessBinding.TryCreatePrincipal(openAccess, context.Scheme.Name, out var principal))
                {
                    context.Fail("绑定租户或用户不可用");
                    return;
                }
                context.Principal = principal;
                await Task.CompletedTask;
            }
        };
    }
}
