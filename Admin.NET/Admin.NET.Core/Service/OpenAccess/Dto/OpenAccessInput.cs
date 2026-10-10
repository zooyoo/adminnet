// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 开放接口分页查询
/// </summary>
public class OpenAccessInput : BasePageInput
{
    [MaxLength(SignatureProtocol.AccessKeyMaxLength)]
    public string AccessKey { get; set; }
}

/// <summary>
/// 新增开放接口凭据，仅接收凭据和绑定字段
/// </summary>
public class AddOpenAccessInput
{
    public virtual long Id { get; set; }

    [Required(ErrorMessage = "访问标识不能为空")]
    [MaxLength(SignatureProtocol.AccessKeyMaxLength)]
    public string AccessKey { get; set; }

    [Required(ErrorMessage = "访问密钥不能为空")]
    [MaxLength(SignatureProtocol.AccessSecretMaxLength)]
    public string AccessSecret { get; set; }

    [Range(1, long.MaxValue, ErrorMessage = "请选择绑定租户")]
    public long BindTenantId { get; set; }

    [Range(1, long.MaxValue, ErrorMessage = "请选择绑定用户")]
    public long BindUserId { get; set; }
}

/// <summary>
/// 更新开放接口凭据
/// </summary>
public class UpdateOpenAccessInput : AddOpenAccessInput
{
    [Range(1, long.MaxValue, ErrorMessage = "凭据标识无效")]
    public override long Id { get; set; }
}

/// <summary>
/// 删除开放接口凭据
/// </summary>
public class DeleteOpenAccessInput : BaseIdInput
{
}

/// <summary>
/// 查询某租户下可绑定用户
/// </summary>
public class OpenAccessUserListInput
{
    [Range(1, long.MaxValue, ErrorMessage = "请选择租户")]
    public long TenantId { get; set; }
}

/// <summary>
/// 生成开放接口签名
/// </summary>
public class GenerateSignatureInput
{
    [Required(ErrorMessage = "访问标识不能为空")]
    [MaxLength(SignatureProtocol.AccessKeyMaxLength)]
    public string AccessKey { get; set; }

    [Required(ErrorMessage = "访问密钥不能为空")]
    [MaxLength(SignatureProtocol.AccessSecretMaxLength)]
    public string AccessSecret { get; set; }

    public HttpMethodEnum Method { get; set; }

    [Required(ErrorMessage = "请求路径不能为空")]
    [MaxLength(SignatureProtocol.PathMaxLength)]
    public string Url { get; set; }

    public long Timestamp { get; set; }

    [Required(ErrorMessage = "随机数不能为空")]
    [MaxLength(SignatureProtocol.NonceMaxLength)]
    public string Nonce { get; set; }
}
