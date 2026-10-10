// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Linq.Expressions;

namespace Admin.NET.Core.Service;

/// <summary>
/// 行政区域的编码、层级、判重和排序规则
/// </summary>
public static class RegionContracts
{
    /// <summary>
    /// 沿用原有编码长度约定，不额外限制编码字符
    /// </summary>
    public static string NormalizeCode(string code)
    {
        var normalizedCode = code?.Trim() ?? "";
        if (normalizedCode.Length is not (6 or 9 or 12)) throw Oops.Oh(ErrorCodeEnum.R2003);
        return normalizedCode;
    }

    /// <summary>
    /// 写操作必须指向有效的区域标识
    /// </summary>
    public static void EnsureValidId(long id)
    {
        if (id <= 0) throw Oops.Oh(ErrorCodeEnum.D1002);
    }

    /// <summary>
    /// 根节点使用 0，其他父级沿用标识优先、编码兜底的解析顺序
    /// </summary>
    public static async Task<long> ResolveParentIdAsync(long parentId,
        Func<long, Task<SysRegion>> findById, Func<string, Task<SysRegion>> findByCode)
    {
        if (parentId < 0) throw Oops.Oh(ErrorCodeEnum.D2000);
        if (parentId == 0) return 0;

        var parent = await findById(parentId) ?? await findByCode(parentId.ToString());
        return parent?.Id ?? throw Oops.Oh(ErrorCodeEnum.D2000);
    }

    /// <summary>
    /// 对解析后的父级检查自引用和后代循环，校验不产生写入
    /// </summary>
    public static async Task EnsureValidParentAsync(long id, long parentId, Func<Task<List<SysRegion>>> getDescendants)
    {
        EnsureValidId(id);
        if (parentId < 0) throw Oops.Oh(ErrorCodeEnum.D2000);
        if (id == parentId) throw Oops.Oh(ErrorCodeEnum.R2001);
        if (parentId == 0) return;

        var descendants = await getDescendants();
        if (descendants.Any(region => region.Id == parentId)) throw Oops.Oh(ErrorCodeEnum.R2004);
    }

    /// <summary>
    /// 名称和编码共同判重，更新时排除当前区域
    /// </summary>
    public static Expression<Func<SysRegion, bool>> DuplicatePredicate(string name, string code)
    {
        return region => region.Name == name && region.Code == code;
    }

    public static Expression<Func<SysRegion, bool>> DuplicatePredicate(string name, string code, long excludedId)
    {
        return region => region.Name == name && region.Code == code && region.Id != excludedId;
    }

    /// <summary>
    /// 排序号相同时由标识提供稳定顺序
    /// </summary>
    public static ISugarQueryable<SysRegion> OrderByPosition(ISugarQueryable<SysRegion> query)
    {
        return query.OrderBy(region => new { region.OrderNo, region.Id });
    }
}
