// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Microsoft.AspNetCore.Mvc.ApplicationParts;
using System.Reflection;

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统动态插件服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 245)]
public class SysPluginService : IDynamicApiController, ITransient
{
    private readonly IDynamicApiRuntimeChangeProvider _provider;
    private readonly SqlSugarRepository<SysPlugin> _sysPluginRep;
    private readonly UserManager _userManager;
    private readonly ApplicationPartManager _parts;
    // 仅记录直接编译的临时插件；全部访问在 PluginMutation 锁内。
    private static readonly Dictionary<string, long> TemporaryAssemblyOwners = new(StringComparer.OrdinalIgnoreCase);

    public SysPluginService(IDynamicApiRuntimeChangeProvider provider,
        SqlSugarRepository<SysPlugin> sysPluginRep,
        UserManager userManager,
        ApplicationPartManager parts)
    {
        _parts = parts;
        _provider = provider;
        _userManager = userManager;
        _sysPluginRep = sysPluginRep;
    }

    /// <summary>
    /// 获取动态插件列表 🧩
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取动态插件列表")]
    public async Task<SqlSugarPagedList<SysPlugin>> Page(PagePluginInput input)
    {
        PluginContracts.ValidatePage(input);
        return await PluginContracts.ScopeQuery(_sysPluginRep.AsQueryable(), _userManager.SuperAdmin, _userManager.TenantId)
            .WhereIF(_userManager.SuperAdmin && input.TenantId > 0, u => u.TenantId == input.TenantId)
            .WhereIF(!string.IsNullOrWhiteSpace(input.Name), u => u.Name.Contains(input.Name))
            .OrderBy(u => new { u.OrderNo, u.Id })
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 增加动态插件 🧩
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加动态插件")]
    public async Task AddPlugin(AddPluginInput input)
    {
        await PluginMutation.RunExclusiveAsync(async () =>
        {
            SysPlugin plugin = PluginContracts.CreateEntity(input, _userManager.SuperAdmin, _userManager.TenantId);
            await CheckPlugin(plugin);
            // 禁用插件也先验证代码，但不发布运行接口。
            using var dynamicAssembly = App.CompileCSharpClassCode(plugin.CsharpCode, plugin.AssemblyName);
            plugin.AssemblyName = dynamicAssembly.Assembly.GetName().Name;
            EnsureAssemblyAvailable(plugin.AssemblyName);
            await Mutate(async () =>
            {
                if (!await _sysPluginRep.InsertAsync(plugin)) throw Oops.Oh("插件新增未写入");
            }, () =>
            {
                if (plugin.Status == StatusEnum.Enable) _provider.AddAssembliesWithNotifyChanges(dynamicAssembly.Assembly);
            }, () => _provider.RemoveAssembliesWithNotifyChanges(dynamicAssembly.Assembly));
        });
    }

    /// <summary>
    /// 更新动态插件 🧩
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新动态插件")]
    public async Task UpdatePlugin(UpdatePluginInput input)
    {
        await PluginMutation.RunExclusiveAsync(async () =>
        {
            PluginContracts.Validate(input);
            SysPlugin current = await FindOwned(input.Id);
            SysPlugin plugin = PluginContracts.UpdateEntity(current, input);
            await CheckPlugin(plugin);
            // 编译成功前不碰旧接口，保存实际运行程序集供失败恢复。
            using var dynamicAssembly = App.CompileCSharpClassCode(plugin.CsharpCode);
            plugin.AssemblyName = dynamicAssembly.Assembly.GetName().Name;
            EnsureAssemblyAvailable(plugin.AssemblyName);
            Assembly[] previous = SnapshotAssemblies(current.AssemblyName);
            await Mutate(async () =>
            {
                int count = await PluginContracts.UpdateQuery(_sysPluginRep.AsUpdateable(plugin), current.Id, current.TenantId).ExecuteCommandAsync();
                if (count != 1) throw Oops.Oh("插件更新目标已变化");
            }, () =>
            {
                _provider.RemoveAssemblies(previous);
                if (plugin.Status == StatusEnum.Enable) _provider.AddAssemblies(dynamicAssembly.Assembly);
                _provider.NotifyChanges();
            }, () =>
            {
                _provider.RemoveAssemblies(dynamicAssembly.Assembly);
                _provider.AddAssemblies(previous);
                _provider.NotifyChanges();
            });
        });
    }

    /// <summary>
    /// 删除动态插件 🧩
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除动态插件")]
    public async Task DeletePlugin(DeletePluginInput input)
    {
        await PluginMutation.RunExclusiveAsync(async () =>
        {
            if (input == null) throw Oops.Oh(ErrorCodeEnum.D1012);
            SysPlugin plugin = await FindOwned(input.Id);
            Assembly[] previous = SnapshotAssemblies(plugin.AssemblyName);
            await Mutate(async () =>
            {
                int count = await _sysPluginRep.AsDeleteable().Where(item => item.Id == plugin.Id && item.TenantId == plugin.TenantId).ExecuteCommandAsync();
                if (count != 1) throw Oops.Oh("插件删除目标已变化");
            }, () => _provider.RemoveAssembliesWithNotifyChanges(previous),
                () => _provider.AddAssembliesWithNotifyChanges(previous));
        });
    }

    private Task Mutate(Func<Task> save, Action publish, Action restore)
    {
        var ado = _sysPluginRep.Context.Ado;
        return PluginMutation.ExecuteAsync(() => ado.BeginTranAsync(), save, publish,
            () => ado.CommitTranAsync(), () => ado.RollbackTranAsync(), restore);
    }

    private Assembly[] SnapshotAssemblies(string name)
    {
        return _parts.ApplicationParts.OfType<AssemblyPart>()
            .Where(part => string.Equals(part.Assembly.GetName().Name, name, StringComparison.OrdinalIgnoreCase))
            .Select(part => part.Assembly).Distinct().ToArray();
    }

    private void EnsureAssemblyAvailable(string name)
    {
        if (SnapshotAssemblies(name).Length != 0) throw Oops.Oh(ErrorCodeEnum.D1900);
    }

    private async Task<SysPlugin> FindOwned(long id)
    {
        if (id <= 0) throw Oops.Oh(ErrorCodeEnum.D1012);
        SysPlugin plugin = await PluginContracts.ScopeQuery(_sysPluginRep.AsQueryable(), _userManager.SuperAdmin, _userManager.TenantId)
            .Where(item => item.Id == id).FirstAsync();
        return PluginContracts.RequireAccessible(plugin, _userManager.SuperAdmin, _userManager.TenantId);
    }

    private async Task CheckPlugin(SysPlugin plugin)
    {
        bool tenantExists = await _sysPluginRep.Context.Queryable<SysTenant>()
            .AnyAsync(tenant => tenant.Id == plugin.TenantId && tenant.Status == StatusEnum.Enable);
        if (!tenantExists) throw Oops.Oh(ErrorCodeEnum.D1002);
        // 程序集在当前进程共享，名称冲突检查覆盖所有租户；功能名称仍限定所属租户。
        bool exists = await _sysPluginRep.AsQueryable().ClearFilter<ITenantIdFilter>()
            .Where(item => item.Id != plugin.Id &&
                ((item.TenantId == plugin.TenantId && item.Name == plugin.Name) ||
                (plugin.AssemblyName != null && item.AssemblyName == plugin.AssemblyName)))
            .AnyAsync();
        if (exists) throw Oops.Oh(ErrorCodeEnum.D1900);
    }

    /// <summary>
    /// 添加动态程序集/接口 🧩
    /// </summary>
    /// <param name="csharpCode"></param>
    /// <param name="assemblyName">程序集名称</param>
    /// <returns></returns>
    [DisplayName("添加动态程序集/接口")]
    public string CompileAssembly([FromBody] string csharpCode, [FromQuery] string assemblyName = default)
    {
        string result = null;
        PluginMutation.RunExclusive(() =>
        {
            long owner = PluginContracts.ResolveTenant(null, _userManager.SuperAdmin, _userManager.TenantId);
            if (string.IsNullOrWhiteSpace(csharpCode) || assemblyName?.Length > 512) throw Oops.Oh("插件编译参数无效");
            using var dynamicAssembly = App.CompileCSharpClassCode(csharpCode, assemblyName);
            result = dynamicAssembly.Assembly.GetName().Name;
            EnsureAssemblyAvailable(result);
            // 持久化插件即使禁用也不能被直接编译接口占用其程序集名称。
            if (_sysPluginRep.AsQueryable().ClearFilter<ITenantIdFilter>().Any(plugin => plugin.AssemblyName == result)) throw Oops.Oh(ErrorCodeEnum.D1900);
            try
            {
                _provider.AddAssembliesWithNotifyChanges(dynamicAssembly.Assembly);
                TemporaryAssemblyOwners[result] = owner;
            }
            catch (Exception original)
            {
                try { _provider.RemoveAssembliesWithNotifyChanges(dynamicAssembly.Assembly); }
                catch (Exception recovery) { throw new AggregateException("插件发布与清理失败", original, recovery); }
                throw;
            }
        });
        return result;
    }

    /// <summary>
    /// 移除动态程序集/接口 🧩
    /// </summary>
    [ApiDescriptionSettings(Name = "RemoveAssembly"), HttpPost]
    [DisplayName("移除动态程序集/接口")]
    public void RemoveAssembly(string assemblyName)
    {
        PluginMutation.RunExclusive(() =>
        {
            if (string.IsNullOrWhiteSpace(assemblyName) || assemblyName.Length > 512) throw Oops.Oh("程序集名称无效");
            SysPlugin stored = PluginContracts.ScopeQuery(_sysPluginRep.AsQueryable(), _userManager.SuperAdmin, _userManager.TenantId)
                .Where(plugin => plugin.AssemblyName == assemblyName).First();
            long? owner = stored?.TenantId;
            if (owner == null && TemporaryAssemblyOwners.TryGetValue(assemblyName, out long temporaryOwner)) owner = temporaryOwner;
            PluginContracts.EnsureRemovalOwner(owner, _userManager.SuperAdmin, _userManager.TenantId);
            Assembly[] previous = SnapshotAssemblies(assemblyName);
            try
            {
                _provider.RemoveAssembliesWithNotifyChanges(previous);
                TemporaryAssemblyOwners.Remove(assemblyName);
            }
            catch (Exception original)
            {
                try { _provider.AddAssembliesWithNotifyChanges(previous); }
                catch (Exception recovery) { throw new AggregateException("插件移除与恢复失败", original, recovery); }
                throw;
            }
        });
    }

    /// <summary>
    /// 加载所有动态程序集/接口
    /// </summary>
    /// <returns></returns>
    [NonAction]
    public async Task LoadAllAssembly()
    {
        await PluginMutation.RunExclusiveAsync(async () =>
        {
            var plugins = await _sysPluginRep.AsQueryable().Where(plugin => plugin.Status == StatusEnum.Enable).ToListAsync();
            foreach (SysPlugin plugin in plugins)
            {
                // 重复触发启动任务时不重复注册同一程序集。
                if (SnapshotAssemblies(plugin.AssemblyName).Length != 0) continue;
                using var dynamicAssembly = App.CompileCSharpClassCode(plugin.CsharpCode, plugin.AssemblyName);
                _provider.AddAssembliesWithNotifyChanges(dynamicAssembly.Assembly);
            }
        });
    }
}