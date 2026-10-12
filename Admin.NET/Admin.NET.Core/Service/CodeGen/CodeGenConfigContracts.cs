// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 代码生成字段的保存校验与同步映射。
/// </summary>
public static class CodeGenConfigContracts
{
    // 与现有代码生成字典及模板使用的值保持一致，不接受任意模板表达式。
    private static readonly HashSet<string> EffectTypes = new(StringComparer.Ordinal)
    {
        "Input", "DictSelector", "ConstSelector", "EnumSelector", "ApiTreeSelector", "ForeignKey",
        "InputNumber", "DatePicker", "InputTextArea", "Upload", "Switch", "Upload_SingleFile", "Editor"
    };

    private static readonly HashSet<string> QueryTypes = new(StringComparer.Ordinal)
    {
        "==", "like", ">", "<", "!=", ">=", "<=", "isNotNull", "~"
    };

    /// <summary>
    /// 获取批量输入唯一的主配置标识。
    /// </summary>
    public static long GetCodeGenId(IReadOnlyList<CodeGenConfig> inputs)
    {
        if (inputs == null || inputs.Count == 0) throw Oops.Oh("字段配置不能为空，请重新加载后保存");
        if (inputs.Any(field => field == null || field.Id <= 0 || field.CodeGenId <= 0))
            throw Oops.Oh("字段配置标识无效，请重新加载后保存");

        var codeGenId = inputs[0].CodeGenId;
        if (inputs.Any(field => field.CodeGenId != codeGenId)) throw Oops.Oh("一次只能保存同一个代码生成配置的字段");
        if (inputs.Select(field => field.Id).Distinct().Count() != inputs.Count) throw Oops.Oh("字段配置存在重复记录，请重新加载后保存");
        return codeGenId;
    }

    /// <summary>
    /// 全批校验后才构造更新数据，原配置与输入均不被修改。
    /// </summary>
    public static List<SysCodeGenConfig> BuildUpdates(SysCodeGen codeGen, IReadOnlyList<CodeGenConfig> inputs, IReadOnlyList<SysCodeGenConfig> existing)
    {
        var codeGenId = GetCodeGenId(inputs);
        if (codeGen == null || codeGen.Id != codeGenId) throw Oops.Oh("代码生成配置不存在，请重新加载后保存");
        if (existing == null || existing.Count != inputs.Count || existing.Any(field => field.CodeGenId != codeGenId))
            throw Oops.Oh("字段配置已变化，请重新加载完整字段列表后保存");

        var existingById = existing.ToDictionary(field => field.Id);
        foreach (var input in inputs)
        {
            if (!existingById.TryGetValue(input.Id, out var original) ||
                !string.Equals(input.ColumnName, original.ColumnName, StringComparison.Ordinal) ||
                !string.Equals(input.PropertyName, original.PropertyName, StringComparison.Ordinal))
                throw Oops.Oh("字段标识与实体字段不匹配或已过期，请重新加载后保存");
            ValidateOptions(input, original);
        }

        var updates = new List<SysCodeGenConfig>(inputs.Count);
        foreach (var input in inputs)
        {
            var field = existingById[input.Id].Adapt<SysCodeGenConfig>();
            field.ColumnComment = input.ColumnComment;
            field.EffectType = input.EffectType;
            field.FkConfigId = input.FkConfigId;
            field.FkEntityName = input.FkEntityName;
            field.FkTableName = input.FkTableName;
            field.FkDisplayColumns = input.FkDisplayColumnList?.Count > 0 ? string.Join(",", input.FkDisplayColumnList) : null;
            field.FkLinkColumnName = input.FkLinkColumnName;
            field.FkColumnNetType = input.FkColumnNetType;
            field.PidColumn = input.PidColumn;
            field.DictTypeCode = input.DictTypeCode;
            field.QueryType = input.QueryType;
            field.WhetherQuery = NormalizeFlag(input.WhetherQuery);
            field.WhetherRetract = NormalizeFlag(input.WhetherRetract);
            field.WhetherRequired = NormalizeFlag(input.WhetherRequired);
            field.WhetherSortable = NormalizeFlag(input.WhetherSortable);
            field.WhetherTable = NormalizeFlag(input.WhetherTable);
            field.WhetherAddUpdate = NormalizeFlag(input.WhetherAddUpdate);
            field.WhetherImport = NormalizeFlag(input.WhetherImport);
            field.OrderNo = input.OrderNo;
            updates.Add(field);
        }
        return updates;
    }

    /// <summary>
    /// 持久化只允许用户选项和更新审计字段，身份与实体元数据不进入 SET 子句。
    /// </summary>
    public static IUpdateable<SysCodeGenConfig> CreateUpdate(ISqlSugarClient db, SysCodeGenConfig field)
    {
        var id = field.Id;
        var codeGenId = field.CodeGenId;
        var columnName = field.ColumnName;
        var propertyName = field.PropertyName;
        return db.Updateable(field).UpdateColumns(row => new
        {
            row.ColumnComment, row.EffectType, row.FkConfigId, row.FkEntityName, row.FkTableName,
            row.FkDisplayColumns, row.FkLinkColumnName, row.FkColumnNetType, row.PidColumn, row.DictTypeCode,
            row.QueryType, row.WhetherQuery, row.WhetherRetract, row.WhetherRequired, row.WhetherSortable,
            row.WhetherTable, row.WhetherAddUpdate, row.WhetherImport, row.OrderNo,
            row.UpdateTime, row.UpdateUserId, row.UpdateUserName
        }).Where(row => row.Id == id && row.CodeGenId == codeGenId && row.ColumnName == columnName && row.PropertyName == propertyName);
    }

    /// <summary>
    /// 以真实实体字段为全集同步；已有字段保留全部用户选项和标识，移除字段不再返回。
    /// </summary>
    public static List<SysCodeGenConfig> BuildSynchronizedFields(IReadOnlyList<ColumnOuput> columns, long codeGenId, IReadOnlyList<SysCodeGenConfig> existing)
    {
        if (codeGenId <= 0) throw Oops.Oh("代码生成配置标识无效");
        if (columns == null || columns.Count == 0) throw Oops.Oh("未找到可生成的实体字段，请检查实体与数据库后重试");
        if (columns.Any(column => column == null || string.IsNullOrWhiteSpace(column.ColumnName) || string.IsNullOrWhiteSpace(column.PropertyName)) ||
            columns.Select(column => column.ColumnName).Distinct(StringComparer.OrdinalIgnoreCase).Count() != columns.Count)
            throw Oops.Oh("实体字段信息不完整或存在重复字段，无法同步");
        if (existing == null || existing.Any(field => field.CodeGenId != codeGenId) ||
            existing.Select(field => field.ColumnName).Distinct(StringComparer.OrdinalIgnoreCase).Count() != existing.Count)
            throw Oops.Oh("历史字段配置不匹配或存在重复字段，无法同步");

        var existingByColumn = existing.ToDictionary(field => field.ColumnName, StringComparer.OrdinalIgnoreCase);
        var fields = new List<SysCodeGenConfig>(columns.Count);
        for (var index = 0; index < columns.Count; index++)
        {
            var column = columns[index];
            var field = CreateDefaultField(column, codeGenId, 100 + index * 10);
            if (existingByColumn.TryGetValue(column.ColumnName, out var original))
            {
                field.Id = original.Id;
                field.CreateTime = original.CreateTime;
                field.CreateUserId = original.CreateUserId;
                field.CreateUserName = original.CreateUserName;
                field.ColumnComment = original.ColumnComment;
                field.EffectType = original.EffectType;
                field.FkConfigId = original.FkConfigId;
                field.FkEntityName = original.FkEntityName;
                field.FkTableName = original.FkTableName;
                field.FkDisplayColumns = original.FkDisplayColumns;
                field.FkLinkColumnName = original.FkLinkColumnName;
                field.FkColumnNetType = original.FkColumnNetType;
                field.PidColumn = original.PidColumn;
                field.DictTypeCode = original.DictTypeCode;
                field.QueryType = original.QueryType;
                field.WhetherQuery = original.WhetherQuery;
                field.WhetherRetract = original.WhetherRetract;
                field.WhetherRequired = original.WhetherRequired;
                field.WhetherSortable = original.WhetherSortable;
                field.WhetherTable = original.WhetherTable;
                field.WhetherAddUpdate = original.WhetherAddUpdate;
                field.WhetherImport = original.WhetherImport;
                field.OrderNo = original.OrderNo;
            }
            fields.Add(field);
        }
        return fields;
    }

    private static SysCodeGenConfig CreateDefaultField(ColumnOuput column, long codeGenId, int orderNo)
    {
        var whetherCommon = CodeGenUtil.IsCommonColumn(column.PropertyName);
        var yesOrNo = column.IsPrimarykey || Convert.ToBoolean(column.ColumnKey) || whetherCommon ? "N" : "Y";
        var field = new SysCodeGenConfig
        {
            CodeGenId = codeGenId,
            ColumnName = column.ColumnName,
            PropertyName = column.PropertyName,
            ColumnLength = column.ColumnLength,
            ColumnComment = column.ColumnComment,
            NetType = column.NetType,
            DataType = column.DataType,
            DefaultValue = column.DefaultValue,
            ColumnKey = column.ColumnKey,
            WhetherCommon = whetherCommon ? "Y" : "N",
            WhetherRetract = "N",
            WhetherSortable = "N",
            WhetherRequired = column.IsNullable || column.IsPrimarykey ? "N" : "Y",
            WhetherQuery = yesOrNo,
            WhetherImport = yesOrNo,
            WhetherAddUpdate = yesOrNo,
            WhetherTable = yesOrNo,
            EffectType = CodeGenUtil.DataTypeToEff(column.NetType),
            QueryType = column.NetType?.TrimEnd('?') switch { "string" => "like", "DateTime" => "~", _ => "==" },
            OrderNo = orderNo
        };
        if (!string.IsNullOrWhiteSpace(column.DictTypeCode))
        {
            field.QueryType = "==";
            field.DictTypeCode = column.DictTypeCode;
            field.EffectType = column.DictTypeCode.EndsWith("Enum", StringComparison.Ordinal) ? "EnumSelector" : "DictSelector";
        }
        return field;
    }

    private static void ValidateOptions(CodeGenConfig input, SysCodeGenConfig original)
    {
        if (!EffectTypes.Contains(input.EffectType ?? "")) throw Oops.Oh($"字段 {original.PropertyName} 的作用类型无效");
        if (!QueryTypes.Contains(input.QueryType ?? "")) throw Oops.Oh($"字段 {original.PropertyName} 的查询方式无效");
        foreach (var flag in new[] { input.WhetherQuery, input.WhetherRetract, input.WhetherRequired, input.WhetherSortable, input.WhetherTable, input.WhetherAddUpdate, input.WhetherImport })
        {
            // 兼容历史未设置的复选框；非空值只能为既有的 Y/N。
            if (flag != null && flag != "" && flag is not ("Y" or "N")) throw Oops.Oh($"字段 {original.PropertyName} 的选项只能为 Y 或 N");
        }
        if (input.OrderNo < 0) throw Oops.Oh($"字段 {original.PropertyName} 的排序不能小于 0");
        CheckLength(input.ColumnComment, 128, "字段描述");
        CheckLength(input.FkConfigId, 20, "外键库标识");
        CheckLength(input.FkEntityName, 64, "外键实体名称");
        CheckLength(input.FkTableName, 128, "外键表名称");
        CheckLength(input.FkLinkColumnName, 64, "外键链接字段");
        CheckLength(input.FkColumnNetType, 64, "外键字段类型");
        CheckLength(input.PidColumn, 128, "父级字段");
        CheckLength(input.DictTypeCode, 64, "字典编码");

        if (input.FkDisplayColumnList?.Count > 0)
        {
            if (input.FkDisplayColumnList.Any(name => !IsIdentifier(name)) || input.FkDisplayColumnList.Distinct(StringComparer.Ordinal).Count() != input.FkDisplayColumnList.Count)
                throw Oops.Oh($"字段 {original.PropertyName} 的外键显示字段无效或重复");
            CheckLength(string.Join(",", input.FkDisplayColumnList), 64, "外键显示字段");
        }
        if (input.EffectType is "DictSelector" or "EnumSelector" or "ConstSelector" && string.IsNullOrWhiteSpace(input.DictTypeCode))
            throw Oops.Oh($"字段 {original.PropertyName} 需要选择字典、枚举或常量");
        if (input.EffectType is "ForeignKey" or "ApiTreeSelector")
        {
            if (!IsTypeName(input.FkEntityName) || !IsIdentifier(input.FkLinkColumnName) || input.FkDisplayColumnList?.Count is not > 0)
                throw Oops.Oh($"字段 {original.PropertyName} 需要完整的外键实体、链接字段和显示字段");
            if (input.EffectType == "ApiTreeSelector" && !IsIdentifier(input.PidColumn))
                throw Oops.Oh($"字段 {original.PropertyName} 需要选择树父级字段");
        }
        if (input.WhetherQuery == "Y")
        {
            var netType = original.NetType?.TrimEnd('?');
            if (input.QueryType == "like" && netType != "string") throw Oops.Oh($"字段 {original.PropertyName} 只有字符串支持模糊查询");
            if (input.QueryType == "~" && netType != "DateTime") throw Oops.Oh($"字段 {original.PropertyName} 只有时间字段支持时间范围查询");
        }
    }

    private static string NormalizeFlag(string flag) => string.IsNullOrEmpty(flag) ? "N" : flag;

    private static bool IsIdentifier(string value) => !string.IsNullOrWhiteSpace(value) && Regex.IsMatch(value, @"^@?[\p{L}_][\p{L}\p{Nd}_]*$");

    private static bool IsTypeName(string value) => !string.IsNullOrWhiteSpace(value) && value.Split('.').All(IsIdentifier);

    private static void CheckLength(string value, int maximum, string name)
    {
        if (value?.Length > maximum) throw Oops.Oh($"{name}不能超过 {maximum} 个字符");
    }
}
