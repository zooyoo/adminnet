// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core.Service;
using Xunit;

namespace Admin.NET.Test.Plugin;

public class PluginMutationTests
{
    [Theory]
    [InlineData("none", "begin,save,publish,commit")]
    [InlineData("begin", "begin")]
    [InlineData("save", "begin,save,rollback")]
    [InlineData("publish", "begin,save,publish,rollback,restore")]
    [InlineData("commit", "begin,save,publish,commit,rollback,restore")]
    public async Task ExecuteAsync_FailureStage_RestoresOnlyAffectedState(string failure, string expected)
    {
        List<string> events = new();
        void Step(string name)
        {
            events.Add(name);
            if (name == failure) throw new InvalidOperationException(name);
        }
        Task StepAsync(string name) { Step(name); return Task.CompletedTask; }
        Task Run() => PluginMutation.ExecuteAsync(() => StepAsync("begin"), () => StepAsync("save"), () => Step("publish"), () => StepAsync("commit"), () => StepAsync("rollback"), () => Step("restore"));
        if (failure == "none") await Run();
        else Assert.Equal(failure, (await Assert.ThrowsAsync<InvalidOperationException>(Run)).Message);
        Assert.Equal(expected, string.Join(',', events));
    }

    [Fact]
    public async Task ExecuteAsync_RollbackFails_StillRestoresRuntimeAndRetainsErrors()
    {
        bool restored = false;
        AggregateException error = await Assert.ThrowsAsync<AggregateException>(() => PluginMutation.ExecuteAsync(
            () => Task.CompletedTask, () => Task.CompletedTask,
            () => throw new InvalidOperationException("publish"), () => Task.CompletedTask,
            () => throw new InvalidOperationException("rollback"), () => { restored = true; throw new InvalidOperationException("restore"); }));
        Assert.True(restored);
        Assert.Equal(new[] { "publish", "rollback", "restore" }, error.InnerExceptions.Select(item => item.Message));
    }

    [Fact]
    public async Task RunExclusiveAsync_ConcurrentMutation_WaitsAndReleasesAfterFailure()
    {
        TaskCompletionSource entered = new(TaskCreationOptions.RunContinuationsAsynchronously);
        TaskCompletionSource release = new(TaskCreationOptions.RunContinuationsAsynchronously);
        bool secondEntered = false;
        Task first = PluginMutation.RunExclusiveAsync(async () =>
        {
            entered.SetResult();
            await release.Task;
            throw new InvalidOperationException("first");
        });
        await entered.Task.WaitAsync(TimeSpan.FromSeconds(5));
        Task second = PluginMutation.RunExclusiveAsync(() => { secondEntered = true; return Task.CompletedTask; });
        Assert.False(secondEntered);
        release.SetResult();
        await Assert.ThrowsAsync<InvalidOperationException>(() => first);
        await second.WaitAsync(TimeSpan.FromSeconds(5));
        Assert.True(secondEntered);
        PluginMutation.RunExclusive(() => { });
    }
}
