// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core;

/// <summary>
/// CI/CD 配置选项
/// </summary>
public class CDConfigOptions : IConfigurableOptions
{
    /// <summary>
    /// 是否启用
    /// </summary>
    public bool Enabled { get; set; }

    /// <summary>
    /// 用户名
    /// </summary>
    public string Owner { get; set; }

    /// <summary>
    /// 仓库名
    /// </summary>
    public string Repo { get; set; }

    /// <summary>
    /// 分支名
    /// </summary>
    public string Branch { get; set; }

    /// <summary>
    /// 用户授权码
    /// </summary>
    public string AccessToken { get; set; }

    /// <summary>
    /// 更新间隔限制（分钟）0 不限制
    /// </summary>
    public int UpdateInterval { get; set; }

    /// <summary>
    /// 保留备份文件的数量, 0 不限制
    /// </summary>
    public int BackupCount { get; set; }

    /// <summary>
    /// 输出目录配置
    /// </summary>
    public string BackendOutput { get; set; }

    /// <summary>
    /// 明确授权的隔离部署根目录；空值时禁止更新与还原
    /// </summary>
    public string AllowedDeploymentRoot { get; set; }

    /// <summary>
    /// 与授权根目录标识文件一致的部署标识
    /// </summary>
    public string DeploymentId { get; set; }

    /// <summary>
    /// 展示用部署名称，不返回服务器物理路径
    /// </summary>
    public string DeploymentName { get; set; } = "隔离更新部署";

    /// <summary>
    /// 可选的已授权数字 IP 仓库 ZIP 地址；空值沿用 Gitee 仓库来源
    /// </summary>
    public string RepositoryArchiveUrl { get; set; }

    /// <summary>
    /// 发布命令超时秒数
    /// </summary>
    public int PublishTimeoutSeconds { get; set; } = 300;

    /// <summary>
    /// 发布配置选项
    /// </summary>
    public PublishOptions Publish { get; set; }

    /// <summary>
    /// 排除文件列表
    /// </summary>
    public List<string> ExcludeFiles { get; set; }
}

/// <summary>
/// 编译发布配置选项
/// </summary>
public class PublishOptions
{
    /// <summary>
    /// 发布环境配置
    /// </summary>
    public string Configuration { get; set; }

    /// <summary>
    /// 目标框架
    /// </summary>
    public string TargetFramework { get; set; }

    /// <summary>
    /// 运行环境
    /// </summary>
    public string RuntimeIdentifier { get; set; }
}