// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统通知公告服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 380, Description = "通知公告")]
public class SysNoticeService : IDynamicApiController, ITransient
{
    private readonly UserManager _userManager;
    private readonly SqlSugarRepository<SysUser> _sysUserRep;
    private readonly SqlSugarRepository<SysNotice> _sysNoticeRep;
    private readonly SqlSugarRepository<SysNoticeUser> _sysNoticeUserRep;
    private readonly SysOnlineUserService _sysOnlineUserService;

    public SysNoticeService(
        UserManager userManager,
        SqlSugarRepository<SysUser> sysUserRep,
        SqlSugarRepository<SysNotice> sysNoticeRep,
        SqlSugarRepository<SysNoticeUser> sysNoticeUserRep,
        SysOnlineUserService sysOnlineUserService)
    {
        _userManager = userManager;
        _sysUserRep = sysUserRep;
        _sysNoticeRep = sysNoticeRep;
        _sysNoticeUserRep = sysNoticeUserRep;
        _sysOnlineUserService = sysOnlineUserService;
    }

    /// <summary>
    /// 获取通知公告分页列表 📢
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取通知公告分页列表")]
    public async Task<SqlSugarPagedList<SysNotice>> Page(PageNoticeInput input)
    {
        return await _sysNoticeRep.AsQueryable()
            .WhereIF(!string.IsNullOrWhiteSpace(input.Title), u => u.Title.Contains(input.Title.Trim()))
            .WhereIF(input.Type > 0, u => u.Type == input.Type)
            .Where(u => u.TenantId == _userManager.TenantId)
            .WhereIF(!_userManager.SuperAdmin, u => u.CreateUserId == _userManager.UserId)
            .OrderBy(u => u.CreateTime, OrderByType.Desc)
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 增加通知公告 📢
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加通知公告")]
    public async Task AddNotice(AddNoticeInput input)
    {
        ValidateContent(input);
        var notice = new SysNotice
        {
            Title = input.Title,
            Content = input.Content,
            Type = input.Type,
            Status = NoticeStatusEnum.DRAFT,
            TenantId = _userManager.TenantId,
            CreateUserId = _userManager.UserId,
            CreateUserName = _userManager.RealName,
            CreateTime = DateTime.Now
        };
        InitNoticeInfo(notice);
        await _sysNoticeRep.InsertAsync(notice);
    }

    /// <summary>
    /// 更新通知公告 📢
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [UnitOfWork]
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新通知公告")]
    public async Task UpdateNotice(UpdateNoticeInput input)
    {
        ValidateContent(input);
        var notice = await _sysNoticeRep.GetByIdAsync(input.Id);
        if (notice == null || notice.TenantId != _userManager.TenantId || notice.CreateUserId != _userManager.UserId)
            throw Oops.Oh(ErrorCodeEnum.D7003);
        if (notice.Status == NoticeStatusEnum.PUBLIC)
            throw Oops.Oh(ErrorCodeEnum.D7001);

        // 只更新可编辑字段，并在写入时再次检查状态，防止并发发布后被覆盖。
        var changed = await _sysNoticeRep.AsUpdateable()
            .SetColumns(u => new SysNotice
            {
                Title = input.Title,
                Content = input.Content,
                Type = input.Type,
                UpdateTime = DateTime.Now,
                UpdateUserId = _userManager.UserId,
                UpdateUserName = _userManager.RealName
            })
            .Where(u => u.Id == input.Id && u.TenantId == _userManager.TenantId && u.CreateUserId == _userManager.UserId && u.Status != NoticeStatusEnum.PUBLIC)
            .ExecuteCommandAsync();
        if (changed == 0) throw Oops.Oh(ErrorCodeEnum.D7001);
    }

    /// <summary>
    /// 删除通知公告 📢
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [UnitOfWork]
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除通知公告")]
    public async Task DeleteNotice(DeleteNoticeInput input)
    {
        var sysNotice = await _sysNoticeRep.GetByIdAsync(input.Id);

        if (sysNotice == null || sysNotice.TenantId != _userManager.TenantId || sysNotice.CreateUserId != _userManager.UserId) throw Oops.Oh(ErrorCodeEnum.D7003);

        if (sysNotice.Status == NoticeStatusEnum.PUBLIC) throw Oops.Oh(ErrorCodeEnum.D7001);

        var deleted = await _sysNoticeRep.AsDeleteable()
            .Where(u => u.Id == input.Id && u.TenantId == _userManager.TenantId && u.CreateUserId == _userManager.UserId && u.Status != NoticeStatusEnum.PUBLIC)
            .ExecuteCommandAsync();
        if (deleted == 0) throw Oops.Oh(ErrorCodeEnum.D7001);

        await _sysNoticeUserRep.DeleteAsync(u => u.NoticeId == input.Id);
    }

    /// <summary>
    /// 发布通知公告 📢
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("发布通知公告")]
    public async Task Public(NoticeInput input)
    {
        var notice = await _sysNoticeRep.GetByIdAsync(input.Id);
        if (notice == null || notice.TenantId != _userManager.TenantId || notice.CreateUserId != _userManager.UserId)
            throw Oops.Oh(ErrorCodeEnum.D7003);
        if (notice.Status == NoticeStatusEnum.PUBLIC)
        {
            // 推送失败可以重试，但不能重建收件记录或清空阅读状态。
            var existingRecipients = await _sysNoticeUserRep.AsQueryable()
                .Where(u => u.NoticeId == input.Id && u.TenantId == _userManager.TenantId).Select(u => u.UserId).ToListAsync();
            await _sysOnlineUserService.PublicNotice(notice, existingRecipients);
            return;
        }

        List<long> userIdList;
        var tenant = _sysNoticeRep.AsTenant();
        await tenant.BeginTranAsync();
        try
        {
            var changed = await _sysNoticeRep.AsUpdateable()
                .SetColumns(u => new SysNotice { Status = NoticeStatusEnum.PUBLIC, PublicTime = DateTime.Now })
                .Where(u => u.Id == input.Id && u.TenantId == _userManager.TenantId && u.CreateUserId == _userManager.UserId && u.Status != NoticeStatusEnum.PUBLIC)
                .ExecuteCommandAsync();
            if (changed == 0) throw Oops.Oh(ErrorCodeEnum.D7001);

            userIdList = await _sysUserRep.AsQueryable().Where(u => u.TenantId == _userManager.TenantId).Select(u => u.Id).ToListAsync();
            await _sysNoticeUserRep.DeleteAsync(u => u.NoticeId == input.Id && u.TenantId == _userManager.TenantId);
            if (userIdList.Count > 0)
            {
                await _sysNoticeUserRep.InsertRangeAsync(userIdList.Select(userId => new SysNoticeUser
                {
                    NoticeId = input.Id,
                    UserId = userId,
                    TenantId = _userManager.TenantId
                }).ToList());
            }
            notice = await _sysNoticeRep.GetByIdAsync(input.Id);
            await tenant.CommitTranAsync();
        }
        catch
        {
            await tenant.RollbackTranAsync();
            throw;
        }
        // 收件记录先提交，实时客户端收到事件后即可读取已持久化的未读列表。
        await _sysOnlineUserService.PublicNotice(notice, userIdList);
    }

    /// <summary>
    /// 设置通知公告已读状态 📢
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("设置通知公告已读状态")]
    public async Task SetRead(NoticeInput input)
    {
        await _sysNoticeUserRep.UpdateAsync(u => new SysNoticeUser
        {
            ReadStatus = NoticeUserStatusEnum.READ,
            ReadTime = DateTime.Now
        }, u => u.NoticeId == input.Id && u.TenantId == _userManager.TenantId && u.UserId == _userManager.UserId && u.ReadStatus == NoticeUserStatusEnum.UNREAD);
    }

    /// <summary>
    /// 获取接收的通知公告
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取接收的通知公告")]
    public async Task<SqlSugarPagedList<SysNoticeUser>> PageReceived(PageNoticeInput input)
    {
        return await _sysNoticeUserRep.AsQueryable().Includes(u => u.SysNotice)
            .Where(u => u.TenantId == _userManager.TenantId && u.UserId == _userManager.UserId)
            .WhereIF(!string.IsNullOrWhiteSpace(input.Title), u => u.SysNotice.Title.Contains(input.Title.Trim()))
            .WhereIF(input.Type is > 0, u => u.SysNotice.Type == input.Type)
            .OrderBy(u => u.SysNotice.CreateTime, OrderByType.Desc)
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 获取未读的通知公告 📢
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取未读的通知公告")]
    public async Task<List<SysNotice>> GetUnReadList()
    {
        var noticeUserList = await _sysNoticeUserRep.AsQueryable().Includes(u => u.SysNotice)
            .Where(u => u.TenantId == _userManager.TenantId && u.UserId == _userManager.UserId && u.ReadStatus == NoticeUserStatusEnum.UNREAD)
            .OrderBy(u => u.SysNotice.CreateTime, OrderByType.Desc).ToListAsync();
        return noticeUserList.Select(t => t.SysNotice).ToList();
    }

    /// <summary>
    /// 初始化通知公告信息
    /// </summary>
    /// <param name="notice"></param>
    [NonAction]
    private void InitNoticeInfo(SysNotice notice)
    {
        notice.PublicUserId = _userManager.UserId;
        notice.PublicUserName = _userManager.RealName;
        notice.PublicOrgId = _userManager.OrgId;
        notice.TenantId = _userManager.TenantId;
    }

    private static void ValidateContent(AddNoticeInput input)
    {
        if (string.IsNullOrWhiteSpace(input.Title) || input.Title.Length > 32 ||
            string.IsNullOrWhiteSpace(input.Content) ||
            input.Type is not (NoticeTypeEnum.NOTICE or NoticeTypeEnum.ANNOUNCEMENT))
            throw Oops.Oh("请填写有效的通知标题、类型和内容");
    }
}
