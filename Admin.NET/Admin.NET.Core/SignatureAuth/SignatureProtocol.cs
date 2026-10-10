// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Globalization;
using System.Security.Cryptography;

namespace Admin.NET.Core;

/// <summary>
/// 开放接口签名协议，与签名生成和请求验证共用
/// </summary>
public static class SignatureProtocol
{
    public const int AccessKeyMaxLength = 128;
    public const int AccessSecretMaxLength = 256;
    public const int NonceMaxLength = 128;
    public const int PathMaxLength = 2048;

    /// <summary>
    /// 每个签名请求头必须只有一个值，防止重复头和代理合并头造成歧义
    /// </summary>
    [NonAction]
    public static bool TryGetSingleHeader(IHeaderDictionary headers, string name, out string value)
    {
        value = null;
        if (!headers.TryGetValue(name, out var values) || values.Count != 1 || string.IsNullOrWhiteSpace(values[0])) return false;
        value = values[0];
        return true;
    }

    /// <summary>
    /// 校验签名参数，不修改参与签名的任何值
    /// </summary>
    [NonAction]
    public static bool TryValidate(string method, string path, string accessKey, string accessSecret,
        string timestamp, string nonce, out string error)
    {
        if (!IsHttpMethod(method)) error = "请求方法无效";
        else if (!IsPath(path)) error = "请求路径无效";
        else if (!IsHeaderToken(accessKey, AccessKeyMaxLength)) error = "AccessKey 无效";
        else if (string.IsNullOrWhiteSpace(accessSecret) || accessSecret.Length > AccessSecretMaxLength) error = "AccessSecret 无效";
        else if (!IsHeaderToken(nonce, NonceMaxLength)) error = "随机数无效";
        else if (!TryGetTimestamp(timestamp, out _)) error = "时间戳无效";
        else
        {
            error = null;
            return true;
        }
        return false;
    }

    [NonAction]
    public static bool IsHttpMethod(string method)
    {
        return method is "GET" or "POST" or "PUT" or "DELETE" or "PATCH" or "HEAD" or "OPTIONS" or "TRACE" or "CONNECT";
    }

    [NonAction]
    public static bool IsPath(string path)
    {
        return !string.IsNullOrWhiteSpace(path) && path.Length <= PathMaxLength && path[0] == '/' &&
            !path.StartsWith("//", StringComparison.Ordinal) && !path.Contains("://", StringComparison.Ordinal) &&
            !path.Any(c => c is '?' or '#' or '\\' || char.IsControl(c) || char.IsWhiteSpace(c));
    }

    [NonAction]
    public static bool IsHeaderToken(string value, int maxLength)
    {
        return !string.IsNullOrWhiteSpace(value) && value.Length <= maxLength &&
            !value.Any(c => c is '&' or '|' or ',' || char.IsControl(c) || char.IsWhiteSpace(c));
    }

    /// <summary>
    /// 保留秒、毫秒时间戳兼容性，范围错误不会抛出异常
    /// </summary>
    [NonAction]
    public static bool TryGetTimestamp(string value, out DateTimeOffset timestamp)
    {
        timestamp = default;
        if (string.IsNullOrEmpty(value) || value.Length > 19 || value.Any(c => c < '0' || c > '9') ||
            !long.TryParse(value, NumberStyles.None, CultureInfo.InvariantCulture, out var unixTime) || unixTime <= 0)
            return false;
        try
        {
            timestamp = unixTime > 9999999999
                ? DateTimeOffset.FromUnixTimeMilliseconds(unixTime)
                : DateTimeOffset.FromUnixTimeSeconds(unixTime);
            return true;
        }
        catch (ArgumentOutOfRangeException)
        {
            return false;
        }
    }

    [NonAction]
    public static bool IsWithinAllowedDrift(DateTimeOffset timestamp, DateTimeOffset now, TimeSpan allowedDrift)
    {
        return allowedDrift >= TimeSpan.Zero && (timestamp - now).Duration() <= allowedDrift;
    }

    /// <summary>
    /// 随机数保留至该签名的有效期结束，覆盖未来时间戳的完整窗口
    /// </summary>
    [NonAction]
    public static TimeSpan GetNonceLifetime(DateTimeOffset timestamp, DateTimeOffset now, TimeSpan allowedDrift)
    {
        var ticks = Math.Clamp((decimal)(timestamp - now).Ticks + allowedDrift.Ticks, 1, long.MaxValue);
        return TimeSpan.FromTicks((long)ticks);
    }

    [NonAction]
    public static string GenerateSignature(string method, string path, string accessKey, string accessSecret,
        string timestamp, string nonce)
    {
        var content = $"{method}&{path}&{accessKey}&{timestamp}&{nonce}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(accessSecret));
        return Convert.ToBase64String(hmac.ComputeHash(Encoding.UTF8.GetBytes(content)));
    }

    /// <summary>
    /// 拒绝无效 Base64 并使用固定时间比较摘要
    /// </summary>
    [NonAction]
    public static bool VerifySignature(string signature, string method, string path, string accessKey,
        string accessSecret, string timestamp, string nonce)
    {
        if (signature == null || signature.Length != 44 || signature.Any(char.IsWhiteSpace)) return false;
        Span<byte> actual = stackalloc byte[32];
        if (!Convert.TryFromBase64String(signature, actual, out var bytesWritten) || bytesWritten != actual.Length) return false;
        var content = $"{method}&{path}&{accessKey}&{timestamp}&{nonce}";
        using var hmac = new HMACSHA256(Encoding.UTF8.GetBytes(accessSecret));
        var expected = hmac.ComputeHash(Encoding.UTF8.GetBytes(content));
        return CryptographicOperations.FixedTimeEquals(actual, expected);
    }
}
