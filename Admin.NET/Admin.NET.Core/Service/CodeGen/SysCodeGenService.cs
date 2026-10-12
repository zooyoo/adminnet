// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统代码生成器服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 270)]
public class SysCodeGenService : IDynamicApiController, ITransient
{
    private readonly ISqlSugarClient _db;

    private readonly SysCodeGenConfigService _codeGenConfigService;
    private readonly DbConnectionOptions _dbConnectionOptions;
    private readonly CodeGenOptions _codeGenOptions;
    private readonly SysMenuService _sysMenuService;
    private readonly IViewEngine _viewEngine;
    private readonly UserManager _userManager;

    public SysCodeGenService(ISqlSugarClient db,
        IOptions<DbConnectionOptions> dbConnectionOptions,
        SysCodeGenConfigService codeGenConfigService,
        IOptions<CodeGenOptions> codeGenOptions,
        SysMenuService sysMenuService,
        UserManager userManager,
        IViewEngine viewEngine)
    {
        _db = db;
        _viewEngine = viewEngine;
        _userManager = userManager;
        _sysMenuService = sysMenuService;
        _codeGenOptions = codeGenOptions.Value;
        _codeGenConfigService = codeGenConfigService;
        _dbConnectionOptions = dbConnectionOptions.Value;
    }

    /// <summary>
    /// 获取代码生成分页列表 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取代码生成分页列表")]
    public async Task<SqlSugarPagedList<SysCodeGen>> Page(CodeGenInput input)
    {
        return await _db.Queryable<SysCodeGen>()
            .WhereIF(!string.IsNullOrWhiteSpace(input.TableName), u => u.TableName.Contains(input.TableName.Trim()))
            .WhereIF(!string.IsNullOrWhiteSpace(input.BusName), u => u.BusName.Contains(input.BusName.Trim()))
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 增加代码生成 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加代码生成")]
    public async Task AddCodeGen(AddCodeGenInput input)
    {
        var isExist = await _db.Queryable<SysCodeGen>().Where(u => u.TableName == input.TableName).AnyAsync();
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D1400);

        if (input.TableUniqueList?.Count > 0) input.TableUniqueConfig = JSON.Serialize(input.TableUniqueList);

        // 先核验实体与数据库字段，避免无效实体留下没有字段的主配置。
        var columns = GetColumnList(input);
        var codeGen = input.Adapt<SysCodeGen>();
        try
        {
            _db.AsTenant().BeginTran();
            var newCodeGen = await _db.Insertable(codeGen).ExecuteReturnEntityAsync();
            _codeGenConfigService.AddList(columns, newCodeGen);
            _db.AsTenant().CommitTran();
        }
        catch
        {
            _db.AsTenant().RollbackTran();
            throw;
        }
    }

    /// <summary>
    /// 更新代码生成 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新代码生成")]
    public async Task UpdateCodeGen(UpdateCodeGenInput input)
    {
        if (input == null || input.Id <= 0) throw Oops.Oh("代码生成配置标识无效");
        var isExist = await _db.Queryable<SysCodeGen>().AnyAsync(u => u.TableName == input.TableName && u.Id != input.Id);
        if (isExist) throw Oops.Oh(ErrorCodeEnum.D1400);

        var oldRecord = await _db.Queryable<SysCodeGen>().FirstAsync(u => u.Id == input.Id)
            ?? throw Oops.Oh("代码生成配置不存在，请刷新后重试");
        try
        {
            // 开启事务
            _db.AsTenant().BeginTran();
            if (input.GenerateMenu)
            {
                var oldTitle = $"{oldRecord.BusName}";
                var newTitle = $"{input.BusName}";
                var updateObj = await _db.Queryable<SysMenu>().FirstAsync(u => u.Title == oldTitle);
                if (updateObj != null)
                {
                    updateObj.Title = newTitle;
                    var result = _db.Updateable(updateObj).UpdateColumns(it => new { it.Title }).ExecuteCommand();
                    _sysMenuService.DeleteMenuCache();
                }
            }
            if (input.TableUniqueList?.Count > 0) input.TableUniqueConfig = JSON.Serialize(input.TableUniqueList);
            var codeGen = input.Adapt<SysCodeGen>();
            await _db.Updateable(codeGen).ExecuteCommandAsync();

            // 仅当数据表名称发生了变化，才更新配置表
            //if (oldRecord.TableName != input.TableName)
            //{
            await _codeGenConfigService.DeleteCodeGenConfig(codeGen.Id);
            _codeGenConfigService.AddList(GetColumnList(input.Adapt<AddCodeGenInput>()), codeGen);
            //}
            _db.AsTenant().CommitTran();
        }
        catch (Exception ex)
        {
            _db.AsTenant().RollbackTran();
            throw Oops.Oh(ex);
        }
    }

    /// <summary>
    /// 同步代码字段(保留历史作用类型) 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "SyncField"), HttpPost]
    [DisplayName("同步代码字段")]
    public async Task SyncCodeFieldGen(UpdateCodeGenInput input)
    {
        if (input == null || input.Id <= 0) throw Oops.Oh("代码生成配置标识无效");
        try
        {
            _db.AsTenant().BeginTran();
            var provider = _db.AsTenant().GetConnectionScope(SqlSugarConst.MainConfigId);
            var codeGen = await provider.Queryable<SysCodeGen>().TranLock(DbLockType.Wait).FirstAsync(row => row.Id == input.Id)
                ?? throw Oops.Oh("代码生成配置不存在，请刷新后重试");
            if (input.TableName != codeGen.TableName || input.ConfigId != codeGen.ConfigId)
                throw Oops.Oh("实体或数据库与原配置不匹配，请刷新后重试");
            // 字段元数据只取已保存配置对应的真实实体，不能由同步请求切换归属。
            await _codeGenConfigService.UpdateList(GetColumnList(codeGen.Adapt<AddCodeGenInput>()), codeGen.Id);
            _db.AsTenant().CommitTran();
        }
        catch (Exception ex)
        {
            _db.AsTenant().RollbackTran();
            throw Oops.Oh(ex);
        }
    }

    /// <summary>
    /// 删除代码生成 🔖
    /// </summary>
    /// <param name="inputs"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除代码生成")]
    public async Task DeleteCodeGen(List<DeleteCodeGenInput> inputs)
    {
        if (inputs == null || inputs.Count < 1) return;

        var codeGenConfigTaskList = new List<Task>();
        inputs.ForEach(u =>
        {
            _db.Deleteable<SysCodeGen>().In(u.Id).ExecuteCommand();

            // 删除配置表
            codeGenConfigTaskList.Add(_codeGenConfigService.DeleteCodeGenConfig(u.Id));
        });
        await Task.WhenAll(codeGenConfigTaskList);
    }

    /// <summary>
    /// 获取代码生成详情 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取代码生成详情")]
    public async Task<SysCodeGen> GetDetail([FromQuery] QueryCodeGenInput input)
    {
        return await _db.Queryable<SysCodeGen>().SingleAsync(u => u.Id == input.Id);
    }

    /// <summary>
    /// 获取数据库库集合 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取数据库库集合")]
    public async Task<List<DatabaseOutput>> GetDatabaseList()
    {
        var dbConfigs = _dbConnectionOptions.ConnectionConfigs;
        return await Task.FromResult(dbConfigs.Adapt<List<DatabaseOutput>>());
    }

    /// <summary>
    /// 获取数据库表(实体)集合 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取数据库表(实体)集合")]
    public async Task<List<TableOutput>> GetTableList(string configId = SqlSugarConst.MainConfigId)
    {
        var provider = _db.AsTenant().GetConnectionScope(configId);
        var dbTableInfos = provider.DbMaintenance.GetTableInfoList(false); // 不能走缓存,否则切库不起作用
        var config = _dbConnectionOptions.ConnectionConfigs.FirstOrDefault(u => configId.Equals(u.ConfigId));

        // var dbTableNames = dbTableInfos.Select(u => u.Name.ToLower()).ToList();
        IEnumerable<EntityInfo> entityInfos = await GetEntityInfos(configId);

        var tableOutputList = new List<TableOutput>();
        foreach (var item in entityInfos)
        {
            var tbConfigId = item.Type.GetCustomAttribute<TenantAttribute>()?.configId as string ?? SqlSugarConst.MainConfigId;
            if (item.Type.IsDefined(typeof(LogTableAttribute))) tbConfigId = SqlSugarConst.LogConfigId;
            if (tbConfigId != configId) continue;

            var table = dbTableInfos.FirstOrDefault(u => string.Equals(u.Name, (config!.DbSettings.EnableUnderLine ? item.DbTableName.ToUnderLine() : item.DbTableName), StringComparison.CurrentCultureIgnoreCase));
            if (table == null) continue;
            tableOutputList.Add(new TableOutput
            {
                ConfigId = configId,
                EntityName = item.EntityName,
                TableName = table.Name,
                TableComment = item.TableDescription
            });
        }
        return tableOutputList;
    }

    /// <summary>
    /// 根据表名获取列集合 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("根据表名获取列集合")]
    public List<ColumnOuput> GetColumnListByTableName([Required] string tableName, string configId = SqlSugarConst.MainConfigId)
    {
        // 切库---多库代码生成用
        var provider = _db.AsTenant().GetConnectionScope(configId);
        var config = _dbConnectionOptions.ConnectionConfigs.FirstOrDefault(u => u.ConfigId.ToString() == configId) ?? throw Oops.Oh(ErrorCodeEnum.D1401);
        if (config.DbSettings.EnableUnderLine) tableName = tableName.ToUnderLine();
        // 获取实体类型属性
        var entityType = provider.DbMaintenance.GetTableInfoList(false).FirstOrDefault(u => u.Name == tableName);
        if (entityType == null) return null;
        var properties = GetEntityInfos(configId).Result.First(e => e.DbTableName.EndsWithIgnoreCase(tableName)).Type.GetProperties()
            .Where(e => e.GetCustomAttribute<SugarColumn>()?.IsIgnore == false).Select(e => new
            {
                PropertyName = e.Name,
                ColumnComment = e.GetCustomAttribute<SugarColumn>()?.ColumnDescription,
                ColumnName = e.GetCustomAttribute<SugarColumn>()?.ColumnName ?? e.Name
            }).ToList();
        // 按原始类型的顺序获取所有实体类型属性（不包含导航属性，会返回null）
        var columnList = provider.DbMaintenance.GetColumnInfosByTableName(tableName).Select(u => new ColumnOuput
        {
            ColumnName = config!.DbSettings.EnableUnderLine ? u.DbColumnName.ToUnderLine() : u.DbColumnName,
            ColumnKey = u.IsPrimarykey.ToString(),
            DataType = u.DataType.ToString(),
            NetType = CodeGenUtil.ConvertDataType(u, provider.CurrentConnectionConfig.DbType),
            ColumnComment = u.ColumnDescription
        }).ToList();
        foreach (var column in columnList)
        {
            // ToLowerInvariant 将字段名转成小写再比较，避免因大小写不一致导致无法匹配(pgsql创建表会默认全小写,而我们的实体中又是大写,就会匹配不上)
            var property = properties.FirstOrDefault(e => (config!.DbSettings.EnableUnderLine ? e.ColumnName.ToUnderLine() : e.ColumnName).ToLowerInvariant() == column.ColumnName.ToLowerInvariant());
            column.ColumnComment ??= property?.ColumnComment;
            column.PropertyName = property?.PropertyName;
        }
        return columnList;
    }

    /// <summary>
    /// 获取数据表列（实体属性）集合
    /// </summary>
    /// <returns></returns>
    private List<ColumnOuput> GetColumnList([FromQuery] AddCodeGenInput input)
    {
        var entityType = GetEntityInfos(input.ConfigId).GetAwaiter().GetResult().FirstOrDefault(u => u.EntityName == input.TableName);
        if (entityType == null) throw Oops.Oh("实体不存在或不可用于代码生成，请重新选择实体");

        var config = _dbConnectionOptions.ConnectionConfigs.FirstOrDefault(u => u.ConfigId.ToString() == input.ConfigId);
        var dbTableName = config!.DbSettings.EnableUnderLine ? entityType.DbTableName.ToUnderLine() : entityType.DbTableName;

        // 切库---多库代码生成用
        var provider = _db.AsTenant().GetConnectionScope(!string.IsNullOrEmpty(input.ConfigId) ? input.ConfigId : SqlSugarConst.MainConfigId);

        var entityBasePropertyNames = CodeGenUtil.GetPropertyInfoArray(typeof(EntityBaseTenant))?.Select(p => p.Name).ToArray();
        var columnInfos = provider.DbMaintenance.GetColumnInfosByTableName(dbTableName, false);
        var result = columnInfos.Select(u => new ColumnOuput
        {
            // 转下划线后的列名需要再转回来（暂时不转）
            //ColumnName = config.DbSettings.EnableUnderLine ? CodeGenUtil.CamelColumnName(u.DbColumnName, entityBasePropertyNames) : u.DbColumnName,
            ColumnName = u.DbColumnName,
            ColumnLength = u.Length,
            IsPrimarykey = u.IsPrimarykey,
            IsNullable = u.IsNullable,
            ColumnKey = u.IsPrimarykey.ToString(),
            NetType = CodeGenUtil.ConvertDataType(u, provider.CurrentConnectionConfig.DbType),
            DataType = CodeGenUtil.ConvertDataType(u, provider.CurrentConnectionConfig.DbType),
            ColumnComment = string.IsNullOrWhiteSpace(u.ColumnDescription) ? u.DbColumnName : u.ColumnDescription,
            DefaultValue = u.DefaultValue,
        }).ToList();

        // 获取实体的属性信息，赋值给PropertyName属性(CodeFirst模式应以PropertyName为实际使用名称)
        var entityProperties = entityType.Type.GetProperties();

        for (int i = result.Count - 1; i >= 0; i--)
        {
            var columnOutput = result[i];
            // 先找自定义字段名的，如果找不到就再找自动生成字段名的(并且过滤掉没有SugarColumn的属性)
            var propertyInfo = entityProperties.FirstOrDefault(u => string.Equals((u.GetCustomAttribute<SugarColumn>()?.ColumnName ?? ""), columnOutput.ColumnName, StringComparison.CurrentCultureIgnoreCase)) ??
                entityProperties.FirstOrDefault(u => u.GetCustomAttribute<SugarColumn>() != null && u.Name.ToLower() == (config.DbSettings.EnableUnderLine
                ? CodeGenUtil.CamelColumnName(columnOutput.ColumnName, entityBasePropertyNames).ToLower()
                : columnOutput.ColumnName.ToLower()));
            if (propertyInfo != null)
            {
                columnOutput.PropertyName = propertyInfo.Name;
                columnOutput.ColumnComment = propertyInfo.GetCustomAttribute<SugarColumn>()!.ColumnDescription;
                var propertyType = Nullable.GetUnderlyingType(propertyInfo.PropertyType);
                if (propertyInfo.PropertyType.IsEnum || (propertyType?.IsEnum ?? false))
                {
                    columnOutput.DictTypeCode = (propertyType ?? propertyInfo.PropertyType).Name;
                }
                else
                {
                    var dict = propertyInfo.GetCustomAttribute<DictAttribute>();
                    if (dict != null) columnOutput.DictTypeCode = dict.DictTypeCode;
                }
            }
            else
            {
                result.RemoveAt(i); // 移除没有定义此属性的字段
            }
        }
        return result;
    }

    /// <summary>
    /// 获取库表信息
    /// </summary>
    /// <returns></returns>
    private async Task<IEnumerable<EntityInfo>> GetEntityInfos(string configId)
    {
        var config = _dbConnectionOptions.ConnectionConfigs.FirstOrDefault(u => u.ConfigId.ToString() == configId) ?? throw Oops.Oh(ErrorCodeEnum.D1401);
        var entityInfos = new List<EntityInfo>();

        var type = typeof(SugarTable);
        var types = new List<Type>();
        if (_codeGenOptions.EntityAssemblyNames != null)
        {
            types = App.EffectiveTypes.Where(c => c.IsClass)
                .Where(c => _codeGenOptions.EntityAssemblyNames.Contains(c.Assembly.GetName().Name) || _codeGenOptions.EntityAssemblyNames.Any(name => c.Assembly.GetName().Name!.Contains(name)))
                .ToList();
        }

        Type[] cosType = types.Where(o => IsMyAttribute(Attribute.GetCustomAttributes(o, true))).ToArray();

        foreach (var ct in cosType)
        {
            var sugarAttribute = ct.GetCustomAttributes(type, true).FirstOrDefault();

            var description = "";
            var des = ct.GetCustomAttributes(typeof(DescriptionAttribute), true);
            if (des.Length > 0) description = ((DescriptionAttribute)des[0]).Description;

            var dbTableName = sugarAttribute == null || string.IsNullOrWhiteSpace(((SugarTable)sugarAttribute).TableName) ? ct.Name : ((SugarTable)sugarAttribute).TableName;
            if (config.DbSettings.EnableUnderLine) dbTableName = dbTableName.ToUnderLine();

            entityInfos.Add(new EntityInfo
            {
                EntityName = ct.Name,
                DbTableName = dbTableName,
                TableDescription = sugarAttribute == null ? description : ((SugarTable)sugarAttribute).TableDescription,
                Type = ct
            });
        }
        return await Task.FromResult(entityInfos);

        bool IsMyAttribute(Attribute[] o) => o.Any(a => a.GetType() == type);
    }

    /// <summary>
    /// 获取程序保存位置 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取程序保存位置")]
    public List<string> GetApplicationNamespaces()
    {
        return _codeGenOptions.BackendApplicationNamespaces;
    }

    /// <summary>
    /// 代码生成到本地 🔖
    /// </summary>
    /// <returns></returns>
    [UnitOfWork]
    [DisplayName("代码生成到本地")]
    public async Task<dynamic> RunLocal(SysCodeGen input)
    {
        var (saved, tableFieldList, plans, result) = await RenderTemplateAsync(input);
        var cancellationToken = App.HttpContext?.RequestAborted ?? CancellationToken.None;
        Task GenerateMenu() => saved.GenerateMenu
            ? AddOrUpdateMenu(saved.TableName!, saved.BusName!, saved.MenuPid ?? 0, saved.MenuIcon, saved.PagePath!, tableFieldList)
            : Task.CompletedTask;
        if (saved.GenerateType!.StartsWith('1'))
        {
            var archive = await CodeGenArtifacts.CreateArchiveAsync(App.WebHostEnvironment.WebRootPath, saved.TableName!, plans, result,
                GenerateMenu, cancellationToken);
            var request = App.HttpContext.Request;
            return new
            {
                url = $"{request.PathBase}/CodeGen/{archive.FileName}",
                manifest = archive.Manifest,
                sha256 = archive.Sha256
            };
        }

        throw Oops.Oh("直接生成需要先核对目标清单并确认覆盖，请使用直接生成入口");
    }

    /// <summary>获取代码生成预览，模板与下载清单保持一致。</summary>
    [DisplayName("获取代码生成预览")]
    public async Task<Dictionary<string, string>> Preview(SysCodeGen input)
    {
        var (_, _, _, result) = await RenderTemplateAsync(input);
        return result;
    }

    /// <summary>核对直接生成目标及已有文件摘要，不写入文件。</summary>
    [HttpPost]
    [DisplayName("核对代码直接生成清单")]
    public async Task<CodeGenDirectPlan> DirectPlan(BaseIdInput input)
    {
        var (saved, _, plans, result) = await RenderTemplateAsync(new SysCodeGen { Id = input.Id });
        if (!saved.GenerateType!.StartsWith('2')) throw Oops.Oh("当前配置不是直接生成类型，请保存生成配置后重试");
        var (backendRoot, projectRoot) = DirectRoots();
        return CodeGenDirectWriter.Inspect(backendRoot, projectRoot, plans, result, System.Text.Json.JsonSerializer.Serialize(saved));
    }

    /// <summary>仅发布已核对的文件清单；文件或菜单失败时整批恢复。</summary>
    [HttpPost]
    [DisplayName("代码直接生成")]
    public async Task<CodeGenDirectPlan> RunDirect(CodeGenDirectInput input)
    {
        var (saved, fields, plans, result) = await RenderTemplateAsync(new SysCodeGen { Id = input.Id });
        if (!saved.GenerateType!.StartsWith('2')) throw Oops.Oh("当前配置不是直接生成类型，请保存生成配置后重试");
        var (backendRoot, projectRoot) = DirectRoots();
        async Task CommitMenu()
        {
            var provider = _db.AsTenant().GetConnectionScope(SqlSugarConst.MainConfigId);
            await provider.Ado.BeginTranAsync();
            try
            {
                if (saved.GenerateMenu)
                    await AddOrUpdateMenu(saved.TableName!, saved.BusName!, saved.MenuPid ?? 0, saved.MenuIcon, saved.PagePath!, fields);
                await provider.Ado.CommitTranAsync();
            }
            catch { await provider.Ado.RollbackTranAsync(); throw; }
        }
        return await CodeGenDirectWriter.WriteAsync(backendRoot, projectRoot, plans, result, input.Fingerprint, input.Overwrite,
            CommitMenu, App.HttpContext?.RequestAborted ?? CancellationToken.None, System.Text.Json.JsonSerializer.Serialize(saved));
    }

    private (string BackendRoot, string ProjectRoot) DirectRoots()
    {
        var solutionRoot = Directory.GetParent(App.WebHostEnvironment.ContentRootPath)!.FullName;
        var repositoryRoot = Directory.GetParent(solutionRoot)!.FullName;
        var projectRoot = string.IsNullOrWhiteSpace(_codeGenOptions.ProjectRootPath)
            ? repositoryRoot : Path.GetFullPath(_codeGenOptions.ProjectRootPath, App.WebHostEnvironment.ContentRootPath);
        var backendRoot = string.IsNullOrWhiteSpace(_codeGenOptions.BackendRootPath)
            ? Path.Combine(projectRoot, "Admin.NET") : Path.GetFullPath(_codeGenOptions.BackendRootPath, solutionRoot);
        return (backendRoot, projectRoot);
    }

    /// <summary>只从已保存配置读取生成参数，不能借预览或下载请求替换目标。</summary>
    private async Task<(SysCodeGen saved, List<CodeGenConfig> fields)> LoadGenerationSourceAsync(SysCodeGen input)
    {
        if (input == null || input.Id <= 0) throw Oops.Oh("代码生成配置标识无效");
        var provider = _db.AsTenant().GetConnectionScope(SqlSugarConst.MainConfigId);
        var ownsTransaction = provider.Ado.Transaction == null;
        if (ownsTransaction) await provider.Ado.BeginTranAsync();
        try
        {
            var saved = await provider.Queryable<SysCodeGen>().TranLock(DbLockType.Wait).FirstAsync(row => row.Id == input.Id)
                ?? throw Oops.Oh("代码生成配置不存在，请刷新后重试");
            var fields = await _codeGenConfigService.GetList(new CodeGenConfig { CodeGenId = saved.Id });
            if (ownsTransaction) await provider.Ado.CommitTranAsync();
            return (saved, fields);
        }
        catch
        {
            if (ownsTransaction) await provider.Ado.RollbackTranAsync();
            throw;
        }
    }

    /// <summary>预览和生成共用已保存配置、选择的模板和输出键。</summary>
    private async Task<(SysCodeGen saved, List<CodeGenConfig> fields, IReadOnlyList<CodeGenArtifactPlan> plans, Dictionary<string, string> result)> RenderTemplateAsync(SysCodeGen input)
    {
        var (saved, tableFieldList) = await LoadGenerationSourceAsync(input);
        var plans = CodeGenArtifacts.CreatePlan(saved, _codeGenOptions.FrontRootPath);
        if (_codeGenOptions.BackendApplicationNamespaces?.Contains(saved.NameSpace!) != true)
            throw Oops.Oh("生成命名空间不在配置的应用列表中");
        if (tableFieldList.Count == 0 || tableFieldList.All(field => field.ColumnKey != "True"))
            throw Oops.Oh("代码生成字段或主键配置为空，请同步字段后重试");
        var entities = (await GetEntityInfos(saved.ConfigId!)).ToList();
        var matchingEntities = entities.Where(entity => entity.EntityName == saved.TableName).ToList();
        if (matchingEntities.Count != 1) throw Oops.Oh("代码生成实体不存在或名称重复，请重新选择实体");
        var entityType = matchingEntities[0].Type;
        var relatedNamespaces = new HashSet<string>(StringComparer.Ordinal) { entityType.Namespace! };
        foreach (var field in tableFieldList)
        {
            var property = entityType.GetProperty(field.PropertyName) ?? throw Oops.Oh("字段配置与当前实体不匹配，请同步字段后重试");
            field.NetType = CodeGenTemplateSupport.TypeName(property.PropertyType);
            var fieldType = Nullable.GetUnderlyingType(property.PropertyType) ?? property.PropertyType;
            if (fieldType.Namespace != null && fieldType.Namespace != "System") relatedNamespaces.Add(fieldType.Namespace);
            if (field.EffectType is not ("ForeignKey" or "ApiTreeSelector")) continue;
            var foreignEntities = entities;
            if (!string.IsNullOrWhiteSpace(field.FkConfigId) && field.FkConfigId != saved.ConfigId)
                foreignEntities = (await GetEntityInfos(field.FkConfigId)).ToList();
            var foreignEntity = foreignEntities.FirstOrDefault(entity => entity.EntityName == field.FkEntityName)
                ?? throw Oops.Oh($"字段 {field.PropertyName} 的关联实体不存在");
            if (foreignEntity.Type.GetProperty(field.FkLinkColumnName ?? "") == null || field.FkDisplayColumnList?.Count == 0 ||
                field.FkDisplayColumnList == null || field.FkDisplayColumnList.Any(name => foreignEntity.Type.GetProperty(name) == null) ||
                field.EffectType == "ApiTreeSelector" && foreignEntity.Type.GetProperty(field.PidColumn ?? "") == null)
                throw Oops.Oh($"字段 {field.PropertyName} 的关联字段配置无效");
            field.FkEntityName = "global::" + foreignEntity.Type.FullName!.Replace('+', '.');
            relatedNamespaces.Add(foreignEntity.Type.Namespace!);
        }
        var uniqueConfigs = saved.TableUniqueList ?? new();
        if (uniqueConfigs.Any(config => config.Columns == null || config.Columns.Count == 0 || config.Columns.Any(name => entityType.GetProperty(name) == null)))
            throw Oops.Oh("唯一约束字段配置与当前实体不匹配");
        var data = new CodeGenRenderModel
        {
            ConfigId = saved.ConfigId,
            BusName = saved.BusName,
            PagePath = saved.PagePath,
            NameSpace = saved.NameSpace,
            EntityNamespace = entityType.Namespace,
            EntityNamespaces = relatedNamespaces.Where(name => !string.IsNullOrWhiteSpace(name)).OrderBy(name => name).ToArray(),
            ClassName = saved.TableName,
            PrintType = saved.PrintType,
            PrintName = saved.PrintName,
            AuthorName = saved.AuthorName,
            ProjectLastName = saved.NameSpace!.Split('.').Last(),
            LowerClassName = saved.TableName!.ToFirstLetterLowerCase(),
            TableUniqueConfigList = uniqueConfigs,
            TableField = tableFieldList,
            QueryWhetherList = tableFieldList.Where(field => field.WhetherQuery == "Y").ToList(),
            ImportFieldList = tableFieldList.Where(field => field.WhetherImport == "Y").ToList(),
            UploadFieldList = tableFieldList.Where(field => field.EffectType is "Upload" or "Upload_SingleFile").ToList(),
            PrimaryKeyFieldList = tableFieldList.Where(field => field.ColumnKey == "True").ToList(),
            AddUpdateFieldList = tableFieldList.Where(field => field.WhetherAddUpdate == "Y").ToList(),
            ApiTreeFieldList = tableFieldList.Where(field => field.EffectType == "ApiTreeSelector").ToList(),
            DropdownFieldList = tableFieldList.Where(field => field.EffectType is "ForeignKey" or "ApiTreeSelector").ToList(),
            DefaultValueList = tableFieldList.Where(field => !string.IsNullOrEmpty(field.DefaultValue)).ToList(),
            HasJoinTable = tableFieldList.Any(field => field.EffectType is "ForeignKey" or "ApiTreeSelector"),
            HasDictField = tableFieldList.Any(field => field.EffectType == "DictSelector"),
            HasEnumField = tableFieldList.Any(field => field.EffectType == "EnumSelector"),
            HasConstField = tableFieldList.Any(field => field.EffectType == "ConstSelector"),
            HasLikeQuery = tableFieldList.Any(field => field.WhetherQuery == "Y" && field.QueryType == "like")
        };
        var templateRoot = Path.Combine(App.WebHostEnvironment.WebRootPath, "template");
        // 缺模板先整体失败，不能静默下载不完整结果。
        var sources = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var plan in plans)
        {
            var path = CodeGenArtifacts.ResolveUnderRoot(templateRoot, plan.Template + ".vm");
            if (!File.Exists(path)) throw Oops.Oh($"代码生成模板缺失：{plan.Template}.vm");
            sources[plan.Template] = await File.ReadAllTextAsync(path, Encoding.UTF8, App.HttpContext?.RequestAborted ?? CancellationToken.None);
        }
        var result = new Dictionary<string, string>(StringComparer.Ordinal);
        foreach (var plan in plans)
        {
            var content = await CodeGenTemplateSupport.RenderAsync(_viewEngine, sources[plan.Template], data);
            if (string.IsNullOrWhiteSpace(content)) throw Oops.Oh($"代码生成模板结果为空：{plan.Template}");
            result.Add(plan.Template, content);
        }
        return (saved, tableFieldList, plans, result);
    }
    /// <summary>
    /// 添加或更新菜单
    /// </summary>
    /// <param name="className"></param>
    /// <param name="busName"></param>
    /// <param name="pid"></param>
    /// <param name="menuIcon"></param>
    /// <param name="pagePath"></param>
    /// <param name="tableFieldList"></param>
    /// <returns></returns>
    private async Task AddOrUpdateMenu(string className, string busName, long pid, string menuIcon, string pagePath, List<CodeGenConfig> tableFieldList)
    {
        var title = $"{busName}";
        var lowerClassName = className.ToFirstLetterLowerCase();
        if (pid == 0)
        {
            var directory = await _db.Queryable<SysMenu>().FirstAsync(menu => menu.Pid == 0 && menu.Type == MenuTypeEnum.Dir && menu.Title == title);
            if (directory == null)
                pid = await _sysMenuService.AddMenu(new AddMenuInput { Pid = 0, Title = title, Type = MenuTypeEnum.Dir, Icon = "robot", Path = "/" + className.ToLowerInvariant(), Component = "Layout" });
            else pid = directory.Id;
        }
        var menuType = MenuTypeEnum.Menu;

        // 查询是否已有主菜单
        var existingMenu = await _db.Queryable<SysMenu>()
            .Where(m => m.Title == title && m.Type == menuType && m.Pid == pid)
            .FirstAsync();

        string parentPath = "";
        if (pid != 0)
        {
            var parent = await _db.Queryable<SysMenu>().FirstAsync(m => m.Id == pid) ?? throw Oops.Oh(ErrorCodeEnum.D1505);
            parentPath = parent.Path;
        }

        long menuId;
        if (existingMenu == null)
        {
            // 不存在则新增
            var newMenu = new SysMenu
            {
                Pid = pid,
                Title = title,
                Type = menuType,
                Icon = menuIcon ?? "menu",
                Path = (pid == 0 ? "/" : parentPath + "/") + className.ToLower(),
                Component = pid == 0 ? "Layout" : $"/{pagePath}/{lowerClassName}/index"
            };
            menuId = await _sysMenuService.AddMenu(newMenu.Adapt<AddMenuInput>());
        }
        else
        {
            // 存在则更新
            existingMenu.Icon = menuIcon;
            existingMenu.Path = (pid == 0 ? "/" : parentPath + "/") + className.ToLower();
            existingMenu.Component = pid == 0 ? "Layout" : $"/{pagePath}/{lowerClassName}/index";
            await _sysMenuService.UpdateMenu(existingMenu.Adapt<UpdateMenuInput>());
            menuId = existingMenu.Id;
        }

        // 定义应有的按钮
        var orderNo = 100;
        var newButtons = new List<SysMenu>
    {
        new() { Title = "查询", Permission = $"{lowerClassName}:page", OrderNo = orderNo += 10 },
        new() { Title = "详情", Permission = $"{lowerClassName}:detail", OrderNo = orderNo += 10 },
        new() { Title = "增加", Permission = $"{lowerClassName}:add", OrderNo = orderNo += 10 },
        new() { Title = "编辑", Permission = $"{lowerClassName}:update", OrderNo = orderNo += 10 },
        new() { Title = "删除", Permission = $"{lowerClassName}:delete", OrderNo = orderNo += 10 },
        new() { Title = "批量删除", Permission = $"{lowerClassName}:batchDelete", OrderNo = orderNo += 10 },
        new() { Title = "设置状态", Permission = $"{lowerClassName}:setStatus", OrderNo = orderNo += 10 },
        new() { Title = "打印", Permission = $"{lowerClassName}:print", OrderNo = orderNo += 10 },
        new() { Title = "导入", Permission = $"{lowerClassName}:import", OrderNo = orderNo += 10 },
        new() { Title = "导出", Permission = $"{lowerClassName}:export", OrderNo = orderNo += 10 }
    };

        if (tableFieldList.Any(u => u.EffectType is "ForeignKey" or "ApiTreeSelector" && (u.WhetherAddUpdate == "Y" || u.WhetherQuery == "Y")))
        {
            newButtons.Add(new SysMenu
            {
                Title = "下拉列表数据",
                Permission = $"{lowerClassName}:dropdownData",
                OrderNo = orderNo += 10
            });
        }

        foreach (var column in tableFieldList.Where(u => u.EffectType == "Upload" || u.EffectType == "Upload_SingleFile"))
        {
            newButtons.Add(new SysMenu
            {
                Title = $"上传{column.ColumnComment}",
                Permission = $"{lowerClassName}:upload{column.PropertyName}",
                OrderNo = orderNo += 10
            });
        }

        // 获取当前菜单下的按钮
        var existingButtons = await _db.Queryable<SysMenu>()
            .Where(m => m.Pid == menuId && m.Type == MenuTypeEnum.Btn)
            .ToListAsync();


        // 添加或更新按钮
        foreach (var btn in newButtons)
        {
            var match = existingButtons.FirstOrDefault(b => b.Permission == btn.Permission);
            if (match == null)
            {
                btn.Type = MenuTypeEnum.Btn;
                btn.Pid = menuId;
                btn.Icon = "";
                await _sysMenuService.AddMenu(btn.Adapt<AddMenuInput>());
            }
            else
            {
                match.Title = btn.Title;
                match.OrderNo = btn.OrderNo;
                await _sysMenuService.UpdateMenu(match.Adapt<UpdateMenuInput>());
            }
        }

        // 保留既有按钮及角色、租户、用户授权；生成器不删除人工添加的权限。
    }

    /// <summary>
    /// 增加菜单
    /// </summary>
    /// <param name="className"></param>
    /// <param name="busName"></param>
    /// <param name="pid"></param>
    /// <param name="menuIcon"></param>
    /// <param name="pagePath"></param>
    /// <param name="tableFieldList"></param>
    /// <returns></returns>
    private async Task AddMenu(string className, string busName, long pid, string menuIcon, string pagePath, List<CodeGenConfig> tableFieldList)
    {
        // 删除已存在的菜单
        var title = $"{busName}";
        await DeleteMenuTree(title, pid == 0 ? MenuTypeEnum.Dir : MenuTypeEnum.Menu);

        var parentMenuPath = "";
        var lowerClassName = className!.ToFirstLetterLowerCase();
        if (pid == 0)
        {
            // 新增目录，并记录Id
            var dirMenu = new SysMenu { Pid = 0, Title = title, Type = MenuTypeEnum.Dir, Icon = "robot", Path = "/" + className.ToLower(), Component = "Layout" };
            pid = await _sysMenuService.AddMenu(dirMenu.Adapt<AddMenuInput>());
        }
        else
        {
            var parentMenu = await _db.Queryable<SysMenu>().FirstAsync(u => u.Id == pid) ?? throw Oops.Oh(ErrorCodeEnum.D1505);
            parentMenuPath = parentMenu.Path;
        }

        // 新增菜单，并记录Id
        var rootMenu = new SysMenu { Pid = pid, Title = title, Type = MenuTypeEnum.Menu, Icon = menuIcon, Path = $"{parentMenuPath}/{className.ToLower()}", Component = $"/{pagePath}/{lowerClassName}/index" };
        pid = await _sysMenuService.AddMenu(rootMenu.Adapt<AddMenuInput>());

        var orderNo = 100;
        var menuList = new List<SysMenu>
        {
            new() { Title="查询", Permission=$"{lowerClassName}:page", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="详情", Permission=$"{lowerClassName}:detail", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="增加", Permission=$"{lowerClassName}:add", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="编辑", Permission=$"{lowerClassName}:update", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="删除", Permission=$"{lowerClassName}:delete", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="批量删除", Permission=$"{lowerClassName}:batchDelete", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="设置状态", Permission=$"{lowerClassName}:setStatus", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="打印", Permission=$"{lowerClassName}:print", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="导入", Permission=$"{lowerClassName}:import", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10},
            new() { Title="导出", Permission=$"{lowerClassName}:export", Pid=pid, Type=MenuTypeEnum.Btn, OrderNo=orderNo+=10}
        };

        if (tableFieldList.Any(u => u.EffectType is "ForeignKey" or "ApiTreeSelector" && (u.WhetherAddUpdate == "Y" || u.WhetherQuery == "Y")))
            menuList.Add(new SysMenu { Title = "下拉列表数据", Permission = $"{lowerClassName}:dropdownData", Pid = pid, Type = MenuTypeEnum.Btn, OrderNo = orderNo += 10 });

        foreach (var column in tableFieldList.Where(u => u.EffectType == "Upload"))
            menuList.Add(new SysMenu { Title = $"上传{column.ColumnComment}", Permission = $"{lowerClassName}:upload{column.PropertyName}", Pid = pid, Type = MenuTypeEnum.Btn, OrderNo = orderNo += 10 });

        foreach (var menu in menuList) await _sysMenuService.AddMenu(menu.Adapt<AddMenuInput>());
    }

    /// <summary>
    /// 根据菜单名称和类型删除关联的菜单树
    /// </summary>
    /// <param name="title"></param>
    /// <param name="type"></param>
    private async Task DeleteMenuTree(string title, MenuTypeEnum type)
    {
        var menuList = await _db.Queryable<SysMenu>().Where(u => u.Title == title && u.Type == type).ToListAsync() ?? new();
        foreach (var menu in menuList) await _sysMenuService.DeleteMenu(new DeleteMenuInput { Id = menu.Id });
    }

}
