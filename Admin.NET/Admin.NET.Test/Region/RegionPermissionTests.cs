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

namespace Admin.NET.Test.Region;

public class RegionPermissionTests
{
    [Theory]
    [InlineData("/api/sysRegion/page", "sysRegion:page")]
    [InlineData("/api/sysRegion/add", "sysRegion:add")]
    [InlineData("/api/sysRegion/update", "sysRegion:update")]
    [InlineData("/api/sysRegion/delete", "sysRegion:delete")]
    [InlineData("/api/sysRegion/sync", "sysRegion:sync")]
    public void GetPermissionName_ManagementRoute_RequiresExactExplicitGrant(string route, string expected)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = route;

        var permission = RoutePermissionUtil.GetPermissionName(context);

        Assert.Equal(expected, permission);
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
        Assert.False(RoutePermissionUtil.HasPermission(permission, Array.Empty<string>()));
        Assert.False(RoutePermissionUtil.HasPermission(permission, new[] { "sysRegion:list", "sysRegion:tree", "sysRegion:other" }));
        Assert.True(RoutePermissionUtil.HasPermission(permission, new[] { expected.ToUpperInvariant() }));
    }

    [Theory]
    [InlineData("SYSREGION:PAGE")]
    [InlineData("SYSREGION:ADD")]
    [InlineData("SYSREGION:UPDATE")]
    [InlineData("SYSREGION:DELETE")]
    [InlineData("SYSREGION:SYNC")]
    public void RequiresExplicitGrant_ManagementPermission_IgnoresCase(string permission)
    {
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
    }

    [Theory]
    [InlineData("list")]
    [InlineData("tree")]
    public void GetPermissionName_SharedReadRoute_DoesNotRequireManagementGrant(string action)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/sysRegion/" + action;

        var permission = RoutePermissionUtil.GetPermissionName(context);

        Assert.Equal("sysRegion:" + action, permission);
        Assert.False(RoutePermissionUtil.RequiresExplicitGrant(permission));
    }

    [Fact]
    public void GetPermissionName_MatchedTemplate_ExcludesLongIdAndQuery()
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/sysRegion/delete/9007199254740993";
        context.Request.QueryString = new QueryString("?id=1");
        context.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask,
            RoutePatternFactory.Parse("api/sysRegion/delete/{id:long}"), 0, EndpointMetadataCollection.Empty, "RegionDelete"));

        var permission = RoutePermissionUtil.GetPermissionName(context);

        Assert.Equal("sysRegion:delete", permission);
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
    }

    [Theory]
    [InlineData("sysRegion:add", "sysRegion:page")]
    [InlineData("sysRegion:update", "sysRegion:add")]
    [InlineData("sysRegion:delete", "sysRegion:update")]
    [InlineData("sysRegion:sync", "sysRegion:delete")]
    public void HasPermission_DifferentManagementGrant_DoesNotAuthorize(string permission, string ownGrant)
    {
        Assert.False(RoutePermissionUtil.HasPermission(permission, new[] { ownGrant }));
    }
}
