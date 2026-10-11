// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Xunit;

namespace Admin.NET.Test.Wechat;

public class WechatUserContractTests
{
    [Fact]
    public void Apply_ProfileUpdate_PreservesCredentialsAndClearsOptionalValues()
    {
        var entity = new SysWechatUser { Id = 42, OpenId = "old", SessionKey = "session-fixture", AccessToken = "access-fixture", RefreshToken = "refresh-fixture", Scope = "scope", ExpiresIn = 7200, City = "old" };
        WechatUserContracts.Apply(new WechatUserProfileInput { OpenId = "new", NickName = "资料", UserId = 7 }, entity);
        Assert.Equal(42, entity.Id);
        Assert.Equal("new", entity.OpenId);
        Assert.Null(entity.City);
        Assert.Equal("session-fixture", entity.SessionKey);
        Assert.Equal("access-fixture", entity.AccessToken);
        Assert.Equal("refresh-fixture", entity.RefreshToken);
        Assert.Equal("scope", entity.Scope);
        Assert.Equal(7200, entity.ExpiresIn);
    }

    [Theory]
    [InlineData(null)]
    [InlineData(0L)]
    [InlineData(2L)]
    public void RequireAccessible_ForeignOrUnbound_Rejects(long? owner)
    {
        Assert.ThrowsAny<Exception>(() => WechatUserContracts.RequireAccessible(false, 1, owner));
    }

    [Fact]
    public void RequireAccessible_OwnerOrSuperAdmin_Allows()
    {
        WechatUserContracts.RequireAccessible(false, 1, 1);
        WechatUserContracts.RequireAccessible(true, 0, null);
        Assert.ThrowsAny<Exception>(() => WechatUserContracts.RequireAccessible(false, 0, 0));
    }

    [Theory]
    [InlineData("javascript:alert(1)")]
    [InlineData("//external.test/a.png")]
    [InlineData("/\\external.test/a.png")]
    public void Validate_UnsafeAvatar_Rejects(string avatar)
    {
        Assert.ThrowsAny<Exception>(() => WechatUserContracts.Validate(new WechatUserProfileInput { OpenId = "fixture", Avatar = avatar }));
    }

    [Theory]
    [InlineData("/images/avatar.png")]
    [InlineData("https://example.test/avatar.png")]
    public void Validate_SupportedAvatar_Allows(string avatar)
    {
        WechatUserContracts.Validate(new WechatUserProfileInput { OpenId = "fixture", Avatar = avatar });
    }

    [Fact]
    public void Validate_InvalidPlatform_Rejects()
    {
        Assert.ThrowsAny<Exception>(() => WechatUserContracts.Validate(new WechatUserProfileInput { OpenId = "fixture", PlatformType = (PlatformTypeEnum)99 }));
    }
}
