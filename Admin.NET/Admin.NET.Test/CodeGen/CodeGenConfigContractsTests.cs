// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using SqlSugar;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public class CodeGenConfigContractsTests
{
    [Fact]
    public void BuildUpdates_ValidBatch_PreservesMetadataAndChangesOnlyUserOptions()
    {
        // Arrange
        var original = CreateExisting();
        original.ColumnLength = 64;
        original.ColumnKey = "True";
        original.WhetherCommon = "Y";
        original.DefaultValue = "database-default";
        var input = CreateInput();
        input.ColumnComment = "用户描述";
        input.ColumnLength = 9999;
        input.ColumnKey = "False";
        input.WhetherCommon = "N";
        input.NetType = "injected-type";
        input.DataType = "injected-data-type";
        input.DefaultValue = "injected-default";
        input.FkDisplayColumnList = new List<string> { "Name", "Code" };

        // Act
        var saved = Assert.Single(CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { original }));

        // Assert
        Assert.NotSame(original, saved);
        Assert.Equal(original.Id, saved.Id);
        Assert.Equal(original.CodeGenId, saved.CodeGenId);
        Assert.Equal(original.ColumnName, saved.ColumnName);
        Assert.Equal(original.PropertyName, saved.PropertyName);
        Assert.Equal(64, saved.ColumnLength);
        Assert.Equal("True", saved.ColumnKey);
        Assert.Equal("Y", saved.WhetherCommon);
        Assert.Equal("string", saved.NetType);
        Assert.Equal("varchar", saved.DataType);
        Assert.Equal("database-default", saved.DefaultValue);
        Assert.Equal("用户描述", saved.ColumnComment);
        Assert.Equal("Name,Code", saved.FkDisplayColumns);
        Assert.Equal("原描述", original.ColumnComment);
        Assert.Null(input.FkDisplayColumns);
    }

    [Fact]
    public void BuildUpdates_InvalidLastField_DoesNotMutateEarlierFieldsOrInputs()
    {
        // Arrange
        var originals = new[] { CreateExisting(), CreateExisting(42, "Age") };
        var first = CreateInput();
        first.ColumnComment = "未保存的编辑";
        first.FkDisplayColumnList = new List<string> { "Name" };
        var last = CreateInput(42, "Age");
        last.QueryType = "invalid-expression";

        // Act
        var error = Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { first, last }, originals));

        // Assert
        Assert.Contains("查询方式无效", error.Message);
        Assert.All(originals, field => Assert.Equal("原描述", field.ColumnComment));
        Assert.Null(originals[0].FkDisplayColumns);
        Assert.Null(first.FkDisplayColumns);
        Assert.Equal("未保存的编辑", first.ColumnComment);
    }

    [Theory]
    [InlineData("stale-id")]
    [InlineData("column-mismatch")]
    [InlineData("property-mismatch")]
    [InlineData("parent-mismatch")]
    public void BuildUpdates_MismatchedIdentity_RejectsEntireBatch(string scenario)
    {
        // Arrange
        var input = CreateInput();
        switch (scenario)
        {
            case "stale-id": input.Id = 999; break;
            case "column-mismatch": input.ColumnName = "another_column"; break;
            case "property-mismatch": input.PropertyName = "AnotherProperty"; break;
            case "parent-mismatch": input.CodeGenId = 8; break;
        }

        // Act / Assert
        Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { CreateExisting() }));
    }

    [Fact]
    public void BuildUpdates_MissingCurrentField_RejectsIncompleteList()
    {
        // Arrange
        var existing = new[] { CreateExisting(), CreateExisting(42, "Age") };

        // Act / Assert
        var error = Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { CreateInput() }, existing));
        Assert.Contains("完整字段列表", error.Message);
    }

    [Fact]
    public void BuildUpdates_DeletedMaster_RejectsReadableError()
    {
        // Act / Assert
        var error = Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(null, new[] { CreateInput() }, new[] { CreateExisting() }));
        Assert.Contains("代码生成配置不存在", error.Message);
    }

    [Theory]
    [InlineData("duplicate")]
    [InlineData("mixed-parent")]
    [InlineData("null-field")]
    [InlineData("empty")]
    public void GetCodeGenId_InvalidBatch_Rejects(string scenario)
    {
        // Arrange
        var inputs = new List<CodeGenConfig> { CreateInput(), CreateInput(42, "Age") };
        switch (scenario)
        {
            case "duplicate": inputs[1].Id = inputs[0].Id; break;
            case "mixed-parent": inputs[1].CodeGenId = 8; break;
            case "null-field": inputs[1] = null; break;
            case "empty": inputs.Clear(); break;
        }

        // Act / Assert
        Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.GetCodeGenId(inputs));
    }

    [Theory]
    [InlineData("Input")]
    [InlineData("DictSelector")]
    [InlineData("ConstSelector")]
    [InlineData("EnumSelector")]
    [InlineData("ApiTreeSelector")]
    [InlineData("ForeignKey")]
    [InlineData("InputNumber")]
    [InlineData("DatePicker")]
    [InlineData("InputTextArea")]
    [InlineData("Upload")]
    [InlineData("Switch")]
    [InlineData("Upload_SingleFile")]
    [InlineData("Editor")]
    public void BuildUpdates_ExistingEffectType_Allows(string effectType)
    {
        // Arrange
        var input = CreateInput();
        input.EffectType = effectType;
        input.DictTypeCode = "StatusEnum";
        input.FkEntityName = "SysOrg";
        input.FkLinkColumnName = "Id";
        input.FkDisplayColumnList = new List<string> { "Name" };
        input.PidColumn = "Pid";

        // Act / Assert
        var saved = Assert.Single(CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { CreateExisting() }));
        Assert.Equal(effectType, saved.EffectType);
    }

    [Theory]
    [InlineData("==")]
    [InlineData("like")]
    [InlineData(">")]
    [InlineData("<")]
    [InlineData("!=")]
    [InlineData(">=")]
    [InlineData("<=")]
    [InlineData("isNotNull")]
    [InlineData("~")]
    public void BuildUpdates_ExistingQueryType_Allows(string queryType)
    {
        // Arrange
        var input = CreateInput();
        input.QueryType = queryType;
        var existing = CreateExisting();
        if (queryType == "~") existing.NetType = "DateTime?";

        // Act / Assert
        var saved = Assert.Single(CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { existing }));
        Assert.Equal(queryType, saved.QueryType);
    }

    [Theory]
    [InlineData(nameof(CodeGenConfig.WhetherQuery))]
    [InlineData(nameof(CodeGenConfig.WhetherRetract))]
    [InlineData(nameof(CodeGenConfig.WhetherRequired))]
    [InlineData(nameof(CodeGenConfig.WhetherSortable))]
    [InlineData(nameof(CodeGenConfig.WhetherTable))]
    [InlineData(nameof(CodeGenConfig.WhetherAddUpdate))]
    [InlineData(nameof(CodeGenConfig.WhetherImport))]
    public void BuildUpdates_InvalidFlag_Rejects(string property)
    {
        // Arrange
        var input = CreateInput();
        typeof(CodeGenConfig).GetProperty(property)!.SetValue(input, "true");

        // Act / Assert
        var error = Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { CreateExisting() }));
        Assert.Contains("Y 或 N", error.Message);
    }

    [Fact]
    public void BuildUpdates_UnsetLegacyFlags_NormalizesToNo()
    {
        // Arrange
        var input = CreateInput();
        input.WhetherSortable = null;
        input.WhetherRetract = "";

        // Act
        var saved = Assert.Single(CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { CreateExisting() }));

        // Assert
        Assert.Equal("N", saved.WhetherSortable);
        Assert.Equal("N", saved.WhetherRetract);
    }

    [Theory]
    [InlineData(nameof(CodeGenConfig.ColumnComment), 129)]
    [InlineData(nameof(CodeGenConfig.FkConfigId), 21)]
    [InlineData(nameof(CodeGenConfig.FkEntityName), 65)]
    [InlineData(nameof(CodeGenConfig.FkTableName), 129)]
    [InlineData(nameof(CodeGenConfig.FkLinkColumnName), 65)]
    [InlineData(nameof(CodeGenConfig.FkColumnNetType), 65)]
    [InlineData(nameof(CodeGenConfig.PidColumn), 129)]
    [InlineData(nameof(CodeGenConfig.DictTypeCode), 65)]
    public void BuildUpdates_OverlongOption_RejectsBeforePersistence(string property, int length)
    {
        // Arrange
        var input = CreateInput();
        typeof(CodeGenConfig).GetProperty(property)!.SetValue(input, new string('x', length));

        // Act / Assert
        var error = Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { CreateExisting() }));
        Assert.Contains("不能超过", error.Message);
    }

    [Theory]
    [InlineData("effect")]
    [InlineData("negative-order")]
    [InlineData("non-string-like")]
    [InlineData("non-time-range")]
    [InlineData("missing-dictionary")]
    public void BuildUpdates_InvalidOptionCombination_Rejects(string scenario)
    {
        // Arrange
        var input = CreateInput();
        var original = CreateExisting();
        switch (scenario)
        {
            case "effect": input.EffectType = "CustomUnimplemented"; break;
            case "negative-order": input.OrderNo = -1; break;
            case "non-string-like": original.NetType = "int"; break;
            case "non-time-range": input.QueryType = "~"; break;
            case "missing-dictionary": input.EffectType = "DictSelector"; break;
        }

        // Act / Assert
        Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { original }));
    }

    [Theory]
    [InlineData("entity")]
    [InlineData("link")]
    [InlineData("display")]
    [InlineData("duplicate-display")]
    [InlineData("empty-display")]
    [InlineData("tree-parent")]
    public void BuildUpdates_IncompleteSelector_RejectsConsumedTemplateFields(string scenario)
    {
        // Arrange
        var input = CreateInput();
        input.EffectType = "ForeignKey";
        input.FkEntityName = "SysOrg";
        input.FkLinkColumnName = "Id";
        input.FkDisplayColumnList = new List<string> { "Name" };
        switch (scenario)
        {
            case "entity": input.FkEntityName = ""; break;
            case "link": input.FkLinkColumnName = ""; break;
            case "display": input.FkDisplayColumnList = null; break;
            case "duplicate-display": input.FkDisplayColumnList.Add("Name"); break;
            case "empty-display": input.FkDisplayColumnList.Add(""); break;
            case "tree-parent": input.EffectType = "ApiTreeSelector"; input.PidColumn = ""; break;
        }

        // Act / Assert
        Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildUpdates(new SysCodeGen { Id = 7 }, new[] { input }, new[] { CreateExisting() }));
    }

    [Fact]
    public void BuildSynchronizedFields_CustomOptions_PreservesAllOptionsAndRefreshesMetadata()
    {
        // Arrange
        var original = CreateExisting();
        original.EffectType = "ApiTreeSelector";
        original.ColumnComment = "自定义字段描述";
        original.FkConfigId = "main";
        original.FkEntityName = "SysOrg";
        original.FkTableName = "sys_org";
        original.FkDisplayColumns = "Name,Code";
        original.FkLinkColumnName = "Id";
        original.FkColumnNetType = "long";
        original.PidColumn = "Pid";
        original.DictTypeCode = "custom-dictionary";
        original.QueryType = ">=";
        original.WhetherQuery = "N";
        original.WhetherRetract = "Y";
        original.WhetherRequired = "N";
        original.WhetherSortable = "Y";
        original.WhetherTable = "N";
        original.WhetherAddUpdate = "N";
        original.WhetherImport = "N";
        original.OrderNo = 765;
        var column = CreateColumn("Name", "RenamedProperty", "int");
        column.ColumnLength = 500;
        column.ColumnKey = "True";
        column.IsPrimarykey = true;
        column.DataType = "integer";
        column.DictTypeCode = "NewEntityEnum";
        column.DefaultValue = "entity-default";

        // Act
        var field = Assert.Single(CodeGenConfigContracts.BuildSynchronizedFields(new[] { column }, 7, new[] { original }));

        // Assert
        Assert.Equal(41, field.Id);
        Assert.Equal("RenamedProperty", field.PropertyName);
        Assert.Equal(500, field.ColumnLength);
        Assert.Equal("True", field.ColumnKey);
        Assert.Equal("int", field.NetType);
        Assert.Equal("integer", field.DataType);
        Assert.Equal("entity-default", field.DefaultValue);
        Assert.Equal(original.ColumnComment, field.ColumnComment);
        Assert.Equal(original.EffectType, field.EffectType);
        Assert.Equal(original.FkConfigId, field.FkConfigId);
        Assert.Equal(original.FkEntityName, field.FkEntityName);
        Assert.Equal(original.FkTableName, field.FkTableName);
        Assert.Equal(original.FkDisplayColumns, field.FkDisplayColumns);
        Assert.Equal(original.FkLinkColumnName, field.FkLinkColumnName);
        Assert.Equal(original.FkColumnNetType, field.FkColumnNetType);
        Assert.Equal(original.PidColumn, field.PidColumn);
        Assert.Equal(original.DictTypeCode, field.DictTypeCode);
        Assert.Equal(original.QueryType, field.QueryType);
        Assert.Equal(original.WhetherQuery, field.WhetherQuery);
        Assert.Equal(original.WhetherRetract, field.WhetherRetract);
        Assert.Equal(original.WhetherRequired, field.WhetherRequired);
        Assert.Equal(original.WhetherSortable, field.WhetherSortable);
        Assert.Equal(original.WhetherTable, field.WhetherTable);
        Assert.Equal(original.WhetherAddUpdate, field.WhetherAddUpdate);
        Assert.Equal(original.WhetherImport, field.WhetherImport);
        Assert.Equal(765, field.OrderNo);
        Assert.Equal("Name", original.PropertyName);
    }

    [Fact]
    public void BuildSynchronizedFields_AddedAndRemovedFields_ReturnsOnlyActualColumns()
    {
        // Arrange
        var originals = new[] { CreateExisting(), CreateExisting(42, "Removed") };
        var columns = new[] { CreateColumn("name", "Name", "string"), CreateColumn("Count", "Count", "int?") };
        columns[1].IsNullable = true;

        // Act
        var fields = CodeGenConfigContracts.BuildSynchronizedFields(columns, 7, originals);

        // Assert
        Assert.Equal(2, fields.Count);
        Assert.Equal(41, fields[0].Id);
        Assert.Equal("name", fields[0].ColumnName);
        Assert.DoesNotContain(fields, field => field.ColumnName == "Removed");
        Assert.Equal(0, fields[1].Id);
        Assert.Equal("InputNumber", fields[1].EffectType);
        Assert.Equal("==", fields[1].QueryType);
        Assert.Equal("Y", fields[1].WhetherAddUpdate);
        Assert.Equal("N", fields[1].WhetherRequired);
        Assert.Equal(110, fields[1].OrderNo);
    }

    [Fact]
    public void BuildSynchronizedFields_NewSpecialFields_AppliesOriginalDefaults()
    {
        // Arrange
        var id = CreateColumn("Id", "Id", "long");
        id.ColumnKey = "True";
        id.IsPrimarykey = true;
        var createTime = CreateColumn("create_time", "CreateTime", "DateTime");
        var status = CreateColumn("Status", "Status", "int");
        status.DictTypeCode = "StatusEnum";

        // Act
        var fields = CodeGenConfigContracts.BuildSynchronizedFields(new[] { id, createTime, status }, 7, Array.Empty<SysCodeGenConfig>());

        // Assert
        Assert.Equal("N", fields[0].WhetherRequired);
        Assert.Equal("N", fields[0].WhetherAddUpdate);
        Assert.Equal("Y", fields[1].WhetherCommon);
        Assert.Equal("N", fields[1].WhetherQuery);
        Assert.Equal("DatePicker", fields[1].EffectType);
        Assert.Equal("~", fields[1].QueryType);
        Assert.Equal("EnumSelector", fields[2].EffectType);
        Assert.Equal("StatusEnum", fields[2].DictTypeCode);
        Assert.Equal("==", fields[2].QueryType);
    }

    [Fact]
    public void BuildSynchronizedFields_InvalidEntityMetadata_DoesNotMutateOriginals()
    {
        // Arrange
        var original = CreateExisting();
        var columns = new[] { CreateColumn("Name", "Name", "string"), CreateColumn("Name", "Duplicate", "string") };

        // Act / Assert
        Assert.ThrowsAny<Exception>(() => CodeGenConfigContracts.BuildSynchronizedFields(columns, 7, new[] { original }));
        Assert.Equal("原描述", original.ColumnComment);
        Assert.Equal(41, original.Id);
    }

    [Fact]
    public void CreateUpdate_PostgreSqlStatement_ContainsOnlyEditableColumnsAndIdentityConditions()
    {
        // Arrange：只生成 PostgreSQL SQL，不建立连接或写数据库。
        using var db = new SqlSugarClient(new ConnectionConfig
        {
            DbType = DbType.PostgreSQL,
            ConnectionString = "Host=localhost;Database=unused;Username=fixture;Password=fixture",
            IsAutoCloseConnection = true
        });
        var field = CreateExisting();
        field.EffectType = "Input";
        field.QueryType = "like";

        // Act
        var sql = CodeGenConfigContracts.CreateUpdate(db, field).ToSql().Key;
        var whereIndex = sql.IndexOf("WHERE", StringComparison.OrdinalIgnoreCase);
        Assert.True(whereIndex > 0);
        var setClause = sql[..whereIndex];
        var whereClause = sql[whereIndex..];

        // Assert
        foreach (var name in new[] { "Id", "CodeGenId", "ColumnName", "PropertyName", "ColumnLength", "ColumnKey", "WhetherCommon", "NetType", "DataType", "DefaultValue", "CreateTime", "CreateUserId", "CreateUserName" })
            Assert.DoesNotContain($"\"{name}\"", setClause, StringComparison.OrdinalIgnoreCase);
        foreach (var name in new[] { "ColumnComment", "EffectType", "FkConfigId", "FkEntityName", "FkTableName", "FkDisplayColumns", "FkLinkColumnName", "FkColumnNetType", "PidColumn", "DictTypeCode", "QueryType", "WhetherQuery", "WhetherRetract", "WhetherRequired", "WhetherSortable", "WhetherTable", "WhetherAddUpdate", "WhetherImport", "OrderNo", "UpdateTime", "UpdateUserId", "UpdateUserName" })
            Assert.Contains($"\"{name}\"", setClause, StringComparison.OrdinalIgnoreCase);
        foreach (var name in new[] { "Id", "CodeGenId", "ColumnName", "PropertyName" })
            Assert.Contains($"\"{name}\"", whereClause, StringComparison.OrdinalIgnoreCase);
    }

    private static SysCodeGenConfig CreateExisting(long id = 41, string name = "Name") => new()
    {
        Id = id,
        CodeGenId = 7,
        ColumnName = name,
        PropertyName = name,
        ColumnComment = "原描述",
        ColumnKey = "False",
        NetType = "string",
        DataType = "varchar",
        EffectType = "Input",
        QueryType = "like",
        WhetherQuery = "Y",
        WhetherRetract = "N",
        WhetherRequired = "Y",
        WhetherSortable = "N",
        WhetherTable = "Y",
        WhetherAddUpdate = "Y",
        WhetherImport = "Y",
        WhetherCommon = "N"
    };

    private static CodeGenConfig CreateInput(long id = 41, string name = "Name") => new()
    {
        Id = id,
        CodeGenId = 7,
        ColumnName = name,
        PropertyName = name,
        ColumnComment = "原描述",
        EffectType = "Input",
        QueryType = "like",
        WhetherQuery = "Y",
        WhetherRetract = "N",
        WhetherRequired = "Y",
        WhetherSortable = "N",
        WhetherTable = "Y",
        WhetherAddUpdate = "Y",
        WhetherImport = "Y",
        OrderNo = 100
    };

    private static ColumnOuput CreateColumn(string columnName, string propertyName, string netType) => new()
    {
        ColumnName = columnName,
        PropertyName = propertyName,
        ColumnKey = "False",
        NetType = netType,
        ColumnComment = "实体描述"
    };
}
