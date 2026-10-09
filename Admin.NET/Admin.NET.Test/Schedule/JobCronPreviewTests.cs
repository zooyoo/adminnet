// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Furion.TimeCrontab;
using Microsoft.AspNetCore.Http;
using Xunit;

namespace Admin.NET.Test.Schedule;

public class JobCronPreviewTests
{
    [Theory]
    [InlineData("*/5 * * * *", 0)]
    [InlineData("*/5 * * * * 2026", 1)]
    [InlineData("*/5 * * * * *", 2)]
    [InlineData("*/5 * * * * * 2026", 3)]
    [InlineData("@daily", 0)]
    public void Preview_SupportedFormat_ReturnsFiveEngineOccurrences(string expression, int format)
    {
        DateTime from = new(2026, 10, 9, 12, 0, 0);
        CronPreviewOutput actual = JobCronPreview.Preview(new() { Expression = expression, Format = format, FromTime = from });
        Crontab engine = Crontab.Parse(expression, (CronStringFormat)format);
        Assert.Equal(5, actual.Occurrences.Count);
        foreach (string occurrence in actual.Occurrences)
        {
            DateTime next = engine.GetNextOccurrence(from);
            Assert.Equal(next.ToString("yyyy-MM-dd HH:mm:ss"), occurrence);
            from = next;
        }
        Assert.Equal(TimeZoneInfo.Local.Id, actual.TimeZoneId);
    }

    [Theory]
    [InlineData("", 0)]
    [InlineData("61 * * * *", 0)]
    [InlineData("* * * * *", 2)]
    [InlineData("* * * * *", 4)]
    [InlineData("R * * * * *", 2)]
    public void Preview_InvalidExpressionOrFormat_Rejects(string expression, int format)
    {
        Assert.Throws<ArgumentException>(() => JobCronPreview.Preview(new() { Expression = expression, Format = format }));
    }

    [Fact]
    public void Preview_TimeWindow_ContainsOnlyMatchingTimes()
    {
        CronPreviewOutput result = JobCronPreview.Preview(new() { Expression = "*/10 * * * * *", Format = 2, FromTime = new(2026, 10, 9, 12, 0, 0), StartTime = new(2026, 10, 9, 12, 0, 10), EndTime = new(2026, 10, 9, 12, 0, 25) });
        Assert.Equal(new[] { "2026-10-09 12:00:20" }, result.Occurrences);
    }

    [Fact]
    public void Preview_NoFutureOccurrenceOrWrongZone_Rejects()
    {
        Assert.Throws<ArgumentException>(() => JobCronPreview.Preview(new() { Expression = "* * * * * 2025", Format = 1, FromTime = new(2026, 10, 9) }));
        Assert.Throws<ArgumentException>(() => JobCronPreview.Preview(new() { Expression = "* * * * *", TimeZoneId = "not-the-server-zone" }));
        Assert.Throws<ArgumentException>(() => JobCronPreview.Preview(new() { Expression = "* * * * *", StartTime = new(2026, 10, 10), EndTime = new(2026, 10, 9) }));
    }

    [Theory]
    [InlineData("cronPreview", "pageJobDetail")]
    [InlineData("listJobGroup", "pageJobDetail")]
    [InlineData("jobTriggerList", "pageJobDetail")]
    [InlineData("runJob", "runJob")]
    [InlineData("pauseAllJob", "pauseAllJob")]
    [InlineData("pageJobTriggerRecord", "pageJobTriggerRecord")]
    public void Permission_JobEndpoint_RequiresExplicitExistingGrant(string action, string grant)
    {
        DefaultHttpContext context = new();
        context.Request.Path = "/api/sysJob/" + action;
        string permission = RoutePermissionUtil.GetPermissionName(context);
        Assert.Equal("sysJob:" + grant, permission);
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
    }
}
