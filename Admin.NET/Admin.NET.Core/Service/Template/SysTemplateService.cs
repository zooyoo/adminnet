// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统消息模板服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 305)]
public class SysTemplateService : IDynamicApiController, ITransient
{
    private readonly SqlSugarRepository<SysTemplate> _sysTemplateRep;
    private readonly UserManager _userManager;
    private readonly IViewEngine _viewEngine;

    public SysTemplateService(
        SqlSugarRepository<SysTemplate> sysTemplateRep,
        IViewEngine viewEngine,
        UserManager userManager)
    {
        _sysTemplateRep = sysTemplateRep;
        _userManager = userManager;
        _viewEngine = viewEngine;
    }

    /// <summary>
    /// 获取模板列表 📑
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings]
    [DisplayName("获取模板列表")]
    public async Task<SqlSugarPagedList<SysTemplate>> Page(PageTemplateInput input)
    {
        TemplateContracts.ValidatePage(input);
        TemplateContracts.EnsureTenant(_userManager.SuperAdmin, _userManager.TenantId);
        return await TemplateContracts.PageQuery(_sysTemplateRep.AsQueryable(), input, _userManager.SuperAdmin, _userManager.TenantId)
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 获取模板 📑
    /// </summary>
    /// <param name="code"></param>
    /// <returns></returns>
    [DisplayName("获取模板")]
    [ApiDescriptionSettings]
    public async Task<SysTemplate> GetTemplate(string code)
    {
        TemplateContracts.ValidateLookup(code);
        TemplateContracts.EnsureTenant(_userManager.SuperAdmin, _userManager.TenantId);
        var template = await FindTemplateAsync(TemplateContracts.LegacyNamePredicate(code, _userManager.SuperAdmin, _userManager.TenantId));
        return TemplateContracts.RequireAccessible(template, _userManager.SuperAdmin, _userManager.TenantId);
    }

    /// <summary>
    /// 预览模板内容 📑
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("预览模板内容")]
    [ApiDescriptionSettings]
    public async Task<string> ProView(ProViewTemplateInput input)
    {
        if (input == null) throw Oops.Oh("预览参数不能为空");
        TemplateContracts.ValidateId(input.Id);
        TemplateContracts.ValidateData(input.Data);
        var template = await GetRequiredTemplateAsync(input.Id);
        return await RenderHttpAsync(template.Content, input.Data);
    }

    /// <summary>
    /// 增加模板 📑
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("增加模板")]
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    public async Task AddTemplate(AddTemplateInput input)
    {
        TemplateContracts.ValidateTemplate(input);
        TemplateContracts.EnsureSuppliedTenant(input.TenantId, _userManager.SuperAdmin, _userManager.TenantId);
        await EnsureUniqueAsync(input, 0);
        var template = TemplateContracts.CreateEntity(input, _userManager.SuperAdmin, _userManager.TenantId);
        await TemplateContracts.ExecuteMutationAsync(() => InsertTemplateAsync(template));
    }

    /// <summary>
    /// 更新模板 📑
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("更新模板")]
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    public async Task UpdateTemplate(UpdateTemplateInput input)
    {
        TemplateContracts.ValidateTemplate(input);
        TemplateContracts.ValidateId(input.Id);
        TemplateContracts.EnsureSuppliedTenant(input.TenantId, _userManager.SuperAdmin, _userManager.TenantId);
        var existing = await GetRequiredTemplateAsync(input.Id);
        await EnsureUniqueAsync(input, existing.Id);
        var template = TemplateContracts.UpdateEntity(existing, input);
        await TemplateContracts.ExecuteMutationAsync(() => UpdateTemplateAsync(template));
    }

    /// <summary>
    /// 删除模板 📑
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("删除模板")]
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    public async Task DeleteTemplate(BaseIdInput input)
    {
        if (input == null) throw Oops.Oh("删除参数不能为空");
        TemplateContracts.ValidateId(input.Id);
        var template = await GetRequiredTemplateAsync(input.Id);
        await TemplateContracts.ExecuteMutationAsync(() => DeleteTemplateAsync(template));
    }

    /// <summary>
    /// 获取分组列表 🔖
    /// </summary>
    /// <returns></returns>
    [ApiDescriptionSettings]
    [DisplayName("获取分组列表")]
    public async Task<List<string>> GetGroupList()
    {
        TemplateContracts.EnsureTenant(_userManager.SuperAdmin, _userManager.TenantId);
        return await TemplateContracts.ScopeQuery(_sysTemplateRep.AsQueryable(), _userManager.SuperAdmin, _userManager.TenantId)
            .GroupBy(u => u.GroupName)
            .Select(u => u.GroupName).ToListAsync();
    }

    /// <summary>
    /// 渲染模板内容 📑
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("渲染模板内容")]
    [ApiDescriptionSettings, HttpPost]
    public async Task<string> Render(RenderTemplateInput input)
    {
        if (input == null) throw Oops.Oh("渲染参数不能为空");
        TemplateContracts.ValidateRender(input.Content, input.Data);
        return await RenderHttpAsync(input.Content, input.Data);
    }

    /// <summary>
    /// 渲染模板内容 📑
    /// </summary>
    /// <param name="content"></param>
    /// <param name="data"></param>
    /// <returns></returns>
    [NonAction]
    public async Task<string> RenderAsync(string content, object data)
    {
        return await _viewEngine.RunCompileFromCachedAsync(Regex.Replace(content, "@\\((.*?)\\)", "@(Model.$1)"), data, builderAction: builder =>
        {
            builder.AddAssemblyReferenceByName("System.Text.RegularExpressions");
            builder.AddAssemblyReferenceByName("System.Collections");
            builder.AddAssemblyReferenceByName("System.Linq");

            builder.AddUsing("System.Text.RegularExpressions");
            builder.AddUsing("System.Collections.Generic");
            builder.AddUsing("System.Linq");
        });
    }

    /// <summary>
    /// 根据编码渲染模板内容
    /// </summary>
    /// <param name="code"></param>
    /// <param name="data"></param>
    /// <returns></returns>
    [NonAction]
    public async Task<string> RenderByCode(string code, Dictionary<string, object> data)
    {
        var template = await _sysTemplateRep.GetFirstAsync(u => u.Code == code);
        return await RenderAsync(template.Content, data);
    }

    private async Task<SysTemplate> GetRequiredTemplateAsync(long id)
    {
        TemplateContracts.EnsureTenant(_userManager.SuperAdmin, _userManager.TenantId);
        var template = await FindTemplateAsync(TemplateContracts.IdPredicate(id, _userManager.SuperAdmin, _userManager.TenantId));
        return TemplateContracts.RequireAccessible(template, _userManager.SuperAdmin, _userManager.TenantId);
    }

    private async Task EnsureUniqueAsync(AddTemplateInput input, long excludeId)
    {
        if (await TemplateExistsAsync(TemplateContracts.NameDuplicatePredicate(input.Name, excludeId, _userManager.SuperAdmin, _userManager.TenantId), false))
            throw Oops.Oh(ErrorCodeEnum.T1000);
        if (await TemplateExistsAsync(TemplateContracts.CodeDuplicatePredicate(input.Code, excludeId), true))
            throw Oops.Oh(ErrorCodeEnum.T1001);
    }

    private async Task<string> RenderHttpAsync(string content, object data)
    {
        TemplateContracts.ValidateRender(content, data);
        try
        {
            return await RenderAsync(content, TemplateContracts.CreateHttpRenderModel(data));
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw Oops.Oh("模板渲染失败，请检查模板内容与渲染参数后重试");
        }
    }

    // 将仓储读写保留为可替换的内部步骤，便于验证拒绝边界时确实没有写入或调用渲染引擎。
    protected virtual Task<SysTemplate> FindTemplateAsync(Expression<Func<SysTemplate, bool>> predicate)
    {
        return _sysTemplateRep.GetFirstAsync(predicate);
    }

    protected virtual Task<bool> TemplateExistsAsync(Expression<Func<SysTemplate, bool>> predicate, bool globalCode)
    {
        return globalCode
            ? _sysTemplateRep.AsQueryable().ClearFilter<ITenantIdFilter>().Where(predicate).AnyAsync()
            : _sysTemplateRep.IsAnyAsync(predicate);
    }

    protected virtual async Task InsertTemplateAsync(SysTemplate template)
    {
        if (!await _sysTemplateRep.InsertAsync(template)) throw Oops.Oh("模板保存失败，请稍后重试");
    }

    protected virtual async Task UpdateTemplateAsync(SysTemplate template)
    {
        var changed = await TemplateContracts.UpdateQuery(_sysTemplateRep.AsUpdateable(template), template.Id, template.TenantId).ExecuteCommandAsync();
        if (changed == 0) throw Oops.Oh(ErrorCodeEnum.D1002);
    }

    protected virtual async Task DeleteTemplateAsync(SysTemplate template)
    {
        var changed = await _sysTemplateRep.AsDeleteable().Where(item => item.Id == template.Id && item.TenantId == template.TenantId).ExecuteCommandAsync();
        if (changed == 0) throw Oops.Oh(ErrorCodeEnum.D1002);
    }
}
