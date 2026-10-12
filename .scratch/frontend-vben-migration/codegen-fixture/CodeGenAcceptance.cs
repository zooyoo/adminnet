// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using SqlSugar;

namespace Admin.NET.Application.CodeGenFixture;

/// <summary>仅编入随机隔离验收宿主的代表实体。</summary>
[SugarTable("codegen_acceptance", "代码生成真实验收")]
public class CodeGenAcceptance : EntityBaseTenant
{
    [SugarColumn(ColumnDescription = "名称", Length = 64)]
    public string Name { get; set; }

    [SugarColumn(ColumnDescription = "金额", Length = 18, DecimalDigits = 2)]
    public decimal Amount { get; set; }

    [SugarColumn(ColumnDescription = "是否启用")]
    public bool Enabled { get; set; }

    [SugarColumn(ColumnDescription = "发生时间")]
    public DateTime OccurredAt { get; set; }

    [SugarColumn(ColumnDescription = "备注", ColumnDataType = "text", IsNullable = true)]
    public string Notes { get; set; }

    [SugarColumn(ColumnDescription = "状态")]
    public StatusEnum Status { get; set; } = StatusEnum.Enable;

    [SugarColumn(ColumnDescription = "所属机构", IsNullable = true)]
    public long? LinkedOrgId { get; set; }

    [SugarColumn(ColumnDescription = "附件", Length = 512, IsNullable = true)]
    public string Attachment { get; set; }
}
