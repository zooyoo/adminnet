// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Primitives;
using Xunit;

namespace Admin.NET.Test.OpenAccess;

public class SignatureProtocolTests
{
    private const string Path = "/api/demo/identity";
    private const string Key = "open-key-known";
    private const string Secret = " 秘钥 A+/= ";
    private const string Timestamp = "1770000000";
    private const string Nonce = "nonce-123";
    private const string KnownSignature = "1PzPo8xYIEWzgP8IJN1JtCG79j4/nhxN7v8qgDSP7e4=";

    [Fact]
    public void GenerateSignature_Utf8SecretWithSpaces_MatchesKnownVector()
    {
        // 预先由独立 HMAC 实现计算，确保密钥中的空格和 UTF8 字节保持原样。
        Assert.Equal(KnownSignature, SignatureProtocol.GenerateSignature("GET", Path, Key, Secret, Timestamp, Nonce));
        Assert.True(SignatureProtocol.VerifySignature(KnownSignature, "GET", Path, Key, Secret, Timestamp, Nonce));
        Assert.False(SignatureProtocol.VerifySignature(KnownSignature, "GET", Path, Key, Secret.Trim(), Timestamp, Nonce));
    }

    [Theory]
    [InlineData("method")]
    [InlineData("path")]
    [InlineData("key")]
    [InlineData("secret")]
    [InlineData("timestamp")]
    [InlineData("nonce")]
    public void VerifySignature_TamperedSignedField_Rejects(string field)
    {
        var method = field == "method" ? "POST" : "GET";
        var path = field == "path" ? "/api/demo/helloWord" : Path;
        var key = field == "key" ? Key + "x" : Key;
        var secret = field == "secret" ? Secret + "x" : Secret;
        var timestamp = field == "timestamp" ? "1770000001" : Timestamp;
        var nonce = field == "nonce" ? Nonce + "x" : Nonce;
        Assert.False(SignatureProtocol.VerifySignature(KnownSignature, method, path, key, secret, timestamp, nonce));
    }

    [Fact]
    public void VerifySignature_InvalidBase64OrDigestLength_RejectsWithoutThrowing()
    {
        string[] signatures = [null, "", new string('!', 44), new string('A', 44), KnownSignature + " ",
            Convert.ToBase64String(new byte[31]), Convert.ToBase64String(new byte[33]), Convert.ToBase64String(new byte[32])];
        foreach (var signature in signatures)
            Assert.False(SignatureProtocol.VerifySignature(signature, "GET", Path, Key, Secret, Timestamp, Nonce));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("relative/path")]
    [InlineData("https://example.test/api/demo/identity")]
    [InlineData("//example.test/api/demo/identity")]
    [InlineData("/https://example.test/api")]
    [InlineData("/api/demo/identity?query=1")]
    [InlineData("/api/demo/identity#fragment")]
    [InlineData("/api\\demo")]
    [InlineData("/api\ndemo")]
    [InlineData("/api\u0001demo")]
    [InlineData("/api demo")]
    public void IsPath_InvalidPath_Rejects(string path)
    {
        Assert.False(SignatureProtocol.IsPath(path));
    }

    [Theory]
    [InlineData("/")]
    [InlineData("/api/demo/identity")]
    [InlineData("/api/demo/helloWord")]
    [InlineData("/api/中文")]
    public void IsPath_AbsoluteLocalPath_Accepts(string path)
    {
        Assert.True(SignatureProtocol.IsPath(path));
    }

    [Theory]
    [InlineData("GET")]
    [InlineData("POST")]
    [InlineData("PUT")]
    [InlineData("DELETE")]
    [InlineData("PATCH")]
    [InlineData("HEAD")]
    [InlineData("OPTIONS")]
    [InlineData("TRACE")]
    [InlineData("CONNECT")]
    public void TryValidate_LegacyHttpMethod_Accepts(string method)
    {
        Assert.True(SignatureProtocol.TryValidate(method, Path, Key, Secret, Timestamp, Nonce, out var error));
        Assert.Null(error);
    }

    [Theory]
    [InlineData("get")]
    [InlineData("OTHER")]
    [InlineData("9")]
    [InlineData(null)]
    public void TryValidate_UnknownHttpMethod_Rejects(string method)
    {
        Assert.False(SignatureProtocol.TryValidate(method, Path, Key, Secret, Timestamp, Nonce, out var error));
        Assert.NotEmpty(error);
    }

    [Fact]
    public void TryValidate_LengthBoundaries_AcceptsMaximumAndRejectsLonger()
    {
        var key = new string('k', SignatureProtocol.AccessKeyMaxLength);
        var secret = new string('s', SignatureProtocol.AccessSecretMaxLength);
        var nonce = new string('n', SignatureProtocol.NonceMaxLength);
        var path = "/" + new string('p', SignatureProtocol.PathMaxLength - 1);
        Assert.True(SignatureProtocol.TryValidate("GET", path, key, secret, Timestamp, nonce, out _));
        Assert.False(SignatureProtocol.TryValidate("GET", path, key + "k", secret, Timestamp, nonce, out _));
        Assert.False(SignatureProtocol.TryValidate("GET", path, key, secret + "s", Timestamp, nonce, out _));
        Assert.False(SignatureProtocol.TryValidate("GET", path, key, secret, Timestamp, nonce + "n", out _));
        Assert.False(SignatureProtocol.TryValidate("GET", path + "p", key, secret, Timestamp, nonce, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("one,two")]
    [InlineData("one&two")]
    [InlineData("one|two")]
    [InlineData("one\rtwo")]
    public void TryValidate_InvalidKeyOrNonce_Rejects(string value)
    {
        Assert.False(SignatureProtocol.TryValidate("GET", Path, value, Secret, Timestamp, Nonce, out _));
        Assert.False(SignatureProtocol.TryValidate("GET", Path, Key, Secret, Timestamp, value, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData(" ")]
    public void TryValidate_EmptySecret_Rejects(string secret)
    {
        Assert.False(SignatureProtocol.TryValidate("GET", Path, Key, secret, Timestamp, Nonce, out _));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("0")]
    [InlineData("-1")]
    [InlineData("+1770000000")]
    [InlineData("1.5")]
    [InlineData("1e3")]
    [InlineData("1770000000 ")]
    [InlineData("9223372036854775807")]
    [InlineData("9223372036854775808")]
    [InlineData("253402300800000")]
    public void TryGetTimestamp_InvalidOrOverflowValue_RejectsWithoutThrowing(string timestamp)
    {
        Assert.False(SignatureProtocol.TryGetTimestamp(timestamp, out _));
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void TryGetTimestamp_SecondsOrMilliseconds_PreservesInstant(bool milliseconds)
    {
        var expected = new DateTimeOffset(2026, 10, 10, 8, 0, 0, TimeSpan.Zero);
        var timestamp = milliseconds ? expected.ToUnixTimeMilliseconds() : expected.ToUnixTimeSeconds();
        Assert.True(SignatureProtocol.TryGetTimestamp(timestamp.ToString(System.Globalization.CultureInfo.InvariantCulture), out var actual));
        Assert.Equal(expected, actual);
    }

    [Theory]
    [InlineData(-301, false)]
    [InlineData(-300, true)]
    [InlineData(0, true)]
    [InlineData(300, true)]
    [InlineData(301, false)]
    public void IsWithinAllowedDrift_DefaultFiveMinutes_EnforcesBothDirections(int seconds, bool expected)
    {
        var now = new DateTimeOffset(2026, 10, 10, 8, 0, 0, TimeSpan.Zero);
        Assert.Equal(expected, SignatureProtocol.IsWithinAllowedDrift(now.AddSeconds(seconds), now, TimeSpan.FromMinutes(5)));
        Assert.False(SignatureProtocol.IsWithinAllowedDrift(now, now, TimeSpan.FromTicks(-1)));
    }

    [Fact]
    public void GetNonceLifetime_FutureTimestamp_CoversFullRemainingSignatureWindow()
    {
        var now = new DateTimeOffset(2026, 10, 10, 8, 0, 0, TimeSpan.Zero);
        Assert.Equal(TimeSpan.FromMinutes(10), SignatureProtocol.GetNonceLifetime(now.AddMinutes(5), now, TimeSpan.FromMinutes(5)));
        Assert.Equal(TimeSpan.FromMinutes(5), SignatureProtocol.GetNonceLifetime(now, now, TimeSpan.FromMinutes(5)));
    }

    [Theory]
    [InlineData("accessKey")]
    [InlineData("timestamp")]
    [InlineData("nonce")]
    [InlineData("sign")]
    public void TryGetSingleHeader_DuplicateHeader_Rejects(string name)
    {
        var headers = new HeaderDictionary { [name] = new StringValues(new[] { "one", "two" }) };
        Assert.False(SignatureProtocol.TryGetSingleHeader(headers, name, out _));
        headers[name] = "single";
        Assert.True(SignatureProtocol.TryGetSingleHeader(headers, name, out var value));
        Assert.Equal("single", value);
    }

    [Fact]
    public void TryGetSingleHeader_MissingOrEmptyHeader_Rejects()
    {
        var headers = new HeaderDictionary();
        Assert.False(SignatureProtocol.TryGetSingleHeader(headers, "accessKey", out _));
        headers["accessKey"] = " ";
        Assert.False(SignatureProtocol.TryGetSingleHeader(headers, "accessKey", out _));
    }
}
