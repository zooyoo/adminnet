// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Xunit;

namespace Admin.NET.Test.OpenAccess;

public class OpenAccessPermissionTests
{
    [Theory]
    [InlineData("page", "sysOpenAccess:page")]
    [InlineData("add", "sysOpenAccess:add")]
    [InlineData("update", "sysOpenAccess:update")]
    [InlineData("delete", "sysOpenAccess:delete")]
    [InlineData("generateSignature", "sysOpenAccess:page")]
    [InlineData("secret", "sysOpenAccess:secret")]
    [InlineData("tenantList", "sysOpenAccess:tenantList")]
    [InlineData("userList", "sysOpenAccess:userList")]
    public void GetPermissionName_OpenAccessAction_UsesExplicitLegacyGrant(string action, string expected)
    {
        var path = "/api/sysOpenAccess/" + action;
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse(path), 0, EndpointMetadataCollection.Empty, "test"));
        var permission = RoutePermissionUtil.GetPermissionName(context);
        Assert.Equal(expected, permission);
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
        Assert.False(RoutePermissionUtil.HasPermission(permission, Array.Empty<string>()));
    }

    [Theory]
    [InlineData("sysOpenAccess:secret")]
    [InlineData("sysOpenAccess:tenantList")]
    [InlineData("sysOpenAccess:userList")]
    public void HasPermission_CandidateOrSecret_AcceptsAddOrUpdateOnly(string permission)
    {
        Assert.True(RoutePermissionUtil.HasPermission(permission, new[] { "sysOpenAccess:add" }));
        Assert.True(RoutePermissionUtil.HasPermission(permission, new[] { "sysOpenAccess:update" }));
        Assert.False(RoutePermissionUtil.HasPermission(permission, new[] { "sysOpenAccess:page" }));
        Assert.False(RoutePermissionUtil.HasPermission(permission, new[] { "sysOpenAccess:delete" }));
    }

    [Theory]
    [InlineData("sysOpenAccess:page")]
    [InlineData("sysOpenAccess:delete")]
    [InlineData("sysOpenAccess:unknownAction")]
    [InlineData("sysFile:page")]
    [InlineData("sysOpenAccess:add|sysOpenAccess:update")]
    [InlineData("sysOpenAccess:secret|sysOpenAccess:delete")]
    public void HasPermission_OtherOrCompositePermission_DoesNotExpandAddOrUpdate(string permission)
    {
        Assert.False(RoutePermissionUtil.HasPermission(permission, new[] { "sysOpenAccess:add", "sysOpenAccess:update" }));
    }

    [Fact]
    public void HasPermission_CaseInsensitiveExactGrant_PreservesExistingAuthorization()
    {
        Assert.True(RoutePermissionUtil.HasPermission("sysOpenAccess:PAGE", new[] { "sysopenaccess:page" }));
        Assert.True(RoutePermissionUtil.HasPermission("sysFile:page", new[] { "sysFile:page" }));
        Assert.False(RoutePermissionUtil.HasPermission("sysOpenAccess:page", null));
        Assert.False(RoutePermissionUtil.HasPermission(null, new[] { "sysOpenAccess:page" }));
    }
}
