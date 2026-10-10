// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Xunit;

namespace Admin.NET.Test.Stress;

public class StressTestBoundaryTests
{
    private static StressTestRunner Runner(bool enabled = true) => new(Options.Create(new StressTestOptions
    {
        Enabled = enabled, Targets = [new StressTestTarget { Name = "隔离目标", RequestUri = "http://127.0.0.1:8080/probe/" }],
        MaxTotalRequests = 60, MaxConcurrency = 4, MaxRounds = 10, MaxRequestsPerRound = 20
    }));

    private static StressTestInput Input(string uri = "http://127.0.0.1:8080/probe/ok") => new()
    {
        RequestUri = uri, RequestMethod = "POST", NumberOfRequests = 4, NumberOfRounds = 3, MaxDegreeOfParallelism = 2
    };

    [Theory]
    [InlineData("http://127.0.0.1:8081/probe/ok")]
    [InlineData("https://127.0.0.1:8080/probe/ok")]
    [InlineData("http://127.0.0.2:8080/probe/ok")]
    [InlineData("http://localhost:8080/probe/ok")]
    [InlineData("http://127.0.0.1:8080/probeOther/ok")]
    [InlineData("http://127.0.0.1:8080/probe/../outside")]
    [InlineData("http://127.0.0.1:8080/probe/%2e%2e/outside")]
    [InlineData("http://127.0.0.1:8080/probe/%252e%252e/outside")]
    [InlineData("http://127.0.0.1:8080/probe/a%2fb")]
    [InlineData("http://user:password@127.0.0.1:8080/probe/ok")]
    [InlineData("http://127.0.0.1:8080/probe/ok#fragment")]
    [InlineData("ftp://127.0.0.1:8080/probe/ok")]
    public void ValidateRequest_UnauthorizedTarget_RejectsBeforeDispatch(string uri)
    {
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(Input(uri)));
    }

    [Fact]
    public void ValidateRequest_PathAndQuery_EncodesAndKeepsAuthorizedPrefix()
    {
        var input = Input("http://127.0.0.1:8080/probe/{key}?existing=original");
        input.PathParameters = new() { ["key"] = "轮次 测试" };
        input.QueryParameters = new() { ["existing"] = "覆盖&=", ["q"] = "query value" };
        input.RequestParameters = [new("label", "a"), new("label", "b")];
        var uri = Runner().ValidateRequest(input);
        Assert.Equal("/probe/轮次 测试", Uri.UnescapeDataString(uri.AbsolutePath));
        Assert.Contains("existing=", uri.Query); Assert.Contains("q=query", uri.Query);
        Assert.Equal(2, input.RequestParameters.Count);
    }

    [Fact]
    public void ValidateRequest_PathCannotCreateAuthorizedTargetFromUntrustedTemplate()
    {
        var input = Input("http://{host}:8080/probe/ok");
        input.PathParameters = new() { ["host"] = "127.0.0.1" };
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
    }

    [Fact]
    public void ValidateRequest_QueryKeys_RejectsCaseInsensitiveDuplicates()
    {
        var input = Input();
        input.QueryParameters = new() { ["key"] = "a", ["Key"] = "b" };
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
    }

    [Theory]
    [InlineData(0, 3, 2)]
    [InlineData(21, 3, 2)]
    [InlineData(4, 0, 2)]
    [InlineData(4, 11, 2)]
    [InlineData(20, 4, 2)]
    [InlineData(4, 3, 5)]
    [InlineData(4, 3, -1)]
    public void ValidateRequest_ExecutionBudget_RejectsInvalidValues(int requests, int rounds, int concurrency)
    {
        var input = Input(); input.NumberOfRequests = requests; input.NumberOfRounds = rounds; input.MaxDegreeOfParallelism = concurrency;
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
    }

    [Theory]
    [InlineData("Host", "other")]
    [InlineData("Content-Length", "99")]
    [InlineData("Transfer-Encoding", "chunked")]
    [InlineData("Connection", "upgrade")]
    [InlineData("X-Test", "a\r\nb")]
    [InlineData("invalid name", "value")]
    public void ValidateRequest_TransportHeaders_RejectsInvalidOrOverrideFields(string key, string value)
    {
        var input = Input(); input.Headers = new() { [key] = value };
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
    }

    [Fact]
    public void ValidateRequest_EmptyDuplicateAndNullParameters_RejectsIncompleteDraft()
    {
        var input = Input(); input.Headers = new() { ["x-test"] = "a", ["X-Test"] = "b" };
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
        input.Headers = []; input.PathParameters = new() { ["Key"] = "a", ["key"] = "b" };
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
        input.PathParameters = []; input.QueryParameters = null;
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
        input.QueryParameters = []; input.RequestParameters = [new("", "value")];
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
        input.RequestParameters = []; input.NumberOfRounds = null;
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
        input.NumberOfRounds = 1; input.MaxDegreeOfParallelism = null;
        Assert.Throws<ArgumentException>(() => Runner().ValidateRequest(input));
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    public void ValidateRequest_SupportedMethodAndAutomaticConcurrency_Accepts(string method)
    {
        var input = Input(); input.RequestMethod = method; input.MaxDegreeOfParallelism = 0;
        Assert.Equal("127.0.0.1", Runner().ValidateRequest(input).Host);
    }

    [Fact]
    public void GetTargets_DefaultOrDisabled_ExposesNoExecutableTarget()
    {
        Assert.Empty(new StressTestRunner(Options.Create(new StressTestOptions())).GetTargets().Targets);
        Assert.Empty(Runner(false).GetTargets().Targets);
        Assert.Throws<ArgumentException>(() => Runner(false).ValidateRequest(Input()));
    }

    [Fact]
    public async Task RunAsync_AlreadyCanceled_ThrowsAndReleasesNoResult()
    {
        using var cancellation = new CancellationTokenSource(); cancellation.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Runner().RunAsync(Input(), cancellation.Token));
    }

    [Theory]
    [InlineData("/api/sysCommon/stressTest")]
    [InlineData("/api/sysCommon/stressTestTargets")]
    public void Permission_StressEndpoint_RequiresExplicitExecutionGrant(string route)
    {
        var context = new DefaultHttpContext(); context.Request.Path = route;
        Assert.Equal("sysCommon:stressTest", RoutePermissionUtil.GetPermissionName(context));
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(RoutePermissionUtil.GetPermissionName(context)));
        Assert.Null(Attribute.GetCustomAttribute(typeof(SysCommonService), typeof(AllowAnonymousAttribute)));
        Assert.Null(Attribute.GetCustomAttribute(typeof(SysCommonService).GetMethod(nameof(SysCommonService.StressTest)), typeof(AllowAnonymousAttribute)));
        Assert.Null(Attribute.GetCustomAttribute(typeof(SysCommonService).GetMethod(nameof(SysCommonService.GetStressTestTargets)), typeof(AllowAnonymousAttribute)));
        Assert.NotNull(Attribute.GetCustomAttribute(typeof(SysCommonService).GetMethod(nameof(SysCommonService.GetSmKeyPair)), typeof(AllowAnonymousAttribute)));
    }
}
