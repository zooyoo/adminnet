// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using System.Text.Json;
using Xunit;

namespace Admin.NET.Test.Log;

public class LogDataSanitizerTests
{
    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("普通日志 value=42")]
    public void Sanitize_NonSensitiveText_PreservesContent(string input)
    {
        string actual = LogDataSanitizer.Sanitize(input);
        Assert.Equal(input, actual);
    }

    [Fact]
    public void Sanitize_NestedCredentials_RemovesSecretsAndPreservesBusinessValues()
    {
        // 准备：同时覆盖大小写、数字、数组及嵌套 JSON 字符串。
        const string input = """{"PASSWORD":"secret-password","Api_Key":123456,"rows":[{"account":"operator","refreshToken":"secret-refresh"}],"result":"{\"accessToken\":\"secret-access\"}"}""";

        string actual = LogDataSanitizer.Sanitize(input);

        using JsonDocument document = JsonDocument.Parse(actual);
        Assert.Equal("[redacted]", document.RootElement.GetProperty("PASSWORD").GetString());
        Assert.Equal("[redacted]", document.RootElement.GetProperty("Api_Key").GetString());
        Assert.Equal("operator", document.RootElement.GetProperty("rows")[0].GetProperty("account").GetString());
        Assert.DoesNotContain("secret-", actual);
        Assert.Equal(actual, LogDataSanitizer.Sanitize(actual));
    }

    [Fact]
    public void Sanitize_DifferenceColumn_RemovesSensitiveBeforeAndAfterValues()
    {
        const string input = """[{"TableName":"SysUser","Columns":[{"ColumnName":"Password","BeforeValue":"old-secret","AfterValue":"new-secret"},{"ColumnName":"RealName","BeforeValue":"张三","AfterValue":"李四"}]}]""";

        string actual = LogDataSanitizer.Sanitize(input);

        using JsonDocument document = JsonDocument.Parse(actual);
        JsonElement columns = document.RootElement[0].GetProperty("Columns");
        Assert.Equal("[redacted]", columns[0].GetProperty("BeforeValue").GetString());
        Assert.Equal("[redacted]", columns[0].GetProperty("AfterValue").GetString());
        Assert.Equal("张三", columns[1].GetProperty("BeforeValue").GetString());
        Assert.Equal("李四", columns[1].GetProperty("AfterValue").GetString());
    }

    [Fact]
    public void Sanitize_BearerAndQueryTokens_RemovesAuthenticationValues()
    {
        const string input = "Authorization: Bearer secret.token.value GET /login?token=secret-query&account=operator&apiKey=secret-key";

        string actual = LogDataSanitizer.Sanitize(input);

        Assert.DoesNotContain("secret", actual);
        Assert.Contains("account=operator", actual);
    }

    [Fact]
    public void SanitizeRecord_HistoricalLogs_RemovesCredentialsAndUnstructuredSql()
    {
        SysLogOp operation = new() { RequestParam = """{"password":"old-secret"}""", RequestUrl = "/login?token=old-secret", ReturnResult = """{"accessToken":"old-secret"}""" };
        SysLogDiff difference = new() { Sql = "SELECT 'old-secret'", Parameters = "old-secret", BusinessData = """{"apiKey":"old-secret"}""" };

        LogDataSanitizer.SanitizeRecord(operation);
        LogDataSanitizer.SanitizeRecord(difference);

        Assert.DoesNotContain("old-secret", operation.RequestParam + operation.RequestUrl + operation.ReturnResult + difference.BusinessData);
        Assert.Null(difference.Sql);
        Assert.Null(difference.Parameters);
    }

    [Theory]
    [InlineData("accessKey")]
    [InlineData("ACCESS_KEY")]
    [InlineData("access-secret")]
    [InlineData("AccessSecret")]
    [InlineData("sign")]
    public void Sanitize_OpenAccessJsonAndDifferenceColumns_RemovesCredentialValues(string field)
    {
        string input = JsonSerializer.Serialize(new Dictionary<string, object>
        {
            [field] = "credential-value",
            ["account"] = "operator",
            ["columns"] = new[] { new { ColumnName = field, BeforeValue = "credential-before", AfterValue = "credential-after" } },
            ["parameters"] = new[] { new { ParameterName = "@" + field, Value = "credential-parameter" } }
        });

        string actual = LogDataSanitizer.Sanitize(input);

        using JsonDocument document = JsonDocument.Parse(actual);
        Assert.Equal("[redacted]", document.RootElement.GetProperty(field).GetString());
        Assert.Equal("operator", document.RootElement.GetProperty("account").GetString());
        Assert.Equal("[redacted]", document.RootElement.GetProperty("columns")[0].GetProperty("BeforeValue").GetString());
        Assert.Equal("[redacted]", document.RootElement.GetProperty("columns")[0].GetProperty("AfterValue").GetString());
        Assert.Equal("[redacted]", document.RootElement.GetProperty("parameters")[0].GetProperty("Value").GetString());
        Assert.DoesNotContain("credential-", actual);
        Assert.Equal(actual, LogDataSanitizer.Sanitize(actual));
    }

    [Fact]
    public void Sanitize_OpenAccessUnstructuredTextAndQuery_RemovesCredentials()
    {
        const string input = "request {\"AccessSecret\":\"credential-secret\",\"access_key\":\"credential-key\",\"sign\":\"credential-sign\"} GET /api/demo/identity?accessKey=credential-key&access_secret=credential-secret&sign=credential-sign&account=operator";

        string actual = LogDataSanitizer.Sanitize(input);

        Assert.DoesNotContain("credential-", actual);
        Assert.Contains("account=operator", actual);
    }

    [Fact]
    public void SanitizeRecord_HistoricalOpenAccessLogs_RemovesSecretAndKeepsBinding()
    {
        SysLogOp operation = new()
        {
            RequestParam = """{"accessKey":"credential-key","accessSecret":"credential-secret","bindTenantId":42}""",
            ReturnResult = """{"sign":"credential-sign"}"""
        };
        SysLogDiff difference = new()
        {
            BusinessData = """{"AccessSecret":"credential-secret"}""",
            DiffData = """[{"ColumnName":"access_secret","BeforeValue":"credential-before","AfterValue":"credential-after"}]"""
        };

        LogDataSanitizer.SanitizeRecord(operation);
        LogDataSanitizer.SanitizeRecord(difference);

        Assert.DoesNotContain("credential-", operation.RequestParam + operation.ReturnResult + difference.BusinessData + difference.DiffData);
        using JsonDocument document = JsonDocument.Parse(operation.RequestParam);
        Assert.Equal(42, document.RootElement.GetProperty("bindTenantId").GetInt32());
    }
}
