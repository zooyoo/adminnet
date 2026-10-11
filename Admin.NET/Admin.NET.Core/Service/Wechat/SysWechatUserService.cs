// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>微信账号资料管理。</summary>
[ApiDescriptionSettings(Order = 220)]
public class SysWechatUserService : IDynamicApiController, ITransient
{
    private readonly SqlSugarRepository<SysWechatUser> _sysWechatUserRep;
    private readonly UserManager _userManager;

    public SysWechatUserService(SqlSugarRepository<SysWechatUser> sysWechatUserRep, UserManager userManager)
    {
        _sysWechatUserRep = sysWechatUserRep;
        _userManager = userManager;
    }

    [DisplayName("获取微信用户列表")]
    public async Task<SqlSugarPagedList<WechatUserProfileOutput>> Page(WechatUserInput input)
    {
        if (input.Page < 1 || input.PageSize < 1 || input.PageSize > 200) throw Oops.Oh("分页参数无效");
        if (input.TenantId < 0 || input.PlatformType.HasValue && !Enum.IsDefined(input.PlatformType.Value)) throw Oops.Oh("筛选条件无效");
        if (!_userManager.SuperAdmin && input.TenantId.HasValue && input.TenantId != _userManager.TenantId) throw Oops.Oh("无权查询其他租户");
        var tenantId = _userManager.SuperAdmin ? input.TenantId : _userManager.TenantId;
        if (!_userManager.SuperAdmin && tenantId <= 0) throw Oops.Oh("租户无效");
        // 仅投影管理资料，登录凭据不进入响应。
        return await _sysWechatUserRep.AsQueryable()
            .LeftJoin<SysUser>((wechat, user) => wechat.UserId == user.Id)
            .WhereIF(tenantId.HasValue, (wechat, user) => user.TenantId == tenantId)
            .WhereIF(input.PlatformType.HasValue, (wechat, user) => wechat.PlatformType == input.PlatformType)
            .WhereIF(!string.IsNullOrWhiteSpace(input.NickName), (wechat, user) => wechat.NickName.Contains(input.NickName))
            .WhereIF(!string.IsNullOrWhiteSpace(input.Mobile), (wechat, user) => wechat.Mobile.Contains(input.Mobile))
            .OrderBy((wechat, user) => wechat.Id, OrderByType.Desc)
            .Select((wechat, user) => new WechatUserProfileOutput
            {
                Id = wechat.Id, UserId = wechat.UserId, TenantId = user.TenantId,
                PlatformType = wechat.PlatformType, OpenId = wechat.OpenId, UnionId = wechat.UnionId,
                NickName = wechat.NickName, Avatar = wechat.Avatar, Mobile = wechat.Mobile,
                Sex = wechat.Sex, Language = wechat.Language, City = wechat.City,
                Province = wechat.Province, Country = wechat.Country
            }).ToPagedListAsync(input.Page, input.PageSize);
    }

    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加微信用户")]
    public async Task AddWechatUser(WechatUserProfileInput input)
    {
        WechatUserContracts.Validate(input);
        var ado = _sysWechatUserRep.Context.Ado;
        await ado.BeginTranAsync();
        try
        {
            // 锁定关联账号直到写入提交，避免归属检查与新增之间发生转移或删除。
            await CheckOwner(input.UserId, lockOwner: true);
            var entity = new SysWechatUser();
            WechatUserContracts.Apply(input, entity);
            await _sysWechatUserRep.InsertAsync(entity);
            await ado.CommitTranAsync();
        }
        catch
        {
            await ado.RollbackTranAsync();
            throw;
        }
    }

    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新微信用户")]
    public async Task UpdateWechatUser(UpdateWechatUserProfileInput input)
    {
        WechatUserContracts.Validate(input);
        var entity = await FindAccessible(input.Id);
        await CheckOwner(input.UserId);
        var originalUserId = entity.UserId;
        WechatUserContracts.Apply(input, entity);
        var query = WechatUserContracts.UpdateQuery(_sysWechatUserRep.AsUpdateable(entity), input.Id, originalUserId, input.UserId, _userManager.SuperAdmin, _userManager.TenantId);
        if (await query.ExecuteCommandAsync() != 1) throw Oops.Oh("微信用户已变化，请刷新后重试");
    }

    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除微信用户")]
    public async Task DeleteWechatUser(DeleteWechatUserInput input)
    {
        var entity = await FindAccessible(input.Id);
        var query = _sysWechatUserRep.AsDeleteable().Where(row => row.Id == input.Id && row.UserId == entity.UserId);
        if (!_userManager.SuperAdmin)
        {
            var tenantId = _userManager.TenantId;
            query = query.Where(row => SqlFunc.Subqueryable<SysUser>().Where(user => user.Id == row.UserId && user.TenantId == tenantId).Any());
        }
        if (await query.ExecuteCommandAsync() != 1) throw Oops.Oh("微信用户已变化，请刷新后重试");
    }

    private async Task<SysWechatUser> FindAccessible(long id)
    {
        if (id <= 0) throw Oops.Oh("微信用户标识无效");
        var entity = await _sysWechatUserRep.GetFirstAsync(row => row.Id == id);
        if (entity == null) throw Oops.Oh("微信用户不存在或无权访问");
        if (!_userManager.SuperAdmin) await CheckOwner(entity.UserId);
        return entity;
    }

    private async Task CheckOwner(long userId, bool lockOwner = false)
    {
        if (userId == 0 && _userManager.SuperAdmin) return;
        if (userId <= 0) throw Oops.Oh("请选择本租户系统用户");
        var query = _sysWechatUserRep.Context.Queryable<SysUser>();
        if (lockOwner) query = query.TranLock(DbLockType.Wait);
        var user = await query.FirstAsync(row => row.Id == userId);
        if (user == null) throw Oops.Oh("关联账号不存在或无权访问");
        WechatUserContracts.RequireAccessible(_userManager.SuperAdmin, _userManager.TenantId, user.TenantId);
    }
}
