// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统租户配置参数服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 440)]
public class SysTenantConfigService : IDynamicApiController, ITransient
{
    private readonly SysCacheService _sysCacheService;
    private readonly SqlSugarRepository<SysTenantConfig> _sysConfigRep;
    private readonly SqlSugarRepository<SysTenantConfigData> _sysConfigDataRep;
    public readonly ISugarQueryable<SysConfig> VSysConfig;
    private readonly UserManager _userManager;

    public SysTenantConfigService(SysCacheService sysCacheService,
        SqlSugarRepository<SysTenantConfig> sysConfigRep,
        SqlSugarRepository<SysTenantConfigData> sysConfigDataRep,
       UserManager userManager)
    {
        _userManager = userManager;
        _sysCacheService = sysCacheService;
        _sysConfigRep = sysConfigRep;
        _sysConfigDataRep = sysConfigDataRep;
        VSysConfig = _sysConfigRep.AsQueryable()
            .InnerJoin(
                _sysConfigDataRep.AsQueryable().Where(cv => cv.TenantId == _userManager.TenantId),
                (c, cv) => c.Id == cv.ConfigId
            )
            //.Select<SysConfig>().MergeTable();
            // 解决PostgreSQL下并启用驼峰转下划线时,报字段不存在,SqlSugar在Select后生成的sql, as后没转下划线导致.
            .SelectMergeTable((c, cv) => new SysConfig { Id = c.Id.SelectAll(), Value = cv.Value });
    }

    /// <summary>
    /// 获取配置参数分页列表 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取配置参数分页列表")]
    public async Task<SqlSugarPagedList<SysConfig>> Page(PageConfigInput input)
    {
        return await VSysConfig
            .WhereIF(!string.IsNullOrWhiteSpace(input.Name?.Trim()), u => u.Name.Contains(input.Name))
            .WhereIF(!string.IsNullOrWhiteSpace(input.Code?.Trim()), u => u.Code.Contains(input.Code))
            .WhereIF(!string.IsNullOrWhiteSpace(input.GroupCode?.Trim()), u => u.GroupCode.Equals(input.GroupCode))
            .OrderBuilder(input)
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 获取配置参数列表 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取配置参数列表")]
    public async Task<List<SysConfig>> List(PageConfigInput input)
    {
        return await VSysConfig
            .WhereIF(!string.IsNullOrWhiteSpace(input.GroupCode?.Trim()), u => u.GroupCode.Equals(input.GroupCode))
            .ToListAsync();
    }

    /// <summary>
    /// 增加配置参数 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加配置参数")]
    [UnitOfWork]
    public async Task AddConfig(AddConfigInput input)
    {
        if (!_userManager.SuperAdmin) throw Oops.Oh(ErrorCodeEnum.D1016);
        var isExist = await _sysConfigRep.IsAnyAsync(u => u.Name == input.Name || u.Code == input.Code);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D9000);

        var configId = _sysConfigRep.InsertReturnSnowflakeId(input.Adapt<SysTenantConfig>());
        await _sysConfigDataRep.InsertAsync(new SysTenantConfigData()
        {
            ConfigId = configId,
            Value = input.Value,
            TenantId = _userManager.TenantId
        });
    }

    /// <summary>
    /// 更新配置参数 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新配置参数")]
    [UnitOfWork]
    public async Task UpdateConfig(UpdateConfigInput input)
    {
        var existing = await _sysConfigRep.GetByIdAsync(input.Id) ?? throw Oops.Oh("配置不存在");
        if (existing.SysFlag == YesNoEnum.Y && (input.SysFlag != existing.SysFlag || input.Code != existing.Code))
            throw Oops.Oh(ErrorCodeEnum.D9001);
        // 定义为平台共享，普通租户只能维护当前租户的值。
        if (!_userManager.SuperAdmin && (input.Name != existing.Name || input.Code != existing.Code ||
            (input.GroupCode ?? "") != (existing.GroupCode ?? "") || input.SysFlag != existing.SysFlag ||
            input.OrderNo != existing.OrderNo || (input.Remark ?? "") != (existing.Remark ?? "")))
            throw Oops.Oh(ErrorCodeEnum.D1016);
        var isExist = await _sysConfigRep.IsAnyAsync(u => (u.Name == input.Name || u.Code == input.Code) && u.Id != input.Id);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D9000);

        var config = input.Adapt<SysTenantConfig>();
        await _sysConfigRep.AsUpdateable(config).IgnoreColumns(true).ExecuteCommandAsync();
        var configData = await _sysConfigDataRep.GetFirstAsync(cv => cv.ConfigId == input.Id && cv.TenantId == _userManager.TenantId);
        if (configData == null)
            await _sysConfigDataRep.AsInsertable(new SysTenantConfigData() { ConfigId = input.Id, Value = input.Value, TenantId = _userManager.TenantId }).ExecuteCommandAsync();
        else
        {
            configData.Value = input.Value;
            await _sysConfigDataRep.AsUpdateable(configData).IgnoreColumns(true).ExecuteCommandAsync();
        }

        RemoveConfigCache(existing);
        RemoveConfigCache(config);
        if (existing.Code != config.Code) await RemoveAllConfigCaches(existing);
    }

    /// <summary>
    /// 删除配置参数 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除配置参数")]
    [UnitOfWork]
    public async Task DeleteConfig(DeleteConfigInput input)
    {
        var config = await _sysConfigRep.GetByIdAsync(input.Id) ?? throw Oops.Oh("配置不存在");
        // 禁止删除系统参数
        if (config.SysFlag == YesNoEnum.Y) throw Oops.Oh(ErrorCodeEnum.D9001);
        if (!_userManager.SuperAdmin) throw Oops.Oh(ErrorCodeEnum.D1016);

        await RemoveAllConfigCaches(config);
        await _sysConfigDataRep.Context.Deleteable<SysTenantConfigData>().Where(it => it.ConfigId == config.Id).ExecuteCommandAsync();
        await _sysConfigRep.DeleteAsync(config);
    }

    /// <summary>
    /// 批量删除配置参数 🔖
    /// </summary>
    /// <param name="ids"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "BatchDelete"), HttpPost]
    [DisplayName("批量删除配置参数")]
    [UnitOfWork]
    public async Task BatchDeleteConfig(List<long> ids)
    {
        foreach (var id in ids)
        {
            var config = await _sysConfigRep.GetByIdAsync(id);
            if (config == null) continue;
            // 禁止删除系统参数
            if (config.SysFlag == YesNoEnum.Y) continue;

            await DeleteConfig(new DeleteConfigInput { Id = id });
        }
    }

    /// <summary>
    /// 获取配置参数详情 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取配置参数详情")]
    public async Task<SysConfig> GetDetail([FromQuery] ConfigInput input)
    {
        return await VSysConfig.FirstAsync(u => u.Id == input.Id);
    }

    /// <summary>
    /// 根据Code获取配置参数 🔖
    /// </summary>
    /// <param name="code"></param>
    /// <returns></returns>
    [NonAction]
    public async Task<SysConfig> GetConfig(string code)
    {
        return await VSysConfig.FirstAsync(u => u.Code == code);
    }

    /// <summary>
    /// 根据Code获取配置参数值 🔖
    /// </summary>
    /// <param name="code">编码</param>
    /// <returns></returns>
    [DisplayName("根据Code获取配置参数值")]
    public async Task<string> GetConfigValueByCode(string code)
    {
        return await GetConfigValueByCode<string>(code);
    }

    /// <summary>
    /// 获取配置参数值
    /// </summary>
    /// <param name="code">编码</param>
    /// <param name="defaultValue">默认值</param>
    /// <returns></returns>
    [NonAction]
    public async Task<string> GetConfigValueByCode(string code, string defaultValue = default)
    {
        return await GetConfigValueByCode<string>(code, defaultValue);
    }

    /// <summary>
    /// 获取配置参数值
    /// </summary>
    /// <typeparam name="T">类型</typeparam>
    /// <param name="code">编码</param>
    /// <param name="defaultValue">默认值</param>
    /// <returns></returns>
    [NonAction]
    public async Task<T> GetConfigValueByCode<T>(string code, T defaultValue = default)
    {
        return await GetConfigValueByCode<T>(code, _userManager.TenantId, defaultValue);
    }

    /// <summary>
    /// 获取配置参数值
    /// </summary>
    /// <typeparam name="T">类型</typeparam>
    /// <param name="code">编码</param>
    /// <param name="tenantId">租户Id</param>
    /// <param name="defaultValue">默认值</param>
    /// <returns></returns>
    [NonAction]
    public async Task<T> GetConfigValueByCode<T>(string code, long tenantId, T defaultValue = default)
    {
        if (string.IsNullOrWhiteSpace(code)) return defaultValue;

        var value = _sysCacheService.Get<string>($"{CacheConst.KeyTenantConfig}{tenantId}:{code}");
        if (string.IsNullOrEmpty(value))
        {
            value = await _sysConfigRep.AsQueryable()
                .InnerJoin(_sysConfigDataRep.AsQueryable().ClearFilter().Where(d => d.TenantId == tenantId), (c, d) => c.Id == d.ConfigId)
                .Where((c, d) => c.Code == code).Select((c, d) => d.Value).FirstAsync();
            _sysCacheService.Set($"{CacheConst.KeyTenantConfig}{tenantId}:{code}", value);
        }
        if (string.IsNullOrWhiteSpace(value)) return defaultValue;
        return (T)Convert.ChangeType(value, typeof(T));
    }

    /// <summary>
    /// 更新配置参数值
    /// </summary>
    /// <param name="code"></param>
    /// <param name="value"></param>
    /// <returns></returns>
    [NonAction]
    public async Task UpdateConfigValue(string code, string value)
    {
        var config = await _sysConfigRep.GetFirstAsync(u => u.Code == code);
        if (config == null) return;

        await _sysConfigDataRep.AsUpdateable().SetColumns(it => it.Value == value).Where(it => it.TenantId == _userManager.TenantId && it.ConfigId == config.Id).ExecuteCommandAsync();

        RemoveConfigCache(config);
    }

    /// <summary>
    /// 获取分组列表 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取分组列表")]
    public async Task<List<string>> GetGroupList()
    {
        return await VSysConfig
            .GroupBy(u => u.GroupCode)
            .Select(u => u.GroupCode).ToListAsync();
    }

    /// <summary>
    /// 批量更新配置参数值 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "BatchUpdate"), HttpPost]
    [DisplayName("批量更新配置参数值")]
    public async Task BatchUpdateConfig(List<BatchConfigInput> input)
    {
        foreach (var config in input)
        {
            await UpdateConfigValue(config.Code, config.Value);
        }
    }

    /// <summary>
    /// 清除配置缓存
    /// </summary>
    /// <param name="config"></param>
    private void RemoveConfigCache(SysTenantConfig config)
    {
        _sysCacheService.Remove($"{CacheConst.KeyTenantConfig}{_userManager.TenantId}:{config.Code}");
    }

    /// <summary>
    /// 共享定义变更时逐个失效实际租户缓存，不使用编码前缀匹配。
    /// </summary>
    private async Task RemoveAllConfigCaches(SysTenantConfig config)
    {
        RemoveConfigCache(config);
        var tenantIds = await _sysConfigDataRep.AsQueryable().ClearFilter().Where(d => d.ConfigId == config.Id)
            .Select(d => d.TenantId).Distinct().ToListAsync();
        foreach (var tenantId in tenantIds)
            _sysCacheService.Remove($"{CacheConst.KeyTenantConfig}{tenantId}:{config.Code}");
    }
}
