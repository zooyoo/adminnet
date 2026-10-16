// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Xunit;

namespace Admin.NET.Test.Utils;

public class GMUtilTests
{
    // 使用公开测试标量 1 和前端 sm-crypto-v2 生成的固定报文，不读取实际配置密钥。
    private const string PrivateScalar = "1";
    private const string Plaintext = "Proposal46-reset-password-fixture";
    private const string CipherWithoutPointPrefix = "048783f75ee85cc580a5d5ed633f89139d4fd2ab2707fc2ea9a2639928fc285d21ee51ed72d6e918486b7c6b0873c765d27d5124c49943fe34b795abfc9083062b21c8f63f0b4ee8529c72dbb88b3296babb57fadf000adcb98a7c1172c185c6ff759f2b489a74169572cbc9df1892db5294d22dc2e0ce41dab0f616230dd5ca7a";

    [Fact]
    public void SM2Decrypt_FrontendCipherCoordinateStartsWith04_ReturnsOriginalPassword()
    {
        // Arrange：前端省略点标记，但实际横坐标的首字节恰好为 04。
        string ciphertext = CipherWithoutPointPrefix;

        // Act：调用真实登录和密码修改共用的解密边界。
        string decrypted = GMUtil.SM2Decrypt(PrivateScalar, ciphertext);

        // Assert
        Assert.Equal(Plaintext, decrypted);
    }

    [Fact]
    public void SM2Decrypt_CipherIncludesPointPrefix_ReturnsOriginalPassword()
    {
        string ciphertext = "04" + CipherWithoutPointPrefix;

        string decrypted = GMUtil.SM2Decrypt(PrivateScalar, ciphertext);

        Assert.Equal(Plaintext, decrypted);
    }

    [Fact]
    public void SM2Decrypt_UppercaseFrontendCipher_ReturnsOriginalPassword()
    {
        string ciphertext = CipherWithoutPointPrefix.ToUpperInvariant();

        string decrypted = GMUtil.SM2Decrypt(PrivateScalar, ciphertext);

        Assert.Equal(Plaintext, decrypted);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public void SM2Decrypt_TamperedCipher_RejectsWithoutReturningPlaintext(bool includePointPrefix)
    {
        string valid = (includePointPrefix ? "04" : "") + CipherWithoutPointPrefix;
        string ciphertext = valid[..^1] + (valid[^1] == '0' ? "1" : "0");

        Assert.ThrowsAny<Exception>(() => GMUtil.SM2Decrypt(PrivateScalar, ciphertext));
    }
}
