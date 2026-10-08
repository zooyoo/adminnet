// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Microsoft.AspNetCore.SignalR;

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统在线用户服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 300)]
public class SysOnlineUserService : IDynamicApiController, ITransient
{
    private readonly UserManager _userManager;
    private readonly SysConfigService _sysConfigService;
    private readonly IHubContext<OnlineUserHub, IOnlineUserHub> _onlineUserHubContext;
    private readonly SqlSugarRepository<SysOnlineUser> _sysOnlineUerRep;
    private readonly SysMenuService _sysMenuService;
    private readonly SysCacheService _sysCacheService;

    public SysOnlineUserService(SysConfigService sysConfigService,
        IHubContext<OnlineUserHub, IOnlineUserHub> onlineUserHubContext,
        SqlSugarRepository<SysOnlineUser> sysOnlineUerRep,
        UserManager userManager,
        SysMenuService sysMenuService,
        SysCacheService sysCacheService)
    {
        _userManager = userManager;
        _sysConfigService = sysConfigService;
        _onlineUserHubContext = onlineUserHubContext;
        _sysOnlineUerRep = sysOnlineUerRep;
        _sysMenuService = sysMenuService;
        _sysCacheService = sysCacheService;
    }

    /// <summary>
    /// 获取在线用户分页列表 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取在线用户分页列表")]
    public async Task<SqlSugarPagedList<SysOnlineUser>> Page(PageOnlineUserInput input)
    {
        return await _sysOnlineUerRep.AsQueryable()
            .WhereIF(!_userManager.SuperAdmin, u => u.TenantId == _userManager.TenantId)
            .WhereIF(_userManager.SuperAdmin && input.TenantId > 0, u => u.TenantId == input.TenantId)
            .WhereIF(!string.IsNullOrWhiteSpace(input.UserName), u => u.UserName.Contains(input.UserName))
            .WhereIF(!string.IsNullOrWhiteSpace(input.RealName), u => u.RealName.Contains(input.RealName))
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 强制下线 🔖
    /// </summary>
    /// <param name="user"></param>
    /// <returns></returns>
    [NonValidation]
    [DisplayName("强制下线")]
    public async Task ForceOffline(SysOnlineUser user)
    {
        if (user == null || user.Id <= 0) throw Oops.Oh("请选择有效的在线连接");
        await CheckForcePermission();
        var target = await _sysOnlineUerRep.AsQueryable()
            .Where(u => u.Id == user.Id)
            .WhereIF(!_userManager.SuperAdmin, u => u.TenantId == _userManager.TenantId)
            .FirstAsync();
        if (target == null || string.IsNullOrWhiteSpace(target.ConnectionId) ||
            (!string.IsNullOrEmpty(user.ConnectionId) && target.ConnectionId != user.ConnectionId))
            throw Oops.Oh("在线连接已失效或不属于当前租户");
        await SendForceOffline(target);
    }

    [NonAction]
    public async Task ForceOfflineConnection(string connectionId)
    {
        if (string.IsNullOrWhiteSpace(connectionId)) throw Oops.Oh("请选择有效的在线连接");
        await CheckForcePermission();
        var target = await _sysOnlineUerRep.AsQueryable()
            .Where(u => u.ConnectionId == connectionId)
            .WhereIF(!_userManager.SuperAdmin, u => u.TenantId == _userManager.TenantId)
            .FirstAsync();
        if (target == null) throw Oops.Oh("在线连接已失效或不属于当前租户");
        await SendForceOffline(target);
    }

    private async Task CheckForcePermission()
    {
        if (_userManager.SuperAdmin) return;
        var permissions = await _sysMenuService.GetOwnBtnPermList();
        if (!permissions.Any(permission => string.Equals(permission, "sysOnlineUser:forceOffline", StringComparison.OrdinalIgnoreCase)))
            throw Oops.Oh("无权强制下线");
    }

    private async Task SendForceOffline(SysOnlineUser user)
    {
        if (string.IsNullOrWhiteSpace(user.ConnectionId)) return;
        await _onlineUserHubContext.Clients.Client(user.ConnectionId).ForceOffline("强制下线");
        await _sysOnlineUerRep.DeleteByIdAsync(user.Id);
        // 只清理目标连接，避免迟到的断开操作删除同账号的新连接。
        var cached = _sysCacheService.HashGetOne<SysOnlineUser>(CacheConst.KeyUserOnline, "" + user.UserId);
        if (cached?.ConnectionId == user.ConnectionId)
            _sysCacheService.HashDel<SysOnlineUser>(CacheConst.KeyUserOnline, "" + user.UserId);
        _sysCacheService.HashDel<SysOnlineUser>(CacheConst.KeyUserOnline, user.UserId + user.ConnectionId);
        if (await _sysConfigService.GetConfigValue<bool>(ConfigConst.SysLoginOutReminder))
        {
            var users = await _sysOnlineUerRep.AsQueryable().Filter("", true)
                .Where(u => u.TenantId == user.TenantId).Take(10).ToListAsync();
            await _onlineUserHubContext.Clients.Groups($"{OnlineUserHub.GroupPrefix}{user.TenantId}")
                .OnlineUserList(new OnlineUserList { RealName = user.RealName, Online = false, UserList = users });
        }
    }

    /// <summary>
    /// 发布站内消息
    /// </summary>
    /// <param name="notice"></param>
    /// <param name="userIds"></param>
    /// <returns></returns>
    [NonAction]
    public async Task PublicNotice(SysNotice notice, List<long> userIds)
    {
        var userList = await _sysOnlineUerRep.GetListAsync(u => userIds.Contains(u.UserId) && u.TenantId == notice.TenantId);
        if (userList.Count == 0) return;

        foreach (var item in userList)
        {
            await _onlineUserHubContext.Clients.Client(item.ConnectionId ?? "").PublicNotice(notice);
        }
    }

    /// <summary>
    /// 单用户登录
    /// </summary>
    /// <returns></returns>
    [NonAction]
    public async Task SingleLogin(long userId)
    {
        if (await _sysConfigService.GetConfigValue<bool>(ConfigConst.SysSingleLogin))
        {
            var users = await _sysOnlineUerRep.GetListAsync(u => u.UserId == userId);
            foreach (var user in users)
            {
                await SendForceOffline(user);
            }
        }
    }

    /// <summary>
    /// 通过用户ID踢掉在线用户
    /// </summary>
    /// <param name="userId"></param>
    /// <returns></returns>
    [NonAction]
    public async Task ForceOffline(long userId)
    {
        var users = await _sysOnlineUerRep.GetListAsync(u => u.UserId == userId);
        foreach (var user in users)
        {
            await SendForceOffline(user);
        }
    }
}
