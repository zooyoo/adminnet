// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统作业任务服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 320, Description = "作业任务")]
public class SysJobService : IDynamicApiController, ITransient
{
    private readonly SqlSugarRepository<SysJobDetail> _sysJobDetailRep;
    private readonly SqlSugarRepository<SysJobTrigger> _sysJobTriggerRep;
    private readonly SqlSugarRepository<SysJobTriggerRecord> _sysJobTriggerRecordRep;
    private readonly SqlSugarRepository<SysJobCluster> _sysJobClusterRep;
    private readonly ISchedulerFactory _schedulerFactory;
    private readonly DynamicJobCompiler _dynamicJobCompiler;

    public SysJobService(SqlSugarRepository<SysJobDetail> sysJobDetailRep,
        SqlSugarRepository<SysJobTrigger> sysJobTriggerRep,
        SqlSugarRepository<SysJobTriggerRecord> sysJobTriggerRecordRep,
        SqlSugarRepository<SysJobCluster> sysJobClusterRep,
        ISchedulerFactory schedulerFactory,
        DynamicJobCompiler dynamicJobCompiler)
    {
        _sysJobDetailRep = sysJobDetailRep;
        _sysJobTriggerRep = sysJobTriggerRep;
        _sysJobTriggerRecordRep = sysJobTriggerRecordRep;
        _sysJobClusterRep = sysJobClusterRep;
        _schedulerFactory = schedulerFactory;
        _dynamicJobCompiler = dynamicJobCompiler;
    }

    /// <summary>
    /// 获取作业分页列表 ⏰
    /// </summary>
    [DisplayName("获取作业分页列表")]
    public async Task<SqlSugarPagedList<JobDetailOutput>> PageJobDetail(PageJobDetailInput input)
    {
        var jobDetails = await _sysJobDetailRep.AsQueryable()
            .WhereIF(!string.IsNullOrWhiteSpace(input.JobId), u => u.JobId.Contains(input.JobId.Trim()))
            .WhereIF(!string.IsNullOrWhiteSpace(input.GroupName), u => u.GroupName.Contains(input.GroupName.Trim()))
            .WhereIF(!string.IsNullOrWhiteSpace(input.Description), u => u.Description.Contains(input.Description.Trim()))
            .Select(d => new JobDetailOutput
            {
                JobDetail = d,
            }).ToPagedListAsync(input.Page, input.PageSize);
        await _sysJobDetailRep.AsSugarClient().ThenMapperAsync(jobDetails.Items, async u =>
        {
            u.JobTriggers = await _sysJobTriggerRep.GetListAsync(t => t.JobId == u.JobDetail.JobId);
        });

        foreach (var job in jobDetails.Items)
        {
            var scheduler = _schedulerFactory.GetJob(job.JobDetail.JobId);
            if (scheduler != null)
            {
                var ids = job.JobTriggers.ToDictionary(trigger => trigger.TriggerId, trigger => trigger.Id);
                job.JobTriggers = scheduler.GetTriggers().Adapt<List<SysJobTrigger>>();
                foreach (var trigger in job.JobTriggers) trigger.Id = ids.GetValueOrDefault(trigger.TriggerId);
            }
            foreach (var jobTrigger in job.JobTriggers)
            {
                jobTrigger.Args = UnwrapArgs(jobTrigger.Args);
            }
        }
        return jobDetails;
    }

    /// <summary>
    /// 获取作业组名称集合 ⏰
    /// </summary>
    [DisplayName("获取作业组名称集合")]
    public async Task<List<string>> ListJobGroup()
    {
        return await _sysJobDetailRep.AsQueryable().Distinct().Select(e => e.GroupName).ToListAsync();
    }

    /// <summary>
    /// 添加作业 ⏰
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "AddJobDetail"), HttpPost]
    [DisplayName("添加作业")]
    public async Task AddJobDetail(AddJobDetailInput input)
    {
        var isExist = await _sysJobDetailRep.IsAnyAsync(u => u.JobId == input.JobId);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D1006);

        // 动态创建作业
        Type jobType;
        switch (input.CreateType)
        {
            case JobCreateTypeEnum.Script when string.IsNullOrEmpty(input.ScriptCode):
                throw Oops.Oh(ErrorCodeEnum.D1701);
            case JobCreateTypeEnum.Script:
                {
                    jobType = _dynamicJobCompiler.BuildJob(input.ScriptCode);

                    if (jobType.GetCustomAttributes(typeof(JobDetailAttribute)).FirstOrDefault() is not JobDetailAttribute jobDetailAttribute)
                        throw Oops.Oh(ErrorCodeEnum.D1702);
                    if (jobDetailAttribute.JobId != input.JobId)
                        throw Oops.Oh(ErrorCodeEnum.D1703);
                    break;
                }
            case JobCreateTypeEnum.Http:
                jobType = typeof(HttpJob);
                break;

            default:
                throw new NotSupportedException();
        }

        EnsureSuccess(_schedulerFactory.TryAddJob(JobBuilder.Create(jobType).LoadFrom(input.Adapt<SysJobDetail>())
            .SetJobType(jobType).SetIncludeAnnotations(input.IncludeAnnotation), [], out _));
        await WaitForJob(input.JobId);
        int affected = await _sysJobDetailRep.AsUpdateable()
            .SetColumns(u => new SysJobDetail { CreateType = input.CreateType, ScriptCode = input.ScriptCode })
            .Where(u => u.JobId == input.JobId).ExecuteCommandAsync();
        if (affected == 0) throw Oops.Oh("任务持久化未完成，请刷新确认后重试");
    }

    /// <summary>
    /// 更新作业 ⏰
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "UpdateJobDetail"), HttpPost]
    [DisplayName("更新作业")]
    public async Task UpdateJobDetail(UpdateJobDetailInput input)
    {
        var isExist = await _sysJobDetailRep.IsAnyAsync(u => u.JobId == input.JobId && u.Id != input.Id);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D1006);

        var sysJobDetail = await _sysJobDetailRep.GetFirstAsync(u => u.Id == input.Id);
        if (sysJobDetail == null) throw Oops.Oh("任务不存在");
        if (sysJobDetail.JobId != input.JobId) throw Oops.Oh(ErrorCodeEnum.D1704);
        if (sysJobDetail.CreateType != input.CreateType) throw Oops.Oh("不能变更既有任务的创建类型");

        var scheduler = RequiredJob(sysJobDetail.JobId);
        var oldScriptCode = sysJobDetail.ScriptCode; // 旧脚本代码
        input.Adapt(sysJobDetail);

        if (input.CreateType == JobCreateTypeEnum.Script)
        {
            if (string.IsNullOrEmpty(input.ScriptCode)) throw Oops.Oh(ErrorCodeEnum.D1701);

            if (input.ScriptCode != oldScriptCode)
            {
                // 动态创建作业
                var jobType = _dynamicJobCompiler.BuildJob(input.ScriptCode);

                if (jobType.GetCustomAttributes(typeof(JobDetailAttribute)).FirstOrDefault() is not JobDetailAttribute jobDetailAttribute)
                    throw Oops.Oh(ErrorCodeEnum.D1702);
                if (jobDetailAttribute.JobId != input.JobId) throw Oops.Oh(ErrorCodeEnum.D1703);

                EnsureSuccess(scheduler.TryUpdateDetail(JobBuilder.Create(jobType).LoadFrom(sysJobDetail).SetJobType(jobType), out _));
            }
            else EnsureSuccess(scheduler.TryUpdateDetail(scheduler.GetJobBuilder().LoadFrom(sysJobDetail), out _));
        }
        else
        {
            EnsureSuccess(scheduler.TryUpdateDetail(scheduler.GetJobBuilder().LoadFrom(sysJobDetail), out _));
        }

        // Tip: 假如这次更新有变更了 JobId，变更 JobId 后触发的持久化更新执行，会由于找不到 JobId 而更新不到数据
        // 延迟一下等待持久化写入，再执行其他字段的更新
        await Task.Delay(500);
        await _sysJobDetailRep.UpdateAsync(sysJobDetail);
    }

    /// <summary>
    /// 删除作业 ⏰
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "DeleteJobDetail"), HttpPost]
    [DisplayName("删除作业")]
    public async Task DeleteJobDetail(DeleteJobDetailInput input)
    {
        if (!await _sysJobDetailRep.IsAnyAsync(job => job.JobId == input.JobId)) throw Oops.Oh("任务不存在");
        var removeResult = _schedulerFactory.TryRemoveJob(input.JobId, out _);
        if (removeResult is not (ScheduleResult.Succeed or ScheduleResult.NotFound)) EnsureSuccess(removeResult);

        // 如果 _schedulerFactory 中不存在 JodId，则无法触发持久化，下面的代码确保作业和触发器能被删除
        await _sysJobDetailRep.DeleteAsync(u => u.JobId == input.JobId);
        await _sysJobTriggerRep.DeleteAsync(u => u.JobId == input.JobId);
    }

    /// <summary>
    /// 获取触发器列表 ⏰
    /// </summary>
    [DisplayName("获取触发器列表")]
    public async Task<List<SysJobTrigger>> GetJobTriggerList([FromQuery] JobDetailInput input)
    {
        return await _sysJobTriggerRep.AsQueryable()
            .WhereIF(!string.IsNullOrWhiteSpace(input.JobId), u => u.JobId == input.JobId)
            .ToListAsync();
    }

    /// <summary>
    /// 添加触发器 ⏰
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "AddJobTrigger"), HttpPost]
    [DisplayName("添加触发器")]
    public async Task AddJobTrigger(AddJobTriggerInput input)
    {
        var isExist = await _sysJobTriggerRep.IsAnyAsync(u => u.TriggerId == input.TriggerId && u.Id != input.Id);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D1006);

        var scheduler = RequiredJob(input.JobId);
        var jobTrigger = ValidatedTrigger(input);
        EnsureSuccess(scheduler.TryAddTrigger(Triggers.Create(input.AssemblyName, input.TriggerType).LoadFrom(jobTrigger), out _));
        await WaitForTrigger(jobTrigger);
    }

    /// <summary>
    /// 更新触发器 ⏰
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "UpdateJobTrigger"), HttpPost]
    [DisplayName("更新触发器")]
    public async Task UpdateJobTrigger(UpdateJobTriggerInput input)
    {
        var isExist = await _sysJobTriggerRep.IsAnyAsync(u => u.TriggerId == input.TriggerId && u.Id != input.Id);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D1006);

        var existing = await _sysJobTriggerRep.GetFirstAsync(trigger => trigger.Id == input.Id);
        if (existing == null || existing.JobId != input.JobId || existing.TriggerId != input.TriggerId)
            throw Oops.Oh("触发器不存在或不能变更所属任务与编号");
        var jobTrigger = ValidatedTrigger(input);
        if (jobTrigger.EndTime.HasValue && jobTrigger.EndTime.Value.Year < 1901)
        {
            jobTrigger.EndTime = null;
        }
        if (jobTrigger.StartTime.HasValue && jobTrigger.StartTime.Value.Year < 1901)
        {
            jobTrigger.StartTime = null;
        }
        var scheduler = RequiredJob(input.JobId);
        EnsureSuccess(scheduler.TryUpdateTrigger(Triggers.Create(input.AssemblyName, input.TriggerType).LoadFrom(jobTrigger), out _));
        await WaitForTrigger(jobTrigger);
    }

    /// <summary>
    /// 删除触发器 ⏰
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "DeleteJobTrigger"), HttpPost]
    [DisplayName("删除触发器")]
    public async Task DeleteJobTrigger(DeleteJobTriggerInput input)
    {
        var scheduler = RequiredJob(input.JobId);
        EnsureSuccess(scheduler.TryRemoveTrigger(input.TriggerId, out _));

        // 如果 _schedulerFactory 中不存在 JodId，则无法触发持久化，下行代码确保触发器能被删除
        await _sysJobTriggerRep.DeleteAsync(u => u.JobId == input.JobId && u.TriggerId == input.TriggerId);
    }

    /// <summary>
    /// 暂停所有作业 ⏰
    /// </summary>
    /// <returns></returns>
    [DisplayName("暂停所有作业")]
    public void PauseAllJob()
    {
        _schedulerFactory.PauseAll();
    }

    /// <summary>
    /// 启动所有作业 ⏰
    /// </summary>
    /// <returns></returns>
    [DisplayName("启动所有作业")]
    public void StartAllJob()
    {
        _schedulerFactory.StartAll();
    }

    /// <summary>
    /// 暂停作业 ⏰
    /// </summary>
    [DisplayName("暂停作业")]
    public void PauseJob(JobDetailInput input)
    {
        EnsureSuccess(_schedulerFactory.TryPauseJob(input.JobId, out _));
    }

    /// <summary>
    /// 启动作业 ⏰
    /// </summary>
    [DisplayName("启动作业")]
    public void StartJob(JobDetailInput input)
    {
        EnsureSuccess(_schedulerFactory.TryStartJob(input.JobId, out _));
    }

    /// <summary>
    /// 取消作业 ⏰
    /// </summary>
    [DisplayName("取消作业")]
    public void CancelJob(JobDetailInput input)
    {
        EnsureSuccess(_schedulerFactory.TryCancelJob(input.JobId, out _));
    }

    /// <summary>
    /// 执行作业 ⏰
    /// </summary>
    /// <param name="input"></param>
    [DisplayName("执行作业")]
    public void RunJob(JobDetailInput input)
    {
        if (_schedulerFactory.TryRunJob(input.JobId, out _) != ScheduleResult.Succeed) throw Oops.Oh(ErrorCodeEnum.D1705);
    }

    /// <summary>
    /// 暂停触发器 ⏰
    /// </summary>
    [DisplayName("暂停触发器")]
    public void PauseTrigger(JobTriggerInput input)
    {
        var scheduler = RequiredJob(input.JobId);
        if (!scheduler.PauseTrigger(input.TriggerId)) throw Oops.Oh("触发器暂停失败或不存在");
    }

    /// <summary>
    /// 启动触发器 ⏰
    /// </summary>
    [DisplayName("启动触发器")]
    public void StartTrigger(JobTriggerInput input)
    {
        var scheduler = RequiredJob(input.JobId);
        if (!scheduler.StartTrigger(input.TriggerId)) throw Oops.Oh("触发器启动失败或不存在");
    }

    /// <summary>
    /// 强制唤醒作业调度器 ⏰
    /// </summary>
    [DisplayName("强制唤醒作业调度器")]
    public void CancelSleep()
    {
        _schedulerFactory.CancelSleep();
    }

    /// <summary>
    /// 强制触发所有作业持久化 ⏰
    /// </summary>
    [DisplayName("强制触发所有作业持久化")]
    public void PersistAll()
    {
        _schedulerFactory.PersistAll();
    }

    [ApiDescriptionSettings(Name = "CronPreview"), HttpPost]
    [DisplayName("预览 Cron 运行时间")]
    public CronPreviewOutput CronPreview(CronPreviewInput input)
    {
        try { return JobCronPreview.Preview(input); }
        catch (ArgumentException exception) { throw Oops.Oh(exception.Message); }
    }

    private IScheduler RequiredJob(string jobId) => _schedulerFactory.GetJob(jobId) ?? throw Oops.Oh("任务不存在或未加载到调度引擎");

    private static void EnsureSuccess(ScheduleResult result)
    {
        if (result != ScheduleResult.Succeed) throw Oops.Oh($"调度操作失败：{result}");
    }

    private static string UnwrapArgs(string args)
    {
        string value = args?.Trim() ?? "";
        return value.StartsWith('[') && value.EndsWith(']') ? value[1..^1] : value;
    }

    private static SysJobTrigger ValidatedTrigger(AddJobTriggerInput input)
    {
        var trigger = input.Adapt<SysJobTrigger>();
        if (trigger.StartTime?.Kind == DateTimeKind.Utc) trigger.StartTime = trigger.StartTime.Value.ToLocalTime();
        if (trigger.EndTime?.Kind == DateTimeKind.Utc) trigger.EndTime = trigger.EndTime.Value.ToLocalTime();
        if (trigger.StartTime >= trigger.EndTime) throw Oops.Oh("结束时间必须晚于起始时间");
        if (trigger.MaxNumberOfRuns < 0 || trigger.MaxNumberOfErrors < 0 || trigger.NumRetries < 0 || trigger.RetryTimeout < 0)
            throw Oops.Oh("次数和重试间隔不能为负数");
        if (trigger.TriggerType == "Furion.Schedule.CronTrigger")
        {
            try
            {
                using var document = System.Text.Json.JsonDocument.Parse("[" + UnwrapArgs(trigger.Args) + "]");
                var values = document.RootElement;
                if (values.GetArrayLength() != 2 || values[0].ValueKind != System.Text.Json.JsonValueKind.String)
                    throw new ArgumentException("Cron 参数必须是表达式字符串和格式编号");
                JobCronPreview.Preview(new CronPreviewInput
                {
                    Expression = values[0].GetString(), Format = values[1].GetInt32(), StartTime = trigger.StartTime, EndTime = trigger.EndTime
                });
            }
            catch (Exception exception) when (exception is ArgumentException or System.Text.Json.JsonException or InvalidOperationException or FormatException)
            {
                throw Oops.Oh("Cron 参数无效：" + exception.Message);
            }
        }
        else if (trigger.TriggerType == "Furion.Schedule.PeriodTrigger" && (!int.TryParse(UnwrapArgs(trigger.Args), out int period) || period <= 0))
            throw Oops.Oh("周期必须是大于 0 的整数毫秒");
        trigger.Args = "[" + UnwrapArgs(trigger.Args) + "]";
        return trigger;
    }

    private async Task WaitForTrigger(SysJobTrigger expected)
    {
        for (int attempt = 0; attempt < 50; attempt++)
        {
            var stored = await _sysJobTriggerRep.GetFirstAsync(trigger => trigger.JobId == expected.JobId && trigger.TriggerId == expected.TriggerId);
            if (stored != null && stored.Args == expected.Args && stored.Description == expected.Description &&
                stored.StartTime == expected.StartTime && stored.EndTime == expected.EndTime &&
                stored.MaxNumberOfRuns == expected.MaxNumberOfRuns && stored.MaxNumberOfErrors == expected.MaxNumberOfErrors &&
                stored.NumRetries == expected.NumRetries && stored.RetryTimeout == expected.RetryTimeout &&
                stored.StartNow == expected.StartNow && stored.RunOnStart == expected.RunOnStart && stored.ResetOnlyOnce == expected.ResetOnlyOnce) return;
            await Task.Delay(100);
        }
        throw Oops.Oh("触发器持久化未完成，请刷新确认后重试");
    }

    private async Task WaitForJob(string jobId)
    {
        for (int attempt = 0; attempt < 50; attempt++)
        {
            if (await _sysJobDetailRep.IsAnyAsync(job => job.JobId == jobId)) return;
            await Task.Delay(100);
        }
        throw Oops.Oh("任务持久化未完成，请刷新确认后重试");
    }

    /// <summary>
    /// 获取集群列表 ⏰
    /// </summary>
    [DisplayName("获取集群列表")]
    public async Task<List<SysJobCluster>> GetJobClusterList()
    {
        return await _sysJobClusterRep.GetListAsync();
    }

    /// <summary>
    /// 获取作业触发器运行记录分页列表 ⏰
    /// </summary>
    [DisplayName("获取作业触发器运行记录分页列表")]
    public async Task<SqlSugarPagedList<SysJobTriggerRecord>> PageJobTriggerRecord(PageJobTriggerRecordInput input)
    {
        return await _sysJobTriggerRecordRep.AsQueryable()
            .WhereIF(!string.IsNullOrWhiteSpace(input.JobId), u => u.JobId == input.JobId)
            .WhereIF(!string.IsNullOrWhiteSpace(input.TriggerId), u => u.TriggerId == input.TriggerId)
            .OrderByDescending(u => u.Id)
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 清空作业触发器运行记录 🔖
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "ClearJobTriggerRecord"), HttpPost]
    [DisplayName("清空作业触发器运行记录")]
    public void ClearJobTriggerRecord()
    {
        var db = _sysJobTriggerRecordRep.AsSugarClient();
        // SQLite 的雪花主键表没有自增序列，不能使用 TRUNCATE 的序列重置。
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.Sqlite) _sysJobTriggerRecordRep.AsDeleteable().ExecuteCommand();
        else db.DbMaintenance.TruncateTable<SysJobTriggerRecord>();
    }

    /// <summary>
    /// 清空不保留的作业触发器运行记录 🔖
    /// </summary>
    /// <returns></returns>
    [NonAction]
    [DisplayName("清空过期的作业触发器运行记录")]
    public async Task ClearExpireJobTriggerRecord(SysJobTriggerRecord input)
    {
        int keepRecords = 30;//保留记录条数
        // 使用CopyNew()创建新的数据库连接实例，避免连接冲突
        var db = _sysJobTriggerRecordRep.AsSugarClient().CopyNew();
        await db.Deleteable<SysJobTriggerRecord>().In(it => it.Id,
            db.Queryable<SysJobTriggerRecord>()
                .Where(u => u.JobId == input.JobId && u.TriggerId == input.TriggerId)
                .OrderByDescending(it => it.LastRunTime)
                .Skip(keepRecords)
                .Take(int.MaxValue)
                .Select(it => it.Id) //注意Select不要ToList(), ToList就2次查询了
        ).ExecuteCommandAsync();
    }
}
