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
    [InlineData("/api/sysFile/preview/{id}", "/api/sysFile/preview/17", "sysFile:downloadFile")]
    [InlineData("/api/sysFile/downloadFileBase64", "/api/sysFile/downloadFileBase64", "sysFile:downloadFile")]
    [InlineData("/api/sysFile/file", "/api/sysFile/file", "sysFile:page")]
    [InlineData("/api/sysFile/fileByIds", "/api/sysFile/fileByIds", "sysFile:page")]
    [InlineData("/api/sysFile/folder", "/api/sysFile/folder", "sysFile:page")]
    [InlineData("/api/sysFile/uploadFiles", "/api/sysFile/uploadFiles", "sysFile:uploadFile")]
    [InlineData("/api/sysFile/uploadFileFromBase64", "/api/sysFile/uploadFileFromBase64", "sysFile:uploadFile")]
    [InlineData("/api/sysDatabase/previewEntity", "/api/sysDatabase/previewEntity", "sysDatabase:createEntity")]
    [InlineData("/api/sysDatabase/previewSeedData", "/api/sysDatabase/previewSeedData", "sysDatabase:createSeedData")]
    [InlineData("/api/sysDatabase/generationOptions", "/api/sysDatabase/generationOptions", "sysDatabase:list")]
    [InlineData("/api/sysLogOp/detail/{id}", "/api/sysLogOp/detail/17", "sysOplog:page")]
    [InlineData("/api/sysLogEx/detail/{id}", "/api/sysLogEx/detail/17", "sysExlog:page")]
    [InlineData("/api/sysLogDiff/detail/{id}", "/api/sysLogDiff/detail/17", "sysDifflog:page")]
    [InlineData("/api/sysLogVis/page", "/api/sysLogVis/page", "sysVislog:page")]
    [InlineData("/api/sysLogOp/export", "/api/sysLogOp/export", "sysOplog:export")]
    [InlineData("/api/sysLogEx/export", "/api/sysLogEx/export", "sysExlog:export")]
    [InlineData("/api/sysLogVis/clear", "/api/sysLogVis/clear", "sysVislog:clear")]
    [InlineData("/api/sysServer/hardwareInfo", "/api/sysServer/hardwareInfo", "sysServer:page")]
    [InlineData("/api/sysServer/runtimeInfo", "/api/sysServer/runtimeInfo", "sysServer:page")]
    [InlineData("/api/sysServer/nuGetPackageInfo", "/api/sysServer/nuGetPackageInfo", "sysServer:page")]
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
    [InlineData("sysFile:page", true)]
    [InlineData("sysFile:uploadFile", true)]
    [InlineData("sysFile:downloadFile", true)]
    [InlineData("sysFile:update", true)]
    [InlineData("sysFile:delete", true)]
    [InlineData("sysDatabase:list", true)]
    [InlineData("sysDatabase:addTable", true)]
    [InlineData("sysDatabase:moveColumn", true)]
    [InlineData("sysDatabase:visualDbTable", true)]
    [InlineData("sysOplog:page", true)]
    [InlineData("sysExlog:export", true)]
    [InlineData("sysVislog:clear", true)]
    [InlineData("sysLogDiff:detail", true)]
    [InlineData("sysServer:page", true)]
    public void RequiresExplicitGrant_TranslationSensitiveAction_DoesNotDependOnMenuRegistration(string permission, bool expected)
    {
        Assert.Equal(expected, RoutePermissionUtil.RequiresExplicitGrant(permission));
    }
}
