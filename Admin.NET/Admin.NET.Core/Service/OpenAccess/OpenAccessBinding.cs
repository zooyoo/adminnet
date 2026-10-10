// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Globalization;
using System.Security.Claims;

namespace Admin.NET.Core;

/// <summary>
/// 开放接口绑定有效性与身份声明
/// </summary>
public static class OpenAccessBinding
{
    [NonAction]
    public static bool IsActive(SysOpenAccess openAccess)
    {
        return openAccess != null && openAccess.BindTenantId > 0 && openAccess.BindUserId > 0 &&
            openAccess.BindTenant?.Id == openAccess.BindTenantId && openAccess.BindTenant.Status == StatusEnum.Enable &&
            openAccess.BindUser?.Id == openAccess.BindUserId && openAccess.BindUser.Status == StatusEnum.Enable &&
            openAccess.BindUser.TenantId == openAccess.BindTenantId && Enum.IsDefined(openAccess.BindUser.AccountType);
    }

    [NonAction]
    public static bool CanManageUser(long tenantId, AccountTypeEnum? accountType, SysUser user)
    {
        if (user == null || accountType == null || !Enum.IsDefined(accountType.Value) || !Enum.IsDefined(user.AccountType)) return false;
        return accountType == AccountTypeEnum.SuperAdmin ||
            tenantId > 0 && user.TenantId == tenantId && (int)user.AccountType <= (int)accountType.Value;
    }

    [NonAction]
    public static bool TryCreatePrincipal(SysOpenAccess openAccess, string authenticationScheme, out ClaimsPrincipal principal)
    {
        principal = null;
        if (!IsActive(openAccess)) return false;
        var user = openAccess.BindUser;
        var claims = new[]
        {
            new Claim(ClaimConst.UserId, openAccess.BindUserId.ToString(CultureInfo.InvariantCulture)),
            new Claim(ClaimConst.TenantId, openAccess.BindTenantId.ToString(CultureInfo.InvariantCulture)),
            new Claim(ClaimConst.Account, user.Account ?? string.Empty),
            new Claim(ClaimConst.RealName, user.RealName ?? string.Empty),
            new Claim(ClaimConst.AccountType, ((int)user.AccountType).ToString(CultureInfo.InvariantCulture)),
            new Claim(ClaimConst.OrgId, user.OrgId.ToString(CultureInfo.InvariantCulture)),
            new Claim(ClaimConst.OrgName, user.SysOrg?.Name ?? string.Empty),
            new Claim(ClaimConst.OrgType, user.SysOrg?.Type ?? string.Empty)
        };
        principal = new ClaimsPrincipal(new ClaimsIdentity(claims, authenticationScheme));
        return true;
    }
}
