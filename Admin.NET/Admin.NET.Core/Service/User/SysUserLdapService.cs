// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 用户域账号服务
/// </summary>
public class SysUserLdapService : ITransient
{
    private readonly SqlSugarRepository<SysUserLdap> _sysUserLdapRep;

    public SysUserLdapService(SqlSugarRepository<SysUserLdap> sysUserLdapRep)
    {
        _sysUserLdapRep = sysUserLdapRep;
    }

    /// <summary>
    /// 批量插入域账号
    /// </summary>
    /// <param name="tenantId"></param>
    /// <param name="sysUserLdapList"></param>
    /// <returns></returns>
    public async Task InsertUserLdapList(long tenantId, List<SysUserLdap> sysUserLdapList)
    {
        if (sysUserLdapList.Any(u => u.TenantId != tenantId || string.IsNullOrWhiteSpace(u.Account)) ||
            sysUserLdapList.GroupBy(u => u.Account, StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1))
            throw Oops.Oh("目录账号所属租户或唯一性校验失败");
        var users = await _sysUserLdapRep.Context.Queryable<SysUser>().ClearFilter()
            .Where(u => u.TenantId == tenantId && u.Status == StatusEnum.Enable).ToListAsync();
        foreach (var item in sysUserLdapList)
        {
            item.Id = 0;
            item.UserId = users.FirstOrDefault(u => u.Account == item.EmployeeId)?.Id ?? 0;
        }
        var transaction = await _sysUserLdapRep.Context.Ado.UseTranAsync(async () =>
        {
            await _sysUserLdapRep.DeleteAsync(u => u.TenantId == tenantId);
            if (sysUserLdapList.Count > 0) await _sysUserLdapRep.InsertRangeAsync(sysUserLdapList);
        });
        if (!transaction.IsSuccess) throw Oops.Oh("域账号同步保存失败");
    }

    /// <summary>
    /// 增加域账号
    /// </summary>
    /// <param name="tenantId"></param>
    /// <param name="userId"></param>
    /// <param name="account"></param>
    /// <param name="domainAccount"></param>
    /// <returns></returns>
    public async Task AddUserLdap(long tenantId, long userId, string account, string domainAccount)
    {
        // 只处理当前用户的映射，不能因账号字段相似而删除其他用户的数据。
        var userLdap = await _sysUserLdapRep.GetFirstAsync(u => u.TenantId == tenantId && u.UserId == userId);
        if (userLdap != null && !string.IsNullOrWhiteSpace(domainAccount) && userLdap.Account == domainAccount)
        {
            // 域账号未改变时保留同步得到的显示名、DN 和其他目录属性。
            userLdap.EmployeeId = account;
            await _sysUserLdapRep.AsUpdateable(userLdap).UpdateColumns(u => u.EmployeeId).ExecuteCommandAsync();
            return;
        }
        if (userLdap != null) await _sysUserLdapRep.DeleteByIdAsync(userLdap.Id);

        if (!string.IsNullOrWhiteSpace(domainAccount))
            await _sysUserLdapRep.InsertAsync(new SysUserLdap
            {
                EmployeeId = account, TenantId = tenantId, UserId = userId, Account = domainAccount,
                // 手工绑定尚未查询目录，使用账号作为显示名，DN 明确保留为空。
                UserName = domainAccount, Dn = string.Empty
            });
    }

    /// <summary>
    /// 删除域账号
    /// </summary>
    /// <param name="userId"></param>
    /// <returns></returns>
    public async Task DeleteUserLdapByUserId(long userId)
    {
        await _sysUserLdapRep.DeleteAsync(u => u.UserId == userId);
    }
}
