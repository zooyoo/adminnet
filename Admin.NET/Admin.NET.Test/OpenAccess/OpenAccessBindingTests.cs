// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Microsoft.AspNetCore.Http;
using System.Runtime.CompilerServices;
using Xunit;

namespace Admin.NET.Test.OpenAccess;

public class OpenAccessBindingTests
{
    [Fact]
    public void TryCreatePrincipal_ActiveBinding_UsesBoundUserIdentityClaims()
    {
        var binding = CreateBinding();
        Assert.True(OpenAccessBinding.TryCreatePrincipal(binding, "Signature", out var principal));
        Assert.True(principal.Identity.IsAuthenticated);
        Assert.Equal("Signature", principal.Identity.AuthenticationType);
        var context = new DefaultHttpContext { User = principal };
        var manager = new UserManager(new HttpContextAccessor { HttpContext = context });
        Assert.Equal(34L, manager.UserId);
        Assert.Equal(12L, manager.TenantId);
        Assert.Equal("bound-user", manager.Account);
        Assert.Equal(56L, manager.OrgId);
        Assert.Equal(AccountTypeEnum.NormalUser, manager.AccountType);
        Assert.Equal("bound-org", principal.FindFirst(ClaimConst.OrgName)?.Value);
        Assert.Equal("company", principal.FindFirst(ClaimConst.OrgType)?.Value);
        Assert.Null(principal.FindFirst("accessSecret"));
        Assert.Null(principal.FindFirst("accessKey"));
    }

    [Theory]
    [InlineData("tenant-missing")]
    [InlineData("user-missing")]
    [InlineData("tenant-disabled")]
    [InlineData("user-disabled")]
    [InlineData("tenant-id-mismatch")]
    [InlineData("user-id-mismatch")]
    [InlineData("user-tenant-mismatch")]
    [InlineData("account-type-invalid")]
    public void TryCreatePrincipal_InvalidBinding_RejectsWithoutNullReference(string scenario)
    {
        var binding = CreateBinding();
        switch (scenario)
        {
            case "tenant-missing": binding.BindTenant = null; break;
            case "user-missing": binding.BindUser = null; break;
            case "tenant-disabled": binding.BindTenant.Status = StatusEnum.Disable; break;
            case "user-disabled": binding.BindUser.Status = StatusEnum.Disable; break;
            case "tenant-id-mismatch": binding.BindTenant.Id++; break;
            case "user-id-mismatch": binding.BindUser.Id++; break;
            case "user-tenant-mismatch": binding.BindUser.TenantId++; break;
            case "account-type-invalid": binding.BindUser.AccountType = (AccountTypeEnum)123; break;
        }
        Assert.False(OpenAccessBinding.IsActive(binding));
        Assert.False(OpenAccessBinding.TryCreatePrincipal(binding, "Signature", out var principal));
        Assert.Null(principal);
    }

    [Fact]
    public void TryCreatePrincipal_MissingOrganization_AllowsActiveUserWithoutNullReference()
    {
        var binding = CreateBinding();
        binding.BindUser.SysOrg = null;
        binding.BindUser.RealName = null;
        Assert.True(OpenAccessBinding.TryCreatePrincipal(binding, "Signature", out var principal));
        Assert.Equal(string.Empty, principal.FindFirst(ClaimConst.OrgName)?.Value);
        Assert.Equal(string.Empty, principal.FindFirst(ClaimConst.OrgType)?.Value);
        Assert.Equal(string.Empty, principal.FindFirst(ClaimConst.RealName)?.Value);
    }

    [Fact]
    public void TryCreatePrincipal_NullOrganizationType_UsesEmptyClaimWithoutNullReference()
    {
        var binding = CreateBinding();
        binding.BindUser.SysOrg.Type = null;
        Assert.True(OpenAccessBinding.TryCreatePrincipal(binding, "Signature", out var principal));
        Assert.Equal(string.Empty, principal.FindFirst(ClaimConst.OrgType)?.Value);
        Assert.Equal("bound-org", principal.FindFirst(ClaimConst.OrgName)?.Value);
    }

    [Theory]
    [InlineData(777, 777, 12, true)]
    [InlineData(777, 666, 12, true)]
    [InlineData(777, 888, 12, false)]
    [InlineData(888, 777, 12, true)]
    [InlineData(888, 999, 12, false)]
    [InlineData(888, 777, 99, false)]
    [InlineData(999, 999, 99, true)]
    public void CanManageUser_AccountLevelAndTenant_EnforcesScope(int operatorType, int boundType, long boundTenant, bool expected)
    {
        var user = CreateUser(boundTenant, (AccountTypeEnum)boundType);
        Assert.Equal(expected, OpenAccessBinding.CanManageUser(12, (AccountTypeEnum)operatorType, user));
    }

    [Fact]
    public void CanManageUser_MissingOrUndefinedAccountType_Rejects()
    {
        var user = CreateUser(12, AccountTypeEnum.NormalUser);
        Assert.False(OpenAccessBinding.CanManageUser(12, null, user));
        Assert.False(OpenAccessBinding.CanManageUser(12, (AccountTypeEnum)123, user));
        Assert.False(OpenAccessBinding.CanManageUser(12, AccountTypeEnum.NormalUser, null));
        user.AccountType = (AccountTypeEnum)123;
        Assert.False(OpenAccessBinding.CanManageUser(12, AccountTypeEnum.SuperAdmin, user));
    }

    private static SysOpenAccess CreateBinding()
    {
        return new SysOpenAccess
        {
            BindTenantId = 12,
            BindUserId = 34,
            BindTenant = new SysTenant { Id = 12, Status = StatusEnum.Enable },
            BindUser = CreateUser(12, AccountTypeEnum.NormalUser)
        };
    }

    private static SysUser CreateUser(long tenantId, AccountTypeEnum accountType)
    {
        // SysUser 的默认语言依赖 Web Host；此 fixture 仅填充绑定与身份声明所需字段。
        var user = (SysUser)RuntimeHelpers.GetUninitializedObject(typeof(SysUser));
        user.Id = 34;
        user.TenantId = tenantId;
        user.Status = StatusEnum.Enable;
        user.AccountType = accountType;
        user.Account = "bound-user";
        user.RealName = "绑定用户";
        user.OrgId = 56;
        user.SysOrg = new SysOrg { Id = 56, Name = "bound-org", Type = "company" };
        return user;
    }
}
