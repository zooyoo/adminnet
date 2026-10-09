// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Npgsql;

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
    /// 获取可视化库表结构 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取可视化库表结构")]
    public VisualDbTable GetVisualDbTable()
    {
        var visualTableList = new List<VisualTable>();
        var visualColumnList = new List<VisualColumn>();
        var columnRelationList = new List<ColumnRelation>();
        var dbOptions = App.GetOptions<DbConnectionOptions>().ConnectionConfigs.First(u => u.ConfigId.ToString() == SqlSugarConst.MainConfigId);

        // 遍历所有实体获取所有库表结构
        var random = new Random();
        var entityTypes = App.EffectiveTypes.Where(u => !u.IsInterface && !u.IsAbstract && u.IsClass && u.IsDefined(typeof(SugarTable), false)).ToList();
        foreach (var entityType in entityTypes)
        {
            var entityInfo = _db.EntityMaintenance.GetEntityInfoNoCache(entityType);

            var visualTable = new VisualTable
            {
                TableName = entityInfo.DbTableName,
                TableComents = entityInfo.TableDescription + entityInfo.DbTableName,
                X = random.Next(5000),
                Y = random.Next(5000)
            };
            visualTableList.Add(visualTable);

            foreach (EntityColumnInfo columnInfo in entityInfo.Columns)
            {
                var visualColumn = new VisualColumn
                {
                    TableName = columnInfo.DbTableName,
                    ColumnName = dbOptions.DbSettings.EnableUnderLine ? columnInfo.DbColumnName.ToUnderLine() : columnInfo.DbColumnName,
                    DataType = columnInfo.PropertyInfo.PropertyType.Name,
                    DataLength = columnInfo.Length.ToString(),
                    ColumnDescription = columnInfo.ColumnDescription,
                };
                visualColumnList.Add(visualColumn);

                // 根据导航配置获取表之间关联关系
                if (columnInfo.Navigat != null)
                {
                    var name1 = columnInfo.Navigat.GetName();
                    var name2 = columnInfo.Navigat.GetName2();
                    var targetColumnName = string.IsNullOrEmpty(name2) ? "Id" : name2;
                    var relation = new ColumnRelation
                    {
                        SourceTableName = columnInfo.DbTableName,
                        SourceColumnName = dbOptions.DbSettings.EnableUnderLine ? name1.ToUnderLine() : name1,
                        Type = columnInfo.Navigat.GetNavigateType() == NavigateType.OneToOne ? "ONE_TO_ONE" : "ONE_TO_MANY",
                        TargetTableName = dbOptions.DbSettings.EnableUnderLine ? columnInfo.DbColumnName.ToUnderLine() : columnInfo.DbColumnName,
                        TargetColumnName = dbOptions.DbSettings.EnableUnderLine ? targetColumnName.ToUnderLine() : targetColumnName
                    };
                    columnRelationList.Add(relation);
                }
            }
        }

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

    /// <summary>
    /// 创建实体 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "CreateEntity"), HttpPost]
    [DisplayName("创建实体")]
    public void CreateEntity(CreateEntityInput input)
    {
        var config = App.GetOptions<DbConnectionOptions>().ConnectionConfigs.FirstOrDefault(u => u.ConfigId.ToString() == input.ConfigId);
        input.Position = string.IsNullOrWhiteSpace(input.Position) ? "Admin.NET.Application" : input.Position;
        input.EntityName = string.IsNullOrWhiteSpace(input.EntityName) ? (config.DbSettings.EnableUnderLine ? CodeGenUtil.CamelColumnName(input.TableName, null) : input.TableName) : input.EntityName;
        string[] dbColumnNames = Array.Empty<string>();
        // Entity.cs.vm中是允许创建没有基类的实体的，所以这里也要做出相同的判断
        if (!string.IsNullOrWhiteSpace(input.BaseClassName))
        {
            Assembly assembly = Assembly.Load("Admin.NET.Core");
            Type type = assembly.GetType($"Admin.NET.Core.{input.BaseClassName}");
            if (type is null)
                throw Oops.Oh("基类集合配置不存在此类型");
            dbColumnNames = CodeGenUtil.GetPropertyInfoArray(type)?.Select(p => p.Name).ToArray();
            if (dbColumnNames is null || dbColumnNames is { Length: 0 })
                throw Oops.Oh("基类中不存在任何字段");
        }
        var templatePath = GetEntityTemplatePath();
        var targetPath = GetEntityTargetPath(input);
        var db = _db.AsTenant().GetConnectionScope(input.ConfigId);
        DbTableInfo dbTableInfo = db.DbMaintenance.GetTableInfoList(false).FirstOrDefault(u => u.Name == input.TableName || u.Name == input.TableName.ToLower()) ?? throw Oops.Oh(ErrorCodeEnum.db1001);
        List<DbColumnInfo> dbColumnInfos = db.DbMaintenance.GetColumnInfosByTableName(input.TableName, false);
        dbColumnInfos.ForEach(u =>
        {
            if (u.DbColumnName.ToUpper() == u.DbColumnName)
            {
                //字段全是大写的， 这种情况下生成的代码会有问题（即对 DOB 这样的字段，生成的前端代码为 dOB， 而数据序列化到前端又成了 dob，导致bug），因此抛出异常，不允许。
                throw new Exception($"错误：{u.DbColumnName} 字段全是大写字母，这样生成的代码会有bug！请更改为大写字母开头的驼峰式命名!");
            }
            u.PropertyName = config.DbSettings.EnableUnderLine ? CodeGenUtil.CamelColumnName(u.DbColumnName, dbColumnNames) : u.DbColumnName; // 转下划线后的列名需要再转回来
            u.DataType = CodeGenUtil.ConvertDataType(u, config.DbType);
        });
        if (_codeGenOptions.BaseEntityNames.Contains(input.BaseClassName, StringComparer.OrdinalIgnoreCase))
            dbColumnInfos = dbColumnInfos.Where(u => !dbColumnNames.Contains(u.PropertyName, StringComparer.OrdinalIgnoreCase)).ToList();

        var tContent = File.ReadAllText(templatePath);
        var tResult = _viewEngine.RunCompileFromCached(tContent, new
        {
            NameSpace = $"{input.Position}.Entity",
            input.TableName,
            input.EntityName,
            BaseClassName = string.IsNullOrWhiteSpace(input.BaseClassName) ? "" : $": {input.BaseClassName}",
            input.ConfigId,
            dbTableInfo.Description,
            TableField = dbColumnInfos
        });
        File.WriteAllText(targetPath, tResult, Encoding.UTF8);
    }

    /// <summary>
    /// 创建种子数据 🔖
    /// </summary>
    /// <param name="input"></param>
    [ApiDescriptionSettings(Name = "CreateSeedData"), HttpPost]
    [DisplayName("创建种子数据")]
    public async Task CreateSeedData(CreateSeedDataInput input)
    {
        var config = App.GetOptions<DbConnectionOptions>().ConnectionConfigs.FirstOrDefault(u => u.ConfigId.ToString() == input.ConfigId);
        input.Position = string.IsNullOrWhiteSpace(input.Position) ? "Admin.NET.Core" : input.Position;

        var templatePath = GetSeedDataTemplatePath();
        var db = _db.AsTenant().GetConnectionScope(input.ConfigId);
        var tableInfo = db.DbMaintenance.GetTableInfoList(false).First(u => u.Name == input.TableName); // 表名
        List<DbColumnInfo> dbColumnInfos = db.DbMaintenance.GetColumnInfosByTableName(input.TableName, false); // 所有字段
        IEnumerable<EntityInfo> entityInfos = await GetEntityInfos();
        Type entityType = null;
        foreach (var item in entityInfos)
        {
            if (tableInfo.Name.ToLower() != (config.DbSettings.EnableUnderLine ? item.DbTableName.ToUnderLine() : item.DbTableName).ToLower()) continue;
            entityType = item.Type;
            break;
        }
        if (entityType == null) throw Oops.Oh(ErrorCodeEnum.db1003);

        input.EntityName = entityType.Name;
        input.SeedDataName = entityType.Name + "SeedData";
        if (!string.IsNullOrWhiteSpace(input.Suffix)) input.SeedDataName += input.Suffix;

        // 查询所有数据
        var query = db.QueryableByObject(entityType);
        // 优先用创建时间排序
        DbColumnInfo orderField = dbColumnInfos.FirstOrDefault(u => u.DbColumnName.ToLower() == "create_time" || u.DbColumnName.ToLower() == "createtime");
        if (orderField != null) query = query.OrderBy(orderField.DbColumnName);
        // 再使用第一个主键排序
        query = query.OrderBy(dbColumnInfos.First(u => u.IsPrimarykey).DbColumnName);
        var records = ((IEnumerable)await query.ToListAsync()).ToDynamicList();

        // 过滤已存在的数据
        if (input.FilterExistingData && records.Any())
        {
            // 获取实体类型-所有种数据数据类型
            var entityTypes = App.EffectiveTypes.Where(u => !u.IsInterface && !u.IsAbstract && u.IsClass && u.IsDefined(typeof(SugarTable), false) && u.FullName.EndsWith("." + input.EntityName))
                .Where(u => !u.GetCustomAttributes<IgnoreTableAttribute>().Any())
                .ToList();
            if (entityTypes.Count == 1) // 只有一个实体匹配才能过滤
            {
                // 获取实体的主键对应的属性名称
                var pkInfo = entityTypes[0].GetProperties().FirstOrDefault(u => u.GetCustomAttribute<SugarColumn>()?.IsPrimaryKey == true);
                if (pkInfo != null)
                {
                    var seedDataTypes = App.EffectiveTypes
                        .Where(u => !u.IsInterface && !u.IsAbstract && u.IsClass && u.GetInterfaces().Any(
                            i => i.HasImplementedRawGeneric(typeof(ISqlSugarEntitySeedData<>)) && i.GenericTypeArguments[0] == entityTypes[0]
                            )
                        )
                        .ToList();
                    // 可能会重名的种子数据不作为过滤项
                    string doNotFilterFullName1 = $"{input.Position}.SeedData.{input.SeedDataName}";
                    string doNotFilterFullName2 = $"{input.Position}.{input.SeedDataName}"; // Core中的命名空间没有SeedData

                    PropertyInfo idPropertySeedData = records[0].GetType().GetProperty("Id");

                    for (int i = seedDataTypes.Count - 1; i >= 0; i--)
                    {
                        string fullName = seedDataTypes[i].FullName;
                        if ((fullName == doNotFilterFullName1) || (fullName == doNotFilterFullName2)) continue;

                        // 删除重复数据
                        var instance = Activator.CreateInstance(seedDataTypes[i]);
                        var hasDataMethod = seedDataTypes[i].GetMethod("HasData");
                        var seedData = ((IEnumerable)hasDataMethod?.Invoke(instance, null))?.Cast<object>();
                        if (seedData == null) continue;

                        List<object> recordsToRemove = new();
                        foreach (var record in records)
                        {
                            object recordId = pkInfo.GetValue(record);
                            if (seedData.Select(d1 => idPropertySeedData.GetValue(d1)).Any(dataId => recordId != null && dataId != null && recordId.Equals(dataId)))
                            {
                                recordsToRemove.Add(record);
                            }
                        }
                        foreach (var itemToRemove in recordsToRemove)
                        {
                            records.Remove(itemToRemove);
                        }
                    }
                }
            }
        }

        // 检查有没有 System.Text.Json.Serialization.JsonIgnore 的属性
        // var jsonIgnoreProperties = entityType.GetProperties().Where(p => (p.GetAttribute<System.Text.Json.Serialization.JsonIgnoreAttribute>() != null ||
        //     p.GetAttribute<JsonIgnoreAttribute>() != null) && p.GetAttribute<SugarColumn>() != null).ToList();
        // var jsonIgnoreInfo = new List<List<JsonIgnoredPropertyData>>();
        // if (jsonIgnoreProperties.Count > 0)
        // {
        //     int recordIndex = 0;
        //     foreach (var r in (IEnumerable)records)
        //     {
        //         List<JsonIgnoredPropertyData> record = new();
        //         foreach (var item in jsonIgnoreProperties)
        //         {
        //             object v = item.GetValue(r);
        //             string strValue = "null";
        //             if (v != null)
        //             {
        //                 strValue = v.ToString();
        //                 if (v.GetType() == typeof(string))
        //                     strValue = "\"" + strValue + "\"";
        //                 else if (v.GetType() == typeof(DateTime))
        //                     strValue = "DateTime.Parse(\"" + ((DateTime)v).ToString("yyyy-MM-dd HH:mm:ss") + "\")";
        //             }
        //             record.Add(new JsonIgnoredPropertyData { RecordIndex = recordIndex, Name = item.Name, Value = strValue });
        //         }
        //         recordIndex++;
        //         jsonIgnoreInfo.Add(record);
        //     }
        // }

        // 获取所有字段信息
        var propertyList = entityType.GetProperties().Where(x => false == (x.GetCustomAttribute<SugarColumn>()?.IsIgnore ?? false)).ToList();
        for (var i = 0; i < propertyList.Count; i++)
        {
            if (propertyList[i].Name != nameof(EntityBaseId.Id) || !(propertyList[i].GetCustomAttribute<SugarColumn>()?.IsPrimaryKey ?? true)) continue;
            var temp = propertyList[i];
            for (var j = i; j > 0; j--) propertyList[j] = propertyList[j - 1];
            propertyList[0] = temp;
        }
        // 拼接数据
        var recordList = records.Select(obj => string.Join(", ", propertyList.Select(prop =>
        {
            var propType = Nullable.GetUnderlyingType(prop.PropertyType) ?? prop.PropertyType;
            object value = prop.GetValue(obj);
            if (value == null) value = "null";
            else if (propType == typeof(string))
            {
                value = $"@\"{value}\"";
            }
            else if (propType.IsEnum)
            {
                value = $"{propType.Name}.{value}";
            }
            else if (propType == typeof(bool))
            {
                value = (bool)value ? "true" : "false";
            }
            else if (propType == typeof(DateTime))
            {
                value = $"DateTime.Parse(\"{((DateTime)value):yyyy-MM-dd HH:mm:ss.fff}\")";
            }
            return $"{prop.Name}={value}";
        }))).ToList();

        var tContent = await File.ReadAllTextAsync(templatePath);
        var data = new
        {
            NameSpace = $"{input.Position}.SeedData",
            EntityNameSpace = entityType.Namespace,
            input.TableName,
            input.EntityName,
            input.SeedDataName,
            input.ConfigId,
            tableInfo.Description,
            // JsonIgnoreInfo = jsonIgnoreInfo,
            RecordList = recordList
        };
        var tResult = await _viewEngine.RunCompileAsync(tContent, data, builderAction: builder =>
        {
            builder.AddAssemblyReferenceByName("System.Linq");
            builder.AddAssemblyReferenceByName("System.Collections");
            builder.AddUsing("System.Collections.Generic");
            builder.AddUsing("System.Linq");
        });

        var targetPath = GetSeedDataTargetPath(input);
        await File.WriteAllTextAsync(targetPath, tResult, Encoding.UTF8);
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
                DbTableName = sugarAttribute == null ? c.Name : ((SugarTable)sugarAttribute).TableName,
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
    private static string GetEntityTargetPath(CreateEntityInput input)
    {
        var backendPath = Path.Combine(new DirectoryInfo(App.WebHostEnvironment.ContentRootPath).Parent.FullName, input.Position, "Entity");
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
        if (!Directory.Exists(backendPath))
            Directory.CreateDirectory(backendPath);
        return Path.Combine(backendPath, input.EntityName + ".cs");
    }

    /// <summary>
    /// 设置生成种子数据文件路径
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    private static string GetSeedDataTargetPath(CreateSeedDataInput input)
    {
        var backendPath = Path.Combine(new DirectoryInfo(App.WebHostEnvironment.ContentRootPath).Parent.FullName, input.Position, "SeedData");
        if (!Directory.Exists(backendPath))
            Directory.CreateDirectory(backendPath);
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
