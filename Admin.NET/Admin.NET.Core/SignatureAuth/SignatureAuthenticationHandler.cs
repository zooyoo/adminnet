// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Microsoft.AspNetCore.Authentication;
using System.Security.Claims;
using System.Text.Encodings.Web;

namespace Admin.NET.Core;

/// <summary>
/// Signature 身份验证处理
/// </summary>
public sealed class SignatureAuthenticationHandler : AuthenticationHandler<SignatureAuthenticationOptions>
{
#if NET6_0

    public SignatureAuthenticationHandler(IOptionsMonitor<SignatureAuthenticationOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder,
        ISystemClock clock)
        : base(options, logger, encoder, clock)
    {
    }

#else

    public SignatureAuthenticationHandler(IOptionsMonitor<SignatureAuthenticationOptions> options,
        ILoggerFactory logger,
        UrlEncoder encoder)
        : base(options, logger, encoder)
    {
    }

#endif

    private readonly SysCacheService _sysCacheService = App.GetRequiredService<SysCacheService>();

    private new SignatureAuthenticationEvent Events
    {
        get => (SignatureAuthenticationEvent)base.Events;
        set => base.Events = value;
    }

    /// <summary>
    /// 确保创建的 Event 类型是 DigestEvents
    /// </summary>
    /// <returns></returns>
    protected override Task<object> CreateEventsAsync() => throw new NotImplementedException($"{nameof(SignatureAuthenticationOptions)}.{nameof(SignatureAuthenticationOptions.Events)} 需要提供一个实例");

    protected override async Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        if (!SignatureProtocol.TryGetSingleHeader(Request.Headers, "accessKey", out var accessKey))
            return await AuthenticateResultFailAsync("accessKey 不能为空或重复");
        if (!SignatureProtocol.TryGetSingleHeader(Request.Headers, "timestamp", out var timestamp))
            return await AuthenticateResultFailAsync("timestamp 不能为空或重复");
        if (!SignatureProtocol.TryGetSingleHeader(Request.Headers, "nonce", out var nonce))
            return await AuthenticateResultFailAsync("nonce 不能为空或重复");
        if (!SignatureProtocol.TryGetSingleHeader(Request.Headers, "sign", out var sign))
            return await AuthenticateResultFailAsync("sign 不能为空或重复");
        if (!SignatureProtocol.IsHeaderToken(accessKey, SignatureProtocol.AccessKeyMaxLength) ||
            !SignatureProtocol.IsHeaderToken(nonce, SignatureProtocol.NonceMaxLength))
            return await AuthenticateResultFailAsync("accessKey 或 nonce 无效");
        if (!SignatureProtocol.TryGetTimestamp(timestamp, out var requestTime))
            return await AuthenticateResultFailAsync("timestamp 值不合法");
        var now = DateTimeOffset.UtcNow;
        if (!SignatureProtocol.IsWithinAllowedDrift(requestTime, now, Options.AllowedDateDrift))
            return await AuthenticateResultFailAsync("timestamp 值已超过允许的偏差范围");

        var method = Request.Method.ToUpperInvariant();
        var path = Request.Path.Value;
        if (!SignatureProtocol.IsHttpMethod(method) || !SignatureProtocol.IsPath(path))
            return await AuthenticateResultFailAsync("请求方法或路径无效");
        var getAccessSecretContext = new GetAccessSecretContext(Context, Scheme, Options) { AccessKey = accessKey };
        var accessSecret = await Events.GetAccessSecret(getAccessSecretContext);
        if (string.IsNullOrEmpty(accessSecret)) return await AuthenticateResultFailAsync("accessKey 无效");
        if (!SignatureProtocol.TryValidate(method, path, accessKey, accessSecret, timestamp, nonce, out var error))
            return await AuthenticateResultFailAsync(error);
        if (!SignatureProtocol.VerifySignature(sign, method, path, accessKey, accessSecret, timestamp, nonce))
            return await AuthenticateResultFailAsync("sign 无效的签名");

        var signatureValidatedContext = new SignatureValidatedContext(Context, Scheme, Options)
        {
            Principal = new ClaimsPrincipal(new ClaimsIdentity(Scheme.Name)),
            AccessKey = accessKey,
            AccessSecret = accessSecret
        };
        await Events.Validated(signatureValidatedContext);
        if (signatureValidatedContext.Result != null && !signatureValidatedContext.Result.Succeeded)
        {
            if (signatureValidatedContext.Result.Failure != null)
                return await AuthenticateResultFailAsync(signatureValidatedContext.Result.Failure.Message);
            return signatureValidatedContext.Result;
        }

        // 签名和绑定身份均有效后才消费随机数，失败请求不能占用合法请求的随机数。
        var cacheKey = $"{CacheConst.KeyOpenAccessNonce}{accessKey}|{nonce}";
        var lifetime = SignatureProtocol.GetNonceLifetime(requestTime, now, Options.AllowedDateDrift);
        if (!SignatureReplayGuard.TryRegister(() => _sysCacheService.ExistKey(cacheKey),
            () => _sysCacheService.Set(cacheKey, true, lifetime)))
            return await AuthenticateResultFailAsync("重复的请求");
        if (signatureValidatedContext.Result == null) signatureValidatedContext.Success();
        return signatureValidatedContext.Result;
    }

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var authResult = await HandleAuthenticateOnceSafeAsync();
        var challengeContext = new SignatureChallengeContext(Context, Scheme, Options, properties)
        {
            AuthenticateFailure = authResult.Failure,
        };
        await Events.Challenge(challengeContext);
        // 质询已处理
        if (challengeContext.Handled) return;

        await base.HandleChallengeAsync(properties);
    }

    /// <summary>
    /// 返回验证失败结果，并在 Items 中增加 <see cref="SignatureAuthenticationDefaults.AuthenticateFailMsgKey"/>，记录身份验证失败消息
    /// </summary>
    /// <param name="message"></param>
    /// <returns></returns>
    private Task<AuthenticateResult> AuthenticateResultFailAsync(string message)
    {
        // 写入身份验证失败消息
        Context.Items[SignatureAuthenticationDefaults.AuthenticateFailMsgKey] = message;
        return Task.FromResult(AuthenticateResult.Fail(message));
    }
}