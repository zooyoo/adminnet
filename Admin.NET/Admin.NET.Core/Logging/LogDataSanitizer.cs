// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Text.Json.Nodes;

namespace Admin.NET.Core;

/// <summary>对持久化日志和历史日志响应中的认证值进行脱敏</summary>
public static class LogDataSanitizer
{
    private static readonly HashSet<string> SensitiveNames = new(StringComparer.OrdinalIgnoreCase)
    {
        "password", "accessToken", "refreshToken", "token", "apiKey", "secretKey", "clientSecret",
        "authorization", "cookie", "setcookie", "connectionString", "accessKey", "accessSecret", "sign"
    };

    public static bool IsSensitiveName(string name) => name != null && SensitiveNames.Contains(name.Replace("_", "").Replace("-", ""));

    public static T SanitizeRecord<T>(T record) where T : SysLogVis
    {
        if (record == null) return null;
        if (record is SysLogOp operation)
        {
            operation.Message = Sanitize(operation.Message);
            operation.Exception = Sanitize(operation.Exception);
            operation.RequestUrl = Sanitize(operation.RequestUrl);
            operation.RequestParam = Sanitize(operation.RequestParam);
            operation.ReturnResult = Sanitize(operation.ReturnResult);
        }
        else if (record is SysLogEx exception)
        {
            exception.Message = Sanitize(exception.Message);
            exception.Exception = Sanitize(exception.Exception);
            exception.RequestUrl = Sanitize(exception.RequestUrl);
            exception.RequestParam = Sanitize(exception.RequestParam);
            exception.ReturnResult = Sanitize(exception.ReturnResult);
        }
        return record;
    }

    public static SysLogDiff SanitizeRecord(SysLogDiff record)
    {
        if (record == null) return null;
        record.DiffData = Sanitize(record.DiffData);
        record.BusinessData = Sanitize(record.BusinessData);
        // SQL 和无字段上下文的参数可能包含历史明文凭据，详情无需返回它们。
        record.Sql = null;
        record.Parameters = null;
        return record;
    }

    public static string Sanitize(string text)
    {
        if (string.IsNullOrEmpty(text)) return text;
        if (text.TrimStart().StartsWith('{') || text.TrimStart().StartsWith('['))
        {
            try
            {
                JsonNode node = JsonNode.Parse(text);
                SanitizeNode(node);
                text = node.ToJsonString();
            }
            catch (System.Text.Json.JsonException) { /* 非 JSON 日志继续按文本脱敏。 */ }
        }
        text = Regex.Replace(text, @"Bearer\s+[A-Za-z0-9._~+/=-]+", "Bearer [redacted]", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, "(\"(?:password|accessToken|refreshToken|apiKey|secretKey|access[_-]?Key|access[_-]?Secret|sign|authorization|cookie|set-cookie)\"\\s*:\\s*)\"(?:\\\\.|[^\"\\\\])*\"", "$1\"[redacted]\"", RegexOptions.IgnoreCase);
        text = Regex.Replace(text, @"([?&](?:token|access_token|password|apiKey|access[_-]?Key|access[_-]?Secret|sign)=)[^&\s""']+", "$1[redacted]", RegexOptions.IgnoreCase);
        return text;
    }

    private static void SanitizeNode(JsonNode node)
    {
        if (node is JsonArray array)
        {
            foreach (JsonNode child in array) SanitizeNode(child);
            return;
        }
        if (node is not JsonObject obj) return;
        string column = obj.FirstOrDefault(pair => pair.Key.Equals("columnName", StringComparison.OrdinalIgnoreCase)).Value?.ToString();
        string parameter = obj.FirstOrDefault(pair => pair.Key.Equals("parameterName", StringComparison.OrdinalIgnoreCase)).Value?.ToString()?.TrimStart('@', ':');
        foreach (string key in obj.Select(pair => pair.Key).ToArray())
        {
            if (IsSensitiveName(key) || ((IsSensitiveName(column) || IsSensitiveName(parameter)) &&
                (key.Equals("beforeValue", StringComparison.OrdinalIgnoreCase) || key.Equals("afterValue", StringComparison.OrdinalIgnoreCase) || key.Equals("value", StringComparison.OrdinalIgnoreCase))))
            {
                obj[key] = "[redacted]";
            }
            else if (obj[key] is JsonValue value && value.TryGetValue<string>(out string nested))
            {
                obj[key] = Sanitize(nested);
            }
            else SanitizeNode(obj[key]);
        }
    }
}
