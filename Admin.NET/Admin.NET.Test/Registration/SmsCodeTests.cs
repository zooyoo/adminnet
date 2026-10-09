// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.Extensions.Options;
using NewLife.Caching;
using Xunit;

namespace Admin.NET.Test.Registration;

public class SmsCodeTests : IDisposable
{
    private readonly MemoryCache _memory = new();
    private readonly SysCacheService _cache;
    private readonly SysSmsService _sms;
    private const string Phone = "13900000001";
    private const string Code = "123456";
    private static string Key => $"{CacheConst.KeyPhoneVerCode}{Phone}";

    public SmsCodeTests()
    {
        _cache = new SysCacheService(new CacheProvider { Cache = _memory }, Options.Create(new CacheOptions { Prefix = $"sms-test:{Guid.NewGuid():N}:" }));
        _sms = new SysSmsService(Options.Create(new SMSOptions()), _cache);
    }

    [Fact]
    public void ConsumeCode_ValidCode_RemovesCodeAndRejectsReplay()
    {
        _cache.Set(Key, Code);
        _sms.ConsumeCode(new SmsVerifyCodeInput { Phone = Phone, Code = Code });
        Assert.False(_cache.ExistKey(Key));
        Assert.ThrowsAny<Exception>(() => _sms.ConsumeCode(new SmsVerifyCodeInput { Phone = Phone, Code = Code }));
    }

    [Fact]
    public void VerifyCode_ValidCode_PreservesExistingValidationContract()
    {
        _cache.Set(Key, Code);
        Assert.True(_sms.VerifyCode(new SmsVerifyCodeInput { Phone = Phone, Code = Code }));
        Assert.Equal(Code, _cache.Get<string>(Key));
    }

    [Fact]
    public void ConsumeCode_FiveWrongAttempts_InvalidatesCode()
    {
        _cache.Set(Key, Code);
        for (int index = 0; index < 5; index++)
            Assert.ThrowsAny<Exception>(() => _sms.ConsumeCode(new SmsVerifyCodeInput { Phone = Phone, Code = "wrong" }));
        Assert.False(_cache.ExistKey(Key));
        Assert.ThrowsAny<Exception>(() => _sms.ConsumeCode(new SmsVerifyCodeInput { Phone = Phone, Code = Code }));
    }

    [Fact]
    public void ConsumeCode_WrongPhone_DoesNotConsumeOtherPhoneCode()
    {
        _cache.Set(Key, Code);
        Assert.ThrowsAny<Exception>(() => _sms.ConsumeCode(new SmsVerifyCodeInput { Phone = "13900000002", Code = Code }));
        Assert.Equal(Code, _cache.Get<string>(Key));
    }

    [Fact]
    public async Task ConsumeCode_ConcurrentRequests_OnlyOneSucceeds()
    {
        _cache.Set(Key, Code);
        Task<bool>[] attempts = Enumerable.Range(0, 5).Select(_ => Task.Run(() =>
        {
            try { _sms.ConsumeCode(new SmsVerifyCodeInput { Phone = Phone, Code = Code }); return true; }
            catch { return false; }
        }, TestContext.Current.CancellationToken)).ToArray();
        Assert.Single((await Task.WhenAll(attempts)).Where(success => success));
        Assert.False(_cache.ExistKey(Key));
    }

    [Fact]
    public async Task SendSms_ExistingCooldown_DoesNotContactGateway()
    {
        _cache.Set($"{Key}:sent", true);
        await Assert.ThrowsAnyAsync<Exception>(() => _sms.CustomSendSms(Phone));
        Assert.True(_cache.ExistKey($"{Key}:sent"));
        Assert.False(_cache.ExistKey(Key));
    }

    public void Dispose() => _memory.Dispose();
}
