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

namespace Admin.NET.Test.Utils;

public class RoutePermissionUtilTests
{
    [Theory]
    [InlineData("/api/sysCache/delete/{key}", "/api/sysCache/delete/sys_config:sys_captcha", "sysCache:delete")]
    [InlineData("/api/sysCache/delete/{key}", "/api/sysCache/delete/key%2Fwith%25encoding", "sysCache:delete")]
    [InlineData("/api/sysCache/value/{key}", "/api/sysCache/value/key", "sysCache:keyList")]
    [InlineData("/api/sysCache/keysByPrefixKey/{prefixKey}", "/api/sysCache/keysByPrefixKey/sys_config", "sysCache:keyList")]
    [InlineData("/api/sysCache/deleteByPreKey/{prefixKey}", "/api/sysCache/deleteByPreKey/sys_config", "sysCache:delete")]
    [InlineData("/api/sysCache/clear", "/api/sysCache/clear", "sysCache:clear")]
    [InlineData("/api/sysPos/add", "/api/sysPos/add", "sysPos:add")]
    [InlineData("/api/sysUser/{id:long}/update", "/api/sysUser/123/update", "sysUser:update")]
    [InlineData("/api/files/download/{**path}", "/api/files/download/a/b", "files:download")]
    [InlineData("/api/sysCache/delete/{key?}", "/api/sysCache/delete", "sysCache:delete")]
    [InlineData("/API/sysCache/value/{key}", "/API/sysCache/value/key", "sysCache:keyList")]
    [InlineData("/custom/action/{id}", "/custom/action/123", "custom:action")]
    public void GetPermissionName_MatchedRoute_ExcludesParameterValues(string template, string path, string expected)
    {
        // 准备
        DefaultHttpContext context = new();
        context.Request.Path = path;
        context.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse(template), 0, EndpointMetadataCollection.Empty, "test"));

        // 执行
        string actual = RoutePermissionUtil.GetPermissionName(context);

        // 断言
        Assert.Equal(expected, actual);
    }

    [Fact]
    public void GetPermissionName_NoEndpoint_PreservesLiteralRoute()
    {
        DefaultHttpContext context = new();
        context.Request.Path = "/api/sysPos/add";
        Assert.Equal("sysPos:add", RoutePermissionUtil.GetPermissionName(context));
    }

    [Theory]
    [InlineData("sysLangText:export", true)]
    [InlineData("sysLangText:import", true)]
    [InlineData("sysLangText:batchDelete", true)]
    [InlineData("sysLangText:batchSave", true)]
    [InlineData("sysLangText:aiTranslateText", true)]
    [InlineData("sysConfig:sysInfo", false)]
    public void RequiresExplicitGrant_TranslationSensitiveAction_DoesNotDependOnMenuRegistration(string permission, bool expected)
    {
        Assert.Equal(expected, RoutePermissionUtil.RequiresExplicitGrant(permission));
    }
}
