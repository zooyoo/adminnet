// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Globalization;
using Furion.TimeCrontab;

namespace Admin.NET.Core.Service;

public static class JobCronPreview
{
    public static CronPreviewOutput Preview(CronPreviewInput input)
    {
        if (input.Format is < 0 or > 3) throw new ArgumentException("Cron 格式必须为 0、1、2 或 3");
        if (string.IsNullOrWhiteSpace(input.Expression) || input.Expression.Length > 120)
            throw new ArgumentException("Cron 表达式不能为空且不能超过 120 个字符");
        if (!string.IsNullOrEmpty(input.TimeZoneId) && input.TimeZoneId != TimeZoneInfo.Local.Id)
            throw new ArgumentException("预览和调度均使用服务端时区，不支持不同的时区");
        string expression = input.Expression.Trim();
        if (Regex.IsMatch(expression, @"(?:^|\s)[RH](?:[(/#]|\s|$)", RegexOptions.IgnoreCase))
            throw new ArgumentException("随机 Cron 无法提供与保存后严格一致的预览，请使用确定的时间规则");
        DateTime from = LocalTime(input.FromTime ?? DateTime.Now);
        DateTime? start = input.StartTime.HasValue ? LocalTime(input.StartTime.Value) : null;
        DateTime? end = input.EndTime.HasValue ? LocalTime(input.EndTime.Value) : null;
        if (start.HasValue && end.HasValue && start >= end) throw new ArgumentException("结束时间必须晚于起始时间");
        // 调度引擎从 StartTime 之后计算首次触发，不包含起点本身。
        if (start > from) from = start.Value;
        if (from.Year < 1901 || from.Year > 2098) throw new ArgumentException("预览起点年份必须在 1901 至 2098 之间");
        Crontab cron;
        try
        {
            cron = Crontab.Parse(expression, (CronStringFormat)input.Format);
        }
        catch (Exception exception) when (exception is ArgumentException or TimeCrontabException)
        {
            throw new ArgumentException("Cron 表达式与所选格式不匹配或包含无效字段", exception);
        }
        CronPreviewOutput output = new()
        {
            Expression = expression,
            Format = input.Format,
            TimeZoneId = TimeZoneInfo.Local.Id,
            FromTime = from.ToString("yyyy-MM-dd HH:mm:ss.fffffff", CultureInfo.InvariantCulture)
        };
        for (int index = 0; index < 5; index++)
        {
            DateTime next = cron.GetNextOccurrence(from);
            if (next <= from || next == DateTime.MaxValue || next.Year > 2099 || (end.HasValue && next > end)) break;
            output.Occurrences.Add(next.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture));
            from = next;
        }
        if (output.Occurrences.Count == 0) throw new ArgumentException("在指定起点和时间窗口内没有后续运行时间");
        return output;
    }

    private static DateTime LocalTime(DateTime value) => value.Kind == DateTimeKind.Utc ? value.ToLocalTime() : value;
}
