// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Npgsql;
using System.Globalization;
using System.Security.Cryptography;

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统数据库管理服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 250)]
public class SysDatabaseService : IDynamicApiController, ITransient
{
    private readonly ISqlSugarClient _db;
    private readonly IViewEngine _viewEngine;
    private readonly CodeGenOptions _codeGenOptions;
    private static readonly object GenerationWriteLock = new();

    public SysDatabaseService(ISqlSugarClient db,
        IViewEngine viewEngine,
        IOptions<CodeGenOptions> codeGenOptions)
    {
        _db = db;
        _viewEngine = viewEngine;
        _codeGenOptions = codeGenOptions.Value;
    }

    /// <summary>
    /// 获取库列表 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取库列表")]
    public List<VisualDb> GetList()
    {
        return App.GetOptions<DbConnectionOptions>().ConnectionConfigs.Select(u => new VisualDb
        {
            ConfigId = u.ConfigId.ToString(), DbNickName = u.DbNickName,
            DbType = u.DbType.ToString(), CanMoveColumn = u.DbType == SqlSugar.DbType.MySql
        }).ToList();
    }

    /// <summary>
    /// 获取指定数据库的真实库表结构关系图 🔖
    /// </summary>
    /// <param name="configId">数据库配置 ID</param>
    /// <param name="tableName">入口选中的表名，用于校验上下文；关系图仍展示所选库的完整结构</param>
    /// <returns></returns>
    [DisplayName("获取可视化库表结构")]
    public VisualDbTable GetVisualDbTable([FromQuery] string configId = SqlSugarConst.MainConfigId, [FromQuery] string tableName = null)
    {
        var db = GetMaintenanceConnection(configId);
        var tables = db.DbMaintenance.GetTableInfoList(false)
            .Where(u => !string.IsNullOrWhiteSpace(u.Name))
            .OrderBy(u => u.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
        if (!string.IsNullOrWhiteSpace(tableName) && !tables.Any(u => u.Name.Equals(tableName, StringComparison.Ordinal)))
            throw Oops.Oh("目标表不存在，请重新选择");

        var visualTableList = new List<VisualTable>(tables.Count);
        var visualColumnList = new List<VisualColumn>();
        foreach (var table in tables.Select((value, index) => new { value, index }))
        {
            var columns = db.DbMaintenance.GetColumnInfosByTableName(table.value.Name, false);
            visualTableList.Add(new VisualTable
            {
                TableName = table.value.Name,
                TableComents = string.IsNullOrWhiteSpace(table.value.Description) ? table.value.Name : table.value.Description,
                X = (table.index % 4) * 420,
                Y = (table.index / 4) * 300,
            });
            visualColumnList.AddRange(columns.Select(column => new VisualColumn
            {
                TableName = table.value.Name,
                ColumnName = column.DbColumnName,
                DataType = column.DataType,
                DataLength = column.Length > 0 ? column.Length.ToString() : string.Empty,
                ColumnDescription = column.ColumnDescription,
            }));
        }

        var columnRelationList = db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL
            ? GetPostgreSqlRelations(db)
            : new List<ColumnRelation>();
        return new VisualDbTable { VisualTableList = visualTableList, VisualColumnList = visualColumnList, ColumnRelationList = columnRelationList };
    }

    /// <summary>
    /// 获取字段列表 🔖
    /// </summary>
    /// <param name="tableName">表名</param>
    /// <param name="configId">ConfigId</param>
    /// <returns></returns>
    [DisplayName("获取字段列表")]
    public List<DbColumnOutput> GetColumnList(string tableName, string configId = SqlSugarConst.MainConfigId)
    {
        var db = GetMaintenanceConnection(configId);
        EnsureTable(db, tableName);
        return db.DbMaintenance.GetColumnInfosByTableName(tableName, false).Adapt<List<DbColumnOutput>>();
    }

    /// <summary>
    /// 获取数据库数据类型列表 🔖
    /// </summary>
    /// <param name="configId"></param>
    /// <returns></returns>
    [DisplayName("获取数据库数据类型列表")]
    public List<string> GetDbTypeList(string configId = SqlSugarConst.MainConfigId)
    {
        var db = GetMaintenanceConnection(configId);
        return db.DbMaintenance.GetDbTypes().OrderBy(u => u).ToList();
    }

    /// <summary>
    /// 增加列 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "AddColumn"), HttpPost]
    [DisplayName("增加列")]
    public void AddColumn(DbColumnInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        EnsureTable(db, input.TableName);
        ValidateColumn(db, input);
        if (db.DbMaintenance.GetColumnInfosByTableName(input.TableName, false).Any(u => u.DbColumnName.Equals(input.DbColumnName, StringComparison.OrdinalIgnoreCase)))
            throw Oops.Oh("字段已存在");
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL)
        {
            RunPgTransaction(db, () =>
            {
                db.Ado.ExecuteCommand($"ALTER TABLE {QuotePg(input.TableName)} ADD COLUMN {PgColumnDefinition(input)}");
                if (input.IsPrimarykey == 1) db.Ado.ExecuteCommand($"ALTER TABLE {QuotePg(input.TableName)} ADD PRIMARY KEY ({QuotePg(input.DbColumnName)})");
                PgColumnComment(db, input.TableName, input.DbColumnName, input.ColumnDescription);
            });
            return;
        }
        var column = new DbColumnInfo
        {
            ColumnDescription = input.ColumnDescription,
            DbColumnName = input.DbColumnName,
            IsIdentity = input.IsIdentity == 1,
            IsNullable = input.IsNullable == 1,
            IsPrimarykey = input.IsPrimarykey == 1,
            Length = input.Length,
            DecimalDigits = input.DecimalDigits,
            DataType = input.DataType,
            DefaultValue = input.DefaultValue
        };
        db.DbMaintenance.AddColumn(input.TableName, column);
        // 默认值直接添加报错
        if (db.CurrentConnectionConfig.DbType != SqlSugar.DbType.PostgreSQL && !string.IsNullOrWhiteSpace(input.DefaultValue))
        {
            db.DbMaintenance.AddDefaultValue(input.TableName, column.DbColumnName, input.DefaultValue);
        }
        db.DbMaintenance.AddColumnRemark(input.DbColumnName, input.TableName, input.ColumnDescription);
        if (column.IsPrimarykey) db.DbMaintenance.AddPrimaryKey(input.TableName, input.DbColumnName);
    }

    /// <summary>
    /// 删除列 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "DeleteColumn"), HttpPost]
    [DisplayName("删除列")]
    public void DeleteColumn(DeleteDbColumnInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        EnsureColumn(db, input.TableName, input.DbColumnName);
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL)
        {
            db.Ado.ExecuteCommand($"ALTER TABLE {QuotePg(input.TableName)} DROP COLUMN {QuotePg(input.DbColumnName)}");
            return;
        }
        db.DbMaintenance.DropColumn(input.TableName, input.DbColumnName);
    }

    /// <summary>
    /// 编辑列 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "UpdateColumn"), HttpPost]
    [DisplayName("编辑列")]
    public void UpdateColumn(UpdateDbColumnInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        EnsureColumn(db, input.TableName, input.OldColumnName);
        ValidateIdentifier(input.ColumnName);
        ValidateDefault(input.DefaultValue);
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL)
        {
            RunPgTransaction(db, () =>
            {
                if (input.OldColumnName != input.ColumnName)
                    db.Ado.ExecuteCommand($"ALTER TABLE {QuotePg(input.TableName)} RENAME COLUMN {QuotePg(input.OldColumnName)} TO {QuotePg(input.ColumnName)}");
                if (input.DefaultValue != null)
                {
                    var clause = string.IsNullOrWhiteSpace(input.DefaultValue) ? "DROP DEFAULT" : $"SET DEFAULT {input.DefaultValue}";
                    db.Ado.ExecuteCommand($"ALTER TABLE {QuotePg(input.TableName)} ALTER COLUMN {QuotePg(input.ColumnName)} {clause}");
                }
                PgColumnComment(db, input.TableName, input.ColumnName, input.Description);
            });
            return;
        }

        // 前端未修改列名时，不进行重命名操作，避免报错
        if (input.OldColumnName != input.ColumnName)
        {
            db.DbMaintenance.RenameColumn(input.TableName, input.OldColumnName, input.ColumnName);
        }

        if (!string.IsNullOrWhiteSpace(input.DefaultValue))
        {
            db.DbMaintenance.AddDefaultValue(input.TableName, input.ColumnName, input.DefaultValue);
        }
        //if (db.DbMaintenance.IsAnyColumnRemark(input.ColumnName, input.TableName))
        //{
        //    db.DbMaintenance.DeleteColumnRemark(input.ColumnName, input.TableName);
        //}

        db.DbMaintenance.AddColumnRemark(input.ColumnName, input.TableName, string.IsNullOrWhiteSpace(input.Description) ? input.ColumnName : input.Description);
    }

    /// <summary>
    /// 移动列位置 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "MoveColumn"), HttpPost]
    [DisplayName("移动列")]
    public void MoveColumn(MoveDbColumnInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        EnsureColumn(db, input.TableName, input.ColumnName);
        if (!string.IsNullOrEmpty(input.AfterColumnName)) EnsureColumn(db, input.TableName, input.AfterColumnName);
        if (string.Equals(input.ColumnName, input.AfterColumnName, StringComparison.OrdinalIgnoreCase)) throw Oops.Oh("不能移动到自身之后");
        var dbMaintenance = db.DbMaintenance;

        var dbType = db.CurrentConnectionConfig.DbType;

        var columns = dbMaintenance.GetColumnInfosByTableName(input.TableName, false);
        var targetColumn = columns.FirstOrDefault(c =>
            c.DbColumnName.Equals(input.ColumnName, StringComparison.OrdinalIgnoreCase));

        if (targetColumn == null)
            throw new Exception($"列 {input.ColumnName} 在表 {input.TableName} 中不存在");

        switch (dbType)
        {
            case SqlSugar.DbType.MySql:
                MoveColumnInMySQL(db, input.TableName, input.ColumnName, input.AfterColumnName);
                break;

            default:
                throw new NotSupportedException($"暂不支持 {dbType} 数据库的列移动操作");
        }
    }

    /// <summary>
    /// 获取列定义
    /// </summary>
    /// <param name="db"></param>
    /// <param name="tableName"></param>
    /// <param name="columnName"></param>
    /// <param name="noDefault"></param>
    /// <returns></returns>
    /// <exception cref="Exception"></exception>
    private string GetColumnDefinitionInMySQL(ISqlSugarClient db, string tableName, string columnName, bool noDefault = false)
    {
        var columnDef = db.Ado.SqlQuery<dynamic>(
            $"SHOW FULL COLUMNS FROM `{tableName}` WHERE Field = '{columnName}'"
        ).FirstOrDefault();

        if (columnDef == null)
            throw new Exception($"Column {columnName} not found");

        var definition = new StringBuilder();
        definition.Append($"`{columnName}` ");  // 列名
        definition.Append($"{columnDef.Type} "); // 数据类型

        // 处理约束条件
        definition.Append(columnDef.Null == "YES" ? "NULL " : "NOT NULL ");
        if (columnDef.Default != null && !noDefault)
            definition.Append($"DEFAULT '{columnDef.Default}' ");
        if (!string.IsNullOrEmpty(columnDef.Extra))
            definition.Append($"{columnDef.Extra} ");
        if (!string.IsNullOrEmpty(columnDef.Comment))
            definition.Append($"COMMENT '{columnDef.Comment.Replace("'", "''")}'");

        return definition.ToString();
    }

    /// <summary>
    /// MySQL 列移动实现
    /// </summary>
    /// <param name="db"></param>
    /// <param name="tableName"></param>
    /// <param name="columnName"></param>
    /// <param name="afterColumnName"></param>
    private void MoveColumnInMySQL(ISqlSugarClient db, string tableName, string columnName, string afterColumnName)
    {
        var definition = GetColumnDefinitionInMySQL(db, tableName, columnName);
        var sql = new StringBuilder();
        sql.Append($"ALTER TABLE `{tableName}` MODIFY COLUMN {definition}");

        if (string.IsNullOrEmpty(afterColumnName))
            sql.Append(" FIRST");
        else
            sql.Append($" AFTER `{afterColumnName}`");

        db.Ado.ExecuteCommand(sql.ToString());
    }

    /// <summary>
    /// 获取表列表 🔖
    /// </summary>
    /// <param name="configId">ConfigId</param>
    /// <returns></returns>
    [DisplayName("获取表列表")]
    public List<DbTableInfo> GetTableList(string configId = SqlSugarConst.MainConfigId)
    {
        var db = GetMaintenanceConnection(configId);
        return db.DbMaintenance.GetTableInfoList(false);
    }

    /// <summary>
    /// 增加表 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "AddTable"), HttpPost]
    [DisplayName("增加表")]
    public void AddTable(DbTableInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        ValidateIdentifier(input.TableName);
        if (db.DbMaintenance.IsAnyTable(input.TableName, false)) throw Oops.Oh("表已存在，不能覆盖已有结构");
        if (input.DbColumnInfoList == null || !input.DbColumnInfoList.Any())
            throw Oops.Oh(ErrorCodeEnum.db1000);

        foreach (var column in input.DbColumnInfoList) ValidateColumn(db, column);
        if (input.DbColumnInfoList.GroupBy(u => u.DbColumnName, StringComparer.OrdinalIgnoreCase).Any(u => u.Count() > 1))
            throw Oops.Oh(ErrorCodeEnum.db1002);

        var config = App.GetOptions<DbConnectionOptions>().ConnectionConfigs.FirstOrDefault(u => u.ConfigId.ToString() == input.ConfigId);
        var normalized = input.DbColumnInfoList.Select(u =>
        {
            var column = u.Adapt<DbColumnInput>();
            column.DbColumnName = config!.DbSettings.EnableUnderLine ? u.DbColumnName.ToUnderLine() : u.DbColumnName;
            return column;
        }).ToList();
        if (normalized.GroupBy(u => u.DbColumnName, StringComparer.OrdinalIgnoreCase).Any(u => u.Count() > 1)) throw Oops.Oh(ErrorCodeEnum.db1002);
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL)
        {
            RunPgTransaction(db, () =>
            {
                var definitions = normalized.Select(PgColumnDefinition).ToList();
                var primary = normalized.Where(u => u.IsPrimarykey == 1).Select(u => QuotePg(u.DbColumnName)).ToList();
                if (primary.Count > 0) definitions.Add($"PRIMARY KEY ({string.Join(", ", primary)})");
                db.Ado.ExecuteCommand($"CREATE TABLE {QuotePg(input.TableName)} ({string.Join(", ", definitions)})");
                db.Ado.ExecuteCommand($"COMMENT ON TABLE {QuotePg(input.TableName)} IS {PgLiteral(input.Description)}");
                foreach (var column in normalized) PgColumnComment(db, input.TableName, column.DbColumnName, column.ColumnDescription);
            });
            return;
        }
        var typeBuilder = db.DynamicBuilder().CreateClass(input.TableName, new SugarTable() { TableName = input.TableName, TableDescription = input.Description });
        input.DbColumnInfoList.ForEach(u =>
        {
            var dbColumnName = config!.DbSettings.EnableUnderLine ? u.DbColumnName.Trim().ToUnderLine() : u.DbColumnName.Trim();
            // 虚拟类都默认string类型，具体以列数据类型为准
            typeBuilder.CreateProperty(dbColumnName, typeof(string), new SugarColumn()
            {
                IsPrimaryKey = u.IsPrimarykey == 1,
                IsIdentity = u.IsIdentity == 1,
                ColumnDataType = u.DataType,
                Length = u.Length,
                IsNullable = u.IsNullable == 1,
                DecimalDigits = u.DecimalDigits,
                ColumnDescription = u.ColumnDescription,
                DefaultValue = u.DefaultValue,
            });
        });
        db.CodeFirst.InitTables(typeBuilder.BuilderType());
    }

    /// <summary>
    /// 删除表 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "DeleteTable"), HttpPost]
    [DisplayName("删除表")]
    public void DeleteTable(DeleteDbTableInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        EnsureTable(db, input.TableName);
        db.DbMaintenance.DropTable(input.TableName);
    }

    /// <summary>
    /// 编辑表 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "UpdateTable"), HttpPost]
    [DisplayName("编辑表")]
    public void UpdateTable(UpdateDbTableInput input)
    {
        var db = GetMaintenanceConnection(input.ConfigId);
        EnsureTable(db, input.OldTableName);
        ValidateIdentifier(input.TableName);
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL)
        {
            RunPgTransaction(db, () =>
            {
                if (input.OldTableName != input.TableName)
                    db.Ado.ExecuteCommand($"ALTER TABLE {QuotePg(input.OldTableName)} RENAME TO {QuotePg(input.TableName)}");
                db.Ado.ExecuteCommand($"COMMENT ON TABLE {QuotePg(input.TableName)} IS {PgLiteral(input.Description)}");
            });
            return;
        }
        if (input.OldTableName != input.TableName)
        {
            if (db.DbMaintenance.IsAnyTable(input.TableName, false)) throw Oops.Oh("目标表已存在");
            db.DbMaintenance.RenameTable(input.OldTableName, input.TableName);
        }
        try
        {
            if (db.DbMaintenance.IsAnyTableRemark(input.TableName))
                db.DbMaintenance.DeleteTableRemark(input.TableName);

            if (!string.IsNullOrWhiteSpace(input.Description))
                db.DbMaintenance.AddTableRemark(input.TableName, input.Description);
        }
        catch (NotSupportedException ex)
        {
            throw Oops.Oh(ex.ToString());
        }
    }

    private ISqlSugarClient GetMaintenanceConnection(string configId)
    {
        if (string.IsNullOrWhiteSpace(configId) || !App.GetOptions<DbConnectionOptions>().ConnectionConfigs.Any(u => u.ConfigId.ToString() == configId))
            throw Oops.Oh("请选择有效的数据库连接");
        return _db.AsTenant().GetConnectionScope(configId);
    }

    private static List<ColumnRelation> GetPostgreSqlRelations(ISqlSugarClient db)
    {
        const string sql = """
            SELECT
                child.relname AS "SourceTableName",
                child_column.attname AS "SourceColumnName",
                'ONE_TO_MANY' AS "Type",
                parent.relname AS "TargetTableName",
                parent_column.attname AS "TargetColumnName"
            FROM pg_constraint foreign_key
            JOIN pg_class child ON child.oid = foreign_key.conrelid
            JOIN pg_namespace child_schema ON child_schema.oid = child.relnamespace
            JOIN pg_class parent ON parent.oid = foreign_key.confrelid
            JOIN pg_namespace parent_schema ON parent_schema.oid = parent.relnamespace
            CROSS JOIN LATERAL unnest(foreign_key.conkey) WITH ORDINALITY AS source_column(attnum, ordinal)
            JOIN LATERAL unnest(foreign_key.confkey) WITH ORDINALITY AS target_column(attnum, ordinal)
                ON target_column.ordinal = source_column.ordinal
            JOIN pg_attribute child_column
                ON child_column.attrelid = child.oid AND child_column.attnum = source_column.attnum
            JOIN pg_attribute parent_column
                ON parent_column.attrelid = parent.oid AND parent_column.attnum = target_column.attnum
            WHERE foreign_key.contype = 'f'
              AND child_schema.nspname = current_schema()
              AND parent_schema.nspname = current_schema()
            ORDER BY child.relname, child_column.attnum, parent.relname, parent_column.attnum
            """;
        return db.Ado.SqlQuery<ColumnRelation>(sql);
    }

    internal static void ValidateIdentifier(string name)
    {
        if (string.IsNullOrWhiteSpace(name) || name.Length > 63 || !System.Text.RegularExpressions.Regex.IsMatch(name, @"^[\p{L}_][\p{L}\p{N}_$]*$"))
            throw Oops.Oh("名称须为字母、数字或下划线，且不能以数字开头，最长 63 个字符");
    }

    internal static void ValidateDefault(string value)
    {
        if (string.IsNullOrWhiteSpace(value)) return;
        // 默认值允许常用 SQL 字面量和时间表达式，不接受任意 SQL 语句。
        if (!System.Text.RegularExpressions.Regex.IsMatch(value.Trim(), @"^(?:-?\d+(?:\.\d+)?|'(?:[^']|'')*'|true|false|null|CURRENT_TIMESTAMP(?:\(\d\))?|CURRENT_DATE|CURRENT_TIME|now\(\))$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
            throw Oops.Oh("默认值须为 SQL 字面量或时间表达式");
    }

    private static string QuotePg(string name) => "\"" + name.Replace("\"", "\"\"") + "\"";
    private static string PgLiteral(string value) => value == null ? "NULL" : "'" + value.Replace("'", "''") + "'";

    private static void PgColumnComment(ISqlSugarClient db, string table, string column, string comment) =>
        db.Ado.ExecuteCommand($"COMMENT ON COLUMN {QuotePg(table)}.{QuotePg(column)} IS {PgLiteral(comment)}");

    private static void RunPgTransaction(ISqlSugarClient db, Action action)
    {
        db.Ado.BeginTran();
        try
        {
            db.Ado.ExecuteCommand("SET LOCAL standard_conforming_strings = on");
            action();
            db.Ado.CommitTran();
        }
        catch
        {
            db.Ado.RollbackTran();
            throw;
        }
    }

    private static string PgColumnDefinition(DbColumnInput column)
    {
        string type = column.DataType.ToLowerInvariant();
        if (column.Length > 0 && type is "varchar" or "character varying" or "char" or "character" or "bit" or "varbit") type += $"({column.Length})";
        else if (column.Length > 0 && type is "numeric" or "decimal") type += $"({column.Length},{column.DecimalDigits})";
        string identity = column.IsIdentity == 1 ? " GENERATED BY DEFAULT AS IDENTITY" : "";
        string nullable = column.IsNullable == 1 && column.IsPrimarykey == 0 ? " NULL" : " NOT NULL";
        string defaultValue = string.IsNullOrWhiteSpace(column.DefaultValue) ? "" : $" DEFAULT {column.DefaultValue}";
        return $"{QuotePg(column.DbColumnName)} {type}{identity}{nullable}{defaultValue}";
    }

    private static void EnsureTable(ISqlSugarClient db, string table)
    {
        ValidateIdentifier(table);
        if (!db.DbMaintenance.IsAnyTable(table, false)) throw Oops.Oh("目标表不存在，请重新选择");
    }

    private static void EnsureColumn(ISqlSugarClient db, string table, string column)
    {
        EnsureTable(db, table);
        ValidateIdentifier(column);
        if (!db.DbMaintenance.GetColumnInfosByTableName(table, false).Any(u => u.DbColumnName.Equals(column, StringComparison.Ordinal)))
            throw Oops.Oh("目标字段不存在，请刷新结构");
    }

    private static void ValidateColumn(ISqlSugarClient db, DbColumnInput column)
    {
        ValidateIdentifier(column.DbColumnName);
        ValidateDefault(column.DefaultValue);
        if (string.IsNullOrWhiteSpace(column.DataType) || !db.DbMaintenance.GetDbTypes().Any(u => u.Equals(column.DataType, StringComparison.OrdinalIgnoreCase)))
            throw Oops.Oh("请选择当前数据库支持的字段类型");
        if (column.Length < 0 || column.DecimalDigits < 0 || column.DecimalDigits > column.Length && column.Length > 0 ||
            column.IsIdentity is < 0 or > 1 || column.IsNullable is < 0 or > 1 || column.IsPrimarykey is < 0 or > 1)
            throw Oops.Oh("字段参数无效");
        if (db.CurrentConnectionConfig.DbType == SqlSugar.DbType.PostgreSQL && column.IsIdentity == 1 &&
            (column.DataType.ToLowerInvariant() is not ("smallint" or "int" or "integer" or "bigint" or "int2" or "int4" or "int8") || !string.IsNullOrWhiteSpace(column.DefaultValue)))
            throw Oops.Oh("PostgreSQL 自增列须为整数类型且不能另设默认值");
    }

    [ApiDescriptionSettings(Name = "PreviewEntity"), HttpPost]
    [DisplayName("预览实体")]
    public DatabaseCodePreview PreviewEntity(CreateEntityInput input) => BuildEntityPreview(input);

    [ApiDescriptionSettings(Name = "CreateEntity"), HttpPost]
    [DisplayName("创建实体")]
    public void CreateEntity(CreateEntityInput input)
    {
        var preview = BuildEntityPreview(input);
        WriteGeneratedFile(preview, input.ExpectedHash, input.OverwriteExisting, input.ExpectedTargetHash);
    }

    [ApiDescriptionSettings(Name = "PreviewSeedData"), HttpPost]
    [DisplayName("预览种子数据")]
    public Task<DatabaseCodePreview> PreviewSeedData(CreateSeedDataInput input) => BuildSeedPreview(input);

    [ApiDescriptionSettings(Name = "CreateSeedData"), HttpPost]
    [DisplayName("创建种子数据")]
    public async Task CreateSeedData(CreateSeedDataInput input)
    {
        var preview = await BuildSeedPreview(input);
        WriteGeneratedFile(preview, input.ExpectedHash, input.OverwriteExisting, input.ExpectedTargetHash);
    }

    [DisplayName("获取数据库代码生成选项")]
    public object GetGenerationOptions() => new { Namespaces = (_codeGenOptions.BackendApplicationNamespaces ?? new List<string>()).Append("Admin.NET.Core").Distinct(), BaseClasses = _codeGenOptions.BaseEntityNames };

    private DatabaseCodePreview BuildEntityPreview(CreateEntityInput input)
    {
        ValidateIdentifier(input.TableName);
        var config = GetGenerationConfig(input.ConfigId);
        input.Position = ValidateGenerationPosition(input.Position, "Admin.NET.Application");
        input.EntityName = string.IsNullOrWhiteSpace(input.EntityName) ? CodeGenUtil.CamelColumnName(input.TableName, null) : input.EntityName;
        ValidateIdentifier(input.EntityName);
        EnsureCSharpName(input.EntityName);
        var db = _db.AsTenant().GetConnectionScope(input.ConfigId);
        var tableInfo = FindTable(db, input.TableName);
        var baseColumns = GetBaseColumns(input.BaseClassName);
        var columns = db.DbMaintenance.GetColumnInfosByTableName(tableInfo.Name, false);
        foreach (var column in columns)
        {
            if (column.DbColumnName.ToUpperInvariant() == column.DbColumnName)
                throw Oops.Oh($"错误：{column.DbColumnName} 字段全是大写字母，请更改为大写字母开头的驼峰式命名!");
            column.PropertyName = config.DbSettings.EnableUnderLine ? CodeGenUtil.CamelColumnName(column.DbColumnName, baseColumns) : column.DbColumnName;
            EnsureCSharpName(column.PropertyName);
            column.DataType = CodeGenUtil.ConvertDataType(column, config.DbType);
            column.ColumnDescription = EscapeCSharpString(column.ColumnDescription);
            column.DefaultValue = EscapeCSharpString(column.DefaultValue);
        }
        if (!string.IsNullOrWhiteSpace(input.BaseClassName))
        {
            var baseType = Assembly.Load("Admin.NET.Core").GetType($"Admin.NET.Core.{input.BaseClassName}")!;
            foreach (var column in columns.Where(column => baseColumns.Contains(column.PropertyName, StringComparer.OrdinalIgnoreCase)))
            {
                var property = baseType.GetProperty(column.PropertyName)!;
                var mapping = property.GetCustomAttribute<SugarColumn>();
                var propertyType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
                if (column.IsIdentity != (mapping?.IsIdentity ?? false) || column.IsPrimarykey != (mapping?.IsPrimaryKey ?? false) || !MatchesColumnType(propertyType, column.DataType.TrimEnd('?')))
                    throw Oops.Oh($"基类字段 {column.PropertyName} 与数据库类型或主键 / 自增配置不一致，请选择无基类生成");
            }
        }
        if (_codeGenOptions.BaseEntityNames?.Contains(input.BaseClassName, StringComparer.OrdinalIgnoreCase) == true)
            columns = columns.Where(column => !baseColumns.Contains(column.PropertyName, StringComparer.OrdinalIgnoreCase)).ToList();
        if (columns.GroupBy(column => column.PropertyName, StringComparer.OrdinalIgnoreCase).Any(group => group.Count() > 1)) throw Oops.Oh("转换后的字段名重复，不能生成实体");
        var content = _viewEngine.RunCompileFromCached(File.ReadAllText(GetEntityTemplatePath()), new
        {
            NameSpace = $"{input.Position}.Entity", input.TableName, input.EntityName,
            BaseClassName = string.IsNullOrWhiteSpace(input.BaseClassName) ? "" : $": {input.BaseClassName}", input.ConfigId,
            Description = EscapeCSharpString(tableInfo.Description), TableField = columns
        });
        return CreatePreview(GetEntityTargetPath(input), content);
    }

    private static bool MatchesColumnType(Type type, string name) => name switch
    {
        "long" => type == typeof(long), "int" => type == typeof(int), "Int16" => type == typeof(short),
        "decimal" => type == typeof(decimal), "float" => type == typeof(float), "double" => type == typeof(double),
        "bool" => type == typeof(bool), "string" => type == typeof(string), "Guid" => type == typeof(Guid),
        "DateTime" => type == typeof(DateTime), "byte[]" => type == typeof(byte[]), "object" => type == typeof(object), _ => false
    };

    private async Task<DatabaseCodePreview> BuildSeedPreview(CreateSeedDataInput input)
    {
        ValidateIdentifier(input.TableName);
        var config = GetGenerationConfig(input.ConfigId);
        input.Position = ValidateGenerationPosition(input.Position, "Admin.NET.Core");
        var db = _db.AsTenant().GetConnectionScope(input.ConfigId);
        var tableInfo = FindTable(db, input.TableName);
        var columns = db.DbMaintenance.GetColumnInfosByTableName(tableInfo.Name, false);
        var entityInfo = (await GetEntityInfos()).FirstOrDefault(item => tableInfo.Name.Equals(config.DbSettings.EnableUnderLine ? item.DbTableName.ToUnderLine() : item.DbTableName, StringComparison.OrdinalIgnoreCase));
        if (entityInfo == null) throw Oops.Oh("未找到已编译实体，请先生成实体并重新编译、启动服务");
        input.EntityName = entityInfo.EntityName;
        ValidateIdentifier(input.EntityName);
        input.SeedDataName = input.EntityName + "SeedData" + (input.Suffix ?? string.Empty);
        ValidateIdentifier(input.SeedDataName);
        EnsureCSharpName(input.SeedDataName);
        var records = new List<string>();
        var entityNamespace = entityInfo.Type.Namespace;
        var query = db.QueryableByObject(entityInfo.Type);
        var orderField = columns.FirstOrDefault(column => column.DbColumnName.Equals("create_time", StringComparison.OrdinalIgnoreCase) || column.DbColumnName.Equals("createtime", StringComparison.OrdinalIgnoreCase));
        if (orderField != null) query = query.OrderBy(orderField.DbColumnName);
        var primary = columns.Where(column => column.IsPrimarykey).ToList();
        if (primary.Count == 0) throw Oops.Oh("表缺少主键，无法生成种子数据");
        foreach (var column in primary) query = query.OrderBy(column.DbColumnName);
        var rows = ((IEnumerable)await query.ToListAsync()).Cast<object>().ToList();
        if (input.FilterExistingData) rows = FilterExistingSeedRecords(input, entityInfo.Type, rows);
        var properties = entityInfo.Type.GetProperties().Where(property => property.CanRead && property.SetMethod?.IsPublic == true && property.GetIndexParameters().Length == 0 && property.GetCustomAttribute<SugarColumn>()?.IsIgnore != true && property.GetCustomAttribute<Navigate>() == null).OrderBy(property => property.GetCustomAttribute<SugarColumn>()?.IsPrimaryKey == true ? 0 : 1).ThenBy(property => property.Name, StringComparer.Ordinal).ToList();
        records.AddRange(rows.Select(row => string.Join(", ", properties.Select(property => $"{property.Name}={CSharpLiteral(property.GetValue(row), property.PropertyType)}"))));
        var data = new { NameSpace = $"{input.Position}.SeedData", EntityNameSpace = entityNamespace, input.TableName, input.EntityName, input.SeedDataName, input.ConfigId, Description = EscapeCSharpString(tableInfo.Description), RecordList = records };
        var content = await _viewEngine.RunCompileAsync(await File.ReadAllTextAsync(GetSeedDataTemplatePath()), data, builderAction: builder =>
        {
            builder.AddAssemblyReferenceByName("System.Linq"); builder.AddAssemblyReferenceByName("System.Collections");
            builder.AddUsing("System.Collections.Generic"); builder.AddUsing("System.Linq");
        });
        return CreatePreview(GetSeedDataTargetPath(input), content);
    }

    private static List<object> FilterExistingSeedRecords(CreateSeedDataInput input, Type entityType, List<object> records)
    {
        var primary = entityType.GetProperties().Where(property => property.GetCustomAttribute<SugarColumn>()?.IsPrimaryKey == true).ToArray();
        if (primary.Length == 0) throw Oops.Oh("实体未声明主键，无法过滤已有种子数据");
        var knownKeys = new HashSet<string>(StringComparer.Ordinal);
        var providers = App.EffectiveTypes.Where(type => type.IsClass && !type.IsAbstract && type.GetInterfaces().Any(contract => contract.IsGenericType && contract.GetGenericTypeDefinition() == typeof(ISqlSugarEntitySeedData<>) && contract.GenericTypeArguments[0] == entityType));
        foreach (var provider in providers)
        {
            if (provider.FullName == $"{input.Position}.SeedData.{input.SeedDataName}" || provider.FullName == $"{input.Position}.{input.SeedDataName}") continue;
            var contract = typeof(ISqlSugarEntitySeedData<>).MakeGenericType(entityType);
            if (contract.GetMethod("HasData")!.Invoke(Activator.CreateInstance(provider), null) is IEnumerable data)
                foreach (var record in data) knownKeys.Add(SeedRecordKey(record, primary));
        }
        return records.Where(record => !knownKeys.Contains(SeedRecordKey(record, primary))).ToList();
    }

    private static string SeedRecordKey(object record, PropertyInfo[] primary) => System.Text.Json.JsonSerializer.Serialize(primary.Select(property => property.GetValue(record)).ToArray());

    private DbConnectionConfig GetGenerationConfig(string configId) => App.GetOptions<DbConnectionOptions>().ConnectionConfigs.FirstOrDefault(config => config.ConfigId.ToString() == configId) ?? throw Oops.Oh("数据库配置不存在");

    private string ValidateGenerationPosition(string position, string fallback)
    {
        position = string.IsNullOrWhiteSpace(position) ? fallback : position;
        if (position != "Admin.NET.Core" && _codeGenOptions.BackendApplicationNamespaces?.Contains(position, StringComparer.Ordinal) != true) throw Oops.Oh("生成位置不在允许的后端命名空间中");
        foreach (var segment in position.Split('.')) EnsureCSharpName(segment);
        return position;
    }

    private static void EnsureCSharpName(string name)
    {
        if (!Microsoft.CodeAnalysis.CSharp.SyntaxFacts.IsValidIdentifier(name) || Microsoft.CodeAnalysis.CSharp.SyntaxFacts.GetKeywordKind(name) != Microsoft.CodeAnalysis.CSharp.SyntaxKind.None) throw Oops.Oh("名称不是有效的 C# 标识符");
    }

    private static DbTableInfo FindTable(ISqlSugarClient db, string tableName) => db.DbMaintenance.GetTableInfoList(false).FirstOrDefault(table => table.Name.Equals(tableName, StringComparison.Ordinal) || table.Name.Equals(tableName, StringComparison.OrdinalIgnoreCase)) ?? throw Oops.Oh(ErrorCodeEnum.db1001);

    private string[] GetBaseColumns(string baseClassName)
    {
        if (string.IsNullOrWhiteSpace(baseClassName)) return Array.Empty<string>();
        if (_codeGenOptions.BaseEntityNames?.Contains(baseClassName, StringComparer.OrdinalIgnoreCase) != true) throw Oops.Oh("基类集合配置不存在此类型");
        var type = Assembly.Load("Admin.NET.Core").GetType($"Admin.NET.Core.{baseClassName}") ?? throw Oops.Oh("基类集合配置不存在此类型");
        var columns = CodeGenUtil.GetPropertyInfoArray(type)?.Select(property => property.Name).ToArray() ?? Array.Empty<string>();
        if (columns.Length == 0) throw Oops.Oh("基类中不存在任何字段");
        return columns;
    }

    private DatabaseCodePreview CreatePreview(string targetPath, string content)
    {
        ValidateGeneratedPath(targetPath);
        var relativePath = Path.GetRelativePath(GetGenerationRoot(), targetPath);
        return new DatabaseCodePreview
        {
            FileName = Path.GetFileName(targetPath), RelativePath = relativePath, Content = content,
            Hash = HashGeneratedContent(relativePath + "\n" + content), FileExists = File.Exists(targetPath),
            TargetHash = File.Exists(targetPath) ? HashGeneratedContent(File.ReadAllText(targetPath, Encoding.UTF8)) : null
        };
    }

    private void WriteGeneratedFile(DatabaseCodePreview preview, string expectedHash, bool overwriteExisting, string expectedTargetHash)
    {
        if (!string.IsNullOrWhiteSpace(expectedHash) && !string.Equals(expectedHash, preview.Hash, StringComparison.OrdinalIgnoreCase)) throw Oops.Oh("预览已过期，请重新预览");
        var path = Path.Combine(GetGenerationRoot(), preview.RelativePath);
        lock (GenerationWriteLock)
        {
            ValidateGeneratedPath(path);
            var exists = File.Exists(path);
            if (exists && (!overwriteExisting || string.IsNullOrWhiteSpace(expectedHash))) throw Oops.Oh("目标文件已存在，请先预览并明确确认覆盖");
            if (exists && !string.Equals(expectedTargetHash, HashGeneratedContent(File.ReadAllText(path, Encoding.UTF8)), StringComparison.OrdinalIgnoreCase)) throw Oops.Oh("目标文件已变化，请重新预览");
            if (!exists && !string.IsNullOrWhiteSpace(expectedTargetHash)) throw Oops.Oh("目标文件已变化，请重新预览");
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            var temporary = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try
            {
                File.WriteAllText(temporary, preview.Content, new UTF8Encoding(false));
                // 替换前再次核对目标，避免写入临时文件期间其他工具修改源码。
                if (exists && (!File.Exists(path) || !string.Equals(expectedTargetHash, HashGeneratedContent(File.ReadAllText(path, Encoding.UTF8)), StringComparison.OrdinalIgnoreCase))) throw Oops.Oh("目标文件已变化，请重新预览");
                File.Move(temporary, path, exists && overwriteExisting);
            }
            finally { if (File.Exists(temporary)) File.Delete(temporary); }
        }
    }

    private static string HashGeneratedContent(string content) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(content)));

    private void ValidateGeneratedPath(string path)
    {
        var root = Path.GetFullPath(GetGenerationRoot());
        path = Path.GetFullPath(path);
        if (!path.StartsWith(root.TrimEnd(Path.DirectorySeparatorChar) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw Oops.Oh("生成路径超出后端根目录");
        var current = path;
        while (!string.Equals(current, root, StringComparison.OrdinalIgnoreCase))
        {
            if ((File.Exists(current) || Directory.Exists(current)) && (File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw Oops.Oh("生成路径不能包含符号链接");
            current = Path.GetDirectoryName(current)!;
        }
    }

    private string GetGenerationRoot() => string.IsNullOrWhiteSpace(_codeGenOptions.BackendRootPath) ? new DirectoryInfo(App.WebHostEnvironment.ContentRootPath).Parent!.FullName : Path.GetFullPath(_codeGenOptions.BackendRootPath);

    private static string EscapeCSharpString(string value)
    {
        if (value == null) return null;
        var literal = Microsoft.CodeAnalysis.CSharp.SymbolDisplay.FormatLiteral(value, true);
        return literal[1..^1];
    }

    private static string CSharpLiteral(object value, Type type)
    {
        if (value is null || value == DBNull.Value) return "null";
        var actual = Nullable.GetUnderlyingType(type ?? value.GetType()) ?? type ?? value.GetType();
        if (actual == typeof(string)) return Microsoft.CodeAnalysis.CSharp.SymbolDisplay.FormatLiteral((string)value, true);
        if (actual == typeof(char)) return Microsoft.CodeAnalysis.CSharp.SymbolDisplay.FormatLiteral((char)value, true);
        if (actual == typeof(bool)) return Convert.ToBoolean(value, CultureInfo.InvariantCulture) ? "true" : "false";
        if (actual == typeof(DateTime)) return $"DateTime.Parse(\"{((DateTime)value):O}\", null, DateTimeStyles.RoundtripKind)";
        if (actual == typeof(DateTimeOffset)) return $"DateTimeOffset.Parse(\"{((DateTimeOffset)value):O}\", null, DateTimeStyles.RoundtripKind)";
        if (actual == typeof(Guid)) return $"Guid.Parse(\"{value}\")";
        if (actual == typeof(byte[])) return $"Convert.FromHexString(\"{Convert.ToHexString((byte[])value)}\")";
        if (actual == typeof(TimeSpan)) return $"TimeSpan.FromTicks({((TimeSpan)value).Ticks}L)";
        if (actual == typeof(DateOnly)) return $"DateOnly.FromDayNumber({((DateOnly)value).DayNumber})";
        if (actual == typeof(TimeOnly)) return $"new TimeOnly({((TimeOnly)value).Ticks}L)";
        if (actual.IsEnum) return $"(global::{actual.FullName.Replace('+', '.')}){CSharpLiteral(Convert.ChangeType(value, Enum.GetUnderlyingType(actual), CultureInfo.InvariantCulture), Enum.GetUnderlyingType(actual))}";
        if (actual == typeof(decimal)) return $"{Convert.ToString(value, CultureInfo.InvariantCulture)}m";
        if (actual == typeof(float)) return float.IsFinite((float)value) ? $"{((float)value).ToString("R", CultureInfo.InvariantCulture)}f" : float.IsNaN((float)value) ? "float.NaN" : (float)value > 0 ? "float.PositiveInfinity" : "float.NegativeInfinity";
        if (actual == typeof(double)) return double.IsFinite((double)value) ? $"{((double)value).ToString("R", CultureInfo.InvariantCulture)}d" : double.IsNaN((double)value) ? "double.NaN" : (double)value > 0 ? "double.PositiveInfinity" : "double.NegativeInfinity";
        if (actual == typeof(long)) return $"{value}L";
        if (actual == typeof(ulong)) return $"{value}UL";
        if (actual == typeof(uint)) return $"{value}U";
        if (actual == typeof(byte) || actual == typeof(sbyte) || actual == typeof(short) || actual == typeof(ushort) || actual == typeof(int)) return Convert.ToString(value, CultureInfo.InvariantCulture);
        throw Oops.Oh($"字段类型 {actual.Name} 暂不支持生成种子，请调整实体映射");
    }

    /// <summary>
    /// 获取库表信息
    /// </summary>
    /// <returns></returns>
    private async Task<IEnumerable<EntityInfo>> GetEntityInfos()
    {
        var entityInfos = new List<EntityInfo>();

        var type = typeof(SugarTable);
        var types = new List<Type>();
        if (_codeGenOptions.EntityAssemblyNames != null)
        {
            foreach (var asm in _codeGenOptions.EntityAssemblyNames.Select(Assembly.Load))
            {
                types.AddRange(asm.GetExportedTypes().ToList());
            }
        }

        Type[] cosType = types.Where(o => IsMyAttribute(Attribute.GetCustomAttributes(o, true))).ToArray();

        foreach (var c in cosType)
        {
            var sugarAttribute = c.GetCustomAttributes(type, true)?.FirstOrDefault();

            var des = c.GetCustomAttributes(typeof(DescriptionAttribute), true);
            var description = "";
            if (des.Length > 0)
            {
                description = ((DescriptionAttribute)des[0]).Description;
            }
            entityInfos.Add(new EntityInfo()
            {
                EntityName = c.Name,
                DbTableName = sugarAttribute == null || string.IsNullOrWhiteSpace(((SugarTable)sugarAttribute).TableName) ? c.Name : ((SugarTable)sugarAttribute).TableName,
                TableDescription = description,
                Type = c
            });
        }
        return await Task.FromResult(entityInfos);

        bool IsMyAttribute(Attribute[] o)
        {
            return o.Any(a => a.GetType() == type);
        }
    }

    /// <summary>
    /// 获取实体模板文件路径
    /// </summary>
    /// <returns></returns>
    private static string GetEntityTemplatePath()
    {
        var templatePath = Path.Combine(App.WebHostEnvironment.WebRootPath, "template");
        return Path.Combine(templatePath, "Entity.cs.vm");
    }

    /// <summary>
    /// 获取种子数据模板文件路径
    /// </summary>
    /// <returns></returns>
    private static string GetSeedDataTemplatePath()
    {
        var templatePath = Path.Combine(App.WebHostEnvironment.WebRootPath, "template");
        return Path.Combine(templatePath, "SeedData.cs.vm");
    }

    /// <summary>
    /// 设置生成实体文件路径
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    private string GetEntityTargetPath(CreateEntityInput input)
    {
        var backendPath = Path.Combine(GetGenerationRoot(), input.Position, "Entity");
        //if (!Directory.Exists(backendPath))
        //{
        //    var pluginsPath = App.GetConfig<string[]>("AppSettings:ExternalAssemblies");
        //    foreach (var pluginPath in pluginsPath)
        //    {
        //        backendPath = Path.Combine(new DirectoryInfo(App.WebHostEnvironment.ContentRootPath).Parent.FullName, pluginPath, input.Position, "Entity");
        //        if (Directory.Exists(backendPath))
        //            break;
        //    }
        //}
        return Path.Combine(backendPath, input.EntityName + ".cs");
    }

    /// <summary>
    /// 设置生成种子数据文件路径
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    private string GetSeedDataTargetPath(CreateSeedDataInput input)
    {
        var backendPath = Path.Combine(GetGenerationRoot(), input.Position, "SeedData");
        return Path.Combine(backendPath, input.SeedDataName + ".cs");
    }

    /// <summary>
    /// 备份数据库（PostgreSQL）🔖
    /// </summary>
    /// <returns></returns>
    [HttpPost, NonUnify]
    [DisplayName("备份数据库（PostgreSQL）")]
    public async Task<IActionResult> BackupDatabase()
    {
        if (_db.CurrentConnectionConfig.DbType != SqlSugar.DbType.PostgreSQL)
            throw Oops.Oh("只支持 PostgreSQL 数据库 😁");

        var npgsqlConn = new NpgsqlConnectionStringBuilder(_db.CurrentConnectionConfig.ConnectionString);
        if (npgsqlConn == null || string.IsNullOrWhiteSpace(npgsqlConn.Host) || string.IsNullOrWhiteSpace(npgsqlConn.Username) || string.IsNullOrWhiteSpace(npgsqlConn.Password) || string.IsNullOrWhiteSpace(npgsqlConn.Database))
            throw Oops.Oh("PostgreSQL 数据库配置错误");

        // 确保备份目录存在
        var backupDirectory = Path.Combine(Directory.GetCurrentDirectory(), "backups");
        Directory.CreateDirectory(backupDirectory);

        // 构建备份文件名
        string backupFileName = $"backup_{DateTime.Now:yyyyMMddHHmmss}.sql";
        string backupFilePath = Path.Combine(backupDirectory, backupFileName);

        // 启动pg_dump进程进行备份
        // 设置密码：export PGPASSWORD='xxxxxx'
        var bash = $"-U {npgsqlConn.Username} -h {npgsqlConn.Host} -p {npgsqlConn.Port} -E UTF8 -F c -b -v -f {backupFilePath} {npgsqlConn.Database}";
        var startInfo = new ProcessStartInfo
        {
            FileName = "pg_dump",
            Arguments = bash,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
            EnvironmentVariables =
            {
                ["PGPASSWORD"] = npgsqlConn.Password
            }
        };

        //_logger.LogInformation("备份数据库：pg_dump " + bash);

        //try
        //{
        using (var backupProcess = Process.Start(startInfo))
        {
            await backupProcess.WaitForExitAsync();

            //var output = await backupProcess.StandardOutput.ReadToEndAsync();
            //var error = await backupProcess.StandardError.ReadToEndAsync();

            // 检查备份是否成功
            if (backupProcess.ExitCode != 0)
            {
                throw Oops.Oh($"备份失败：ExitCode({backupProcess.ExitCode})");
            }
        }

        //    _logger.LogInformation($"备份成功：{backupFilePath}");
        //}
        //catch (Exception ex)
        //{
        //    _logger.LogError(ex, $"备份失败：");
        //    throw;
        //}

        // 若备份成功则提供下载链接
        return new FileStreamResult(new FileStream(backupFilePath, FileMode.Open), "application/octet-stream")
        {
            FileDownloadName = backupFileName
        };
    }
}
