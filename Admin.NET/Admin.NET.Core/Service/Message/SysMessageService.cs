// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Microsoft.AspNetCore.SignalR;

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统消息发送服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 370)]
public class SysMessageService : IDynamicApiController, ITransient
{
    private readonly SysCacheService _sysCacheService;
    private readonly IHubContext<OnlineUserHub, IOnlineUserHub> _chatHubContext;
    private readonly UserManager _userManager;
    private readonly SysMenuService _sysMenuService;

    public SysMessageService(SysCacheService sysCacheService,
        IHubContext<OnlineUserHub, IOnlineUserHub> chatHubContext,
        UserManager userManager,
        SysMenuService sysMenuService)
    {
        _sysCacheService = sysCacheService;
        _chatHubContext = chatHubContext;
        _userManager = userManager;
        _sysMenuService = sysMenuService;
    }

    /// <summary>
    /// 发送消息给所有人 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("发送消息给所有人")]
    public async Task SendAllUser(MessageInput input)
    {
        await PrepareMessage(input, "sysMessage:sendAllUser");
        await _chatHubContext.Clients.All.ReceiveMessage(input);
    }

    /// <summary>
    /// 发送消息给除了发送人的其他人 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("发送消息给除了发送人的其他人")]
    public async Task SendOtherUser(MessageInput input)
    {
        await PrepareMessage(input, "sysMessage:sendOtherUser");
        var hashKey = _sysCacheService.HashGetAll<SysOnlineUser>(CacheConst.KeyUserOnline);
        var exceptReceiveUsers = hashKey.Where(u => u.UserId == input.ReceiveUserId).Select(u => u).ToList();
        await _chatHubContext.Clients.AllExcept(exceptReceiveUsers.Select(t => t.ConnectionId)).ReceiveMessage(input);
    }

    /// <summary>
    /// 发送消息给某个人 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("发送消息给某个人")]
    public async Task SendUser(MessageInput input)
    {
        await PrepareMessage(input, "sysMessage:sendUser");
        var hashKey = _sysCacheService.HashGetAll<SysOnlineUser>(CacheConst.KeyUserOnline);
        var receiveUser = hashKey.Where(u => u.UserId == input.ReceiveUserId).Select(u => u).FirstOrDefault();
        // 发送消息
        await _chatHubContext.Clients.Client(receiveUser.ConnectionId ?? "").ReceiveMessage(input);
    }

    /// <summary>
    /// 发送消息给某些人 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("发送消息给某些人")]
    public async Task SendUsers(MessageInput input)
    {
        await PrepareMessage(input, "sysMessage:sendUsers");
        var hashKey = _sysCacheService.HashGetAll<SysOnlineUser>(CacheConst.KeyUserOnline);
        var receiveUsers = hashKey.Where(u => input.UserIds.Any(a => a == u.UserId)).Select(u => u).ToList();
        foreach (var receiveUser in receiveUsers)
        {
            // 发送消息
            await _chatHubContext.Clients.Client(receiveUser.ConnectionId ?? "").ReceiveMessage(input);
        }
    }
    /// <summary>
    /// REST 与 Hub 共用发送权限及可信发送者，收件连接选择沿用原行为
    /// </summary>
    private async Task PrepareMessage(MessageInput input, string permission)
    {
        if (_userManager.UserId <= 0) throw Oops.Oh("请先登录").StatusCode(401);
        if (!_userManager.SuperAdmin && !(await _sysMenuService.GetOwnBtnPermList())
            .Any(code => string.Equals(code, permission, StringComparison.OrdinalIgnoreCase)))
            throw Oops.Oh("无权发送系统消息").StatusCode(403);
        if (input == null) throw Oops.Oh("消息不能为空");

        input.SendUserId = _userManager.UserId.ToString(System.Globalization.CultureInfo.InvariantCulture);
        input.SendUserName = _userManager.RealName;
        input.SendTime = DateTime.Now;
    }

}