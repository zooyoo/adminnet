// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 单进程插件变更协调。数据库失败先回滚，发布或提交失败同时恢复原程序集。
/// </summary>
public static class PluginMutation
{
    private static readonly SemaphoreSlim Gate = new(1, 1);

    public static async Task RunExclusiveAsync(Func<Task> action)
    {
        await Gate.WaitAsync();
        try { await action(); }
        finally { Gate.Release(); }
    }

    public static void RunExclusive(Action action)
    {
        Gate.Wait();
        try { action(); }
        finally { Gate.Release(); }
    }

    public static async Task ExecuteAsync(Func<Task> begin, Func<Task> save, Action publish, Func<Task> commit, Func<Task> rollback, Action restore)
    {
        await begin();
        bool publicationAttempted = false;
        try
        {
            await save();
            publicationAttempted = true;
            publish();
            await commit();
        }
        catch (Exception original)
        {
            List<Exception> failures = new() { original };
            try { await rollback(); }
            catch (Exception failure) { failures.Add(failure); }
            if (publicationAttempted)
            {
                try { restore(); }
                catch (Exception failure) { failures.Add(failure); }
            }
            if (failures.Count > 1) throw new AggregateException("插件操作及恢复失败，需要核对数据库与运行状态", failures);
            throw;
        }
    }
}
