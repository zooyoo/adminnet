// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 动态插件的输入、租户范围与持久化字段合同。
/// </summary>
public static class PluginContracts
{
    public static void Validate(AddPluginInput input)
    {
        if (input == null) throw Oops.Oh("插件参数不能为空");
        if (string.IsNullOrWhiteSpace(input.Name) || input.Name.Length > 64) throw Oops.Oh("功能名称不能为空且不能超过64个字符");
        if (string.IsNullOrWhiteSpace(input.CsharpCode)) throw Oops.Oh("C#代码不能为空");
        if (input.AssemblyName?.Length > 512) throw Oops.Oh("程序集名称不能超过512个字符");
        if (input.Remark?.Length > 128) throw Oops.Oh("备注不能超过128个字符");
        if (!Enum.IsDefined(input.Status)) throw Oops.Oh("插件状态无效");
        if (input.TenantId < 0) throw Oops.Oh("租户Id无效");
    }

    public static void ValidatePage(PagePluginInput input)
    {
        if (input == null || input.Page < 1 || input.PageSize < 1) throw Oops.Oh("分页参数必须大于零");
        if (input.Name?.Length > 64 || input.TenantId < 0) throw Oops.Oh("插件查询参数无效");
    }

    public static long ResolveTenant(long? supplied, bool superAdmin, long tenantId)
    {
        if (!superAdmin && supplied > 0 && supplied != tenantId) throw Oops.Oh(ErrorCodeEnum.D1016);
        long result = superAdmin && supplied > 0 ? supplied.Value : tenantId;
        if (result <= 0) throw Oops.Oh(ErrorCodeEnum.D1016);
        return result;
    }

    public static void EnsureRemovalOwner(long? ownerTenantId, bool superAdmin, long tenantId)
    {
        // 没有插件归属的名称不能用于移除宿主程序集，超管也不例外。
        if (ownerTenantId is null || ownerTenantId <= 0 || (!superAdmin && (tenantId <= 0 || ownerTenantId != tenantId)))
            throw Oops.Oh(ErrorCodeEnum.D1002);
    }

    public static ISugarQueryable<SysPlugin> ScopeQuery(ISugarQueryable<SysPlugin> query, bool superAdmin, long tenantId)
    {
        if (!superAdmin && tenantId <= 0) throw Oops.Oh(ErrorCodeEnum.D1016);
        return query.WhereIF(!superAdmin, plugin => plugin.TenantId == tenantId);
    }

    public static SysPlugin RequireAccessible(SysPlugin plugin, bool superAdmin, long tenantId)
    {
        if (plugin == null || (!superAdmin && (tenantId <= 0 || plugin.TenantId != tenantId))) throw Oops.Oh(ErrorCodeEnum.D1002);
        return plugin;
    }

    public static SysPlugin CreateEntity(AddPluginInput input, bool superAdmin, long tenantId)
    {
        Validate(input);
        return new SysPlugin
        {
            Name = input.Name.Trim(),
            CsharpCode = input.CsharpCode,
            AssemblyName = string.IsNullOrWhiteSpace(input.AssemblyName) ? null : input.AssemblyName.Trim(),
            OrderNo = input.OrderNo,
            Status = input.Status,
            Remark = input.Remark,
            TenantId = ResolveTenant(input.TenantId, superAdmin, tenantId)
        };
    }

    public static SysPlugin UpdateEntity(SysPlugin current, UpdatePluginInput input)
    {
        Validate(input);
        if (input.Id <= 0 || current == null || current.Id != input.Id) throw Oops.Oh(ErrorCodeEnum.D1002);
        if (input.TenantId > 0 && input.TenantId != current.TenantId) throw Oops.Oh(ErrorCodeEnum.D1016);
        return new SysPlugin
        {
            Id = current.Id,
            TenantId = current.TenantId,
            Name = input.Name.Trim(),
            CsharpCode = input.CsharpCode,
            AssemblyName = string.IsNullOrWhiteSpace(input.AssemblyName) ? null : input.AssemblyName.Trim(),
            OrderNo = input.OrderNo,
            Status = input.Status,
            Remark = input.Remark
        };
    }

    public static IUpdateable<SysPlugin> UpdateQuery(IUpdateable<SysPlugin> query, long id, long? tenantId)
    {
        // 显式写主键和原租户条件，防止自定义 Where 覆盖 ORM 的对象主键条件。
        return query.UpdateColumns(plugin => new { plugin.Name, plugin.CsharpCode, plugin.AssemblyName, plugin.OrderNo, plugin.Status, plugin.Remark, plugin.UpdateTime, plugin.UpdateUserId, plugin.UpdateUserName })
            .Where(plugin => plugin.Id == id && plugin.TenantId == tenantId);
    }
}
