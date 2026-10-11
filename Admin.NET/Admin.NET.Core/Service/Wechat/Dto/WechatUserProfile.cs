// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 微信用户可维护资料。授权令牌、会话密钥及审计字段不属于管理输入。
/// </summary>
public class WechatUserProfileInput
{
    /// <summary>关联的系统用户；未绑定为 0。</summary>
    [Range(0, long.MaxValue)]
    public long UserId { get; set; }

    public PlatformTypeEnum PlatformType { get; set; } = PlatformTypeEnum.微信公众号;

    [Required, MaxLength(64)]
    public string OpenId { get; set; }

    [MaxLength(64)]
    public string? UnionId { get; set; }

    [MaxLength(64)]
    public string? NickName { get; set; }

    [MaxLength(256)]
    public string? Avatar { get; set; }

    [MaxLength(16)]
    public string? Mobile { get; set; }

    [Range(0, 2)]
    public int? Sex { get; set; }

    [MaxLength(64)]
    public string? Language { get; set; }

    [MaxLength(64)]
    public string? City { get; set; }

    [MaxLength(64)]
    public string? Province { get; set; }

    [MaxLength(64)]
    public string? Country { get; set; }
}

/// <summary>更新微信用户资料。</summary>
public class UpdateWechatUserProfileInput : WechatUserProfileInput
{
    [Required, Range(1, long.MaxValue)]
    public long Id { get; set; }
}

/// <summary>管理列表资料，不包含任何登录凭据。</summary>
public class WechatUserProfileOutput : WechatUserProfileInput
{
    public long Id { get; set; }

    /// <summary>由关联的系统用户解析，仅用于展示，不接受客户端归属声明。</summary>
    public long? TenantId { get; set; }
}
