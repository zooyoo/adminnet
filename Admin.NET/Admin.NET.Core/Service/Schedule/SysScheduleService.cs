// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统日程服务
/// </summary>
[ApiDescriptionSettings(Order = 295)]
public class SysScheduleService : IDynamicApiController, ITransient
{
    private readonly UserManager _userManager;
    private readonly SqlSugarRepository<SysSchedule> _sysSchedule;

    public SysScheduleService(UserManager userManager,
        SqlSugarRepository<SysSchedule> sysSchedule)
    {
        _userManager = userManager;
        _sysSchedule = sysSchedule;
    }

    /// <summary>
    /// 获取日程列表
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取日程列表")]
    public async Task<List<SysSchedule>> Page(ListScheduleInput input)
    {
        return await _sysSchedule.AsQueryable()
            .Where(u => u.UserId == _userManager.UserId && u.TenantId == _userManager.TenantId)
            .WhereIF(input.StartTime.HasValue, u => u.ScheduleTime >= input.StartTime)
            .WhereIF(input.EndTime.HasValue, u => u.ScheduleTime <= input.EndTime)
            .OrderBy(u => u.StartTime, OrderByType.Asc)
            .ToListAsync();
    }

    /// <summary>
    /// 获取日程详情
    /// </summary>
    /// <param name="id"></param>
    /// <returns></returns>
    [DisplayName("获取日程详情")]
    public async Task<SysSchedule> GetDetail(long id)
    {
        return await _sysSchedule.GetFirstAsync(u => u.Id == id && u.UserId == _userManager.UserId && u.TenantId == _userManager.TenantId)
            ?? throw Oops.Oh("日程不存在或无权访问");
    }

    /// <summary>
    /// 增加日程
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加日程")]
    public async Task AddUserSchedule(AddScheduleInput input)
    {
        Validate(input);
        // 个人日程只允许创建在当前身份下，不能由正文指定所有者或租户。
        await _sysSchedule.InsertAsync(new SysSchedule
        {
            UserId = _userManager.UserId,
            TenantId = _userManager.TenantId,
            ScheduleTime = input.ScheduleTime!.Value.Date,
            StartTime = input.StartTime,
            EndTime = input.EndTime,
            Content = input.Content.Trim(),
            Status = input.Status
        });
    }

    /// <summary>
    /// 更新日程
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新日程")]
    public async Task UpdateUserSchedule(UpdateScheduleInput input)
    {
        Validate(input);
        await GetDetail(input.Id);
        await _sysSchedule.AsUpdateable()
            .SetColumns(u => new SysSchedule
            {
                ScheduleTime = input.ScheduleTime!.Value.Date,
                StartTime = input.StartTime,
                EndTime = input.EndTime,
                Content = input.Content.Trim(),
                Status = input.Status
            })
            .Where(u => u.Id == input.Id && u.UserId == _userManager.UserId && u.TenantId == _userManager.TenantId)
            .ExecuteCommandAsync();
    }

    /// <summary>
    /// 删除日程
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除日程")]
    public async Task DeleteUserSchedule(DeleteScheduleInput input)
    {
        await GetDetail(input.Id);
        await _sysSchedule.DeleteAsync(u => u.Id == input.Id && u.UserId == _userManager.UserId && u.TenantId == _userManager.TenantId);
    }

    /// <summary>
    /// 设置日程状态
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("设置日程状态")]
    public async Task<int> SetStatus(ScheduleInput input)
    {
        if (!Enum.IsDefined(typeof(FinishStatusEnum), input.Status)) throw Oops.Oh(ErrorCodeEnum.D3005);

        await GetDetail(input.Id);
        return await _sysSchedule.AsUpdateable()
            .SetColumns(u => u.Status == input.Status)
            .Where(u => u.Id == input.Id && u.UserId == _userManager.UserId && u.TenantId == _userManager.TenantId)
            .ExecuteCommandAsync();
    }

    private static void Validate(AddScheduleInput input)
    {
        if (input.ScheduleTime == null || input.ScheduleTime.Value == DateTime.MinValue)
            throw Oops.Oh("请选择日程日期");
        if (string.IsNullOrWhiteSpace(input.Content) || input.Content.Trim().Length > 256)
            throw Oops.Oh("日程内容须为 1 至 256 个字符");
        if (!TimeOnly.TryParseExact(input.StartTime, "HH:mm", out TimeOnly start)
            || !TimeOnly.TryParseExact(input.EndTime, "HH:mm", out TimeOnly end) || end <= start)
            throw Oops.Oh("日程时间格式应为 HH:mm，且结束时间须晚于开始时间");
        if (!Enum.IsDefined(input.Status)) throw Oops.Oh(ErrorCodeEnum.D3005);
    }
}
