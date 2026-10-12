// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统代码生成配置服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 260)]
public class SysCodeGenConfigService : IDynamicApiController, ITransient
{
    private readonly ISqlSugarClient _db;

    public SysCodeGenConfigService(ISqlSugarClient db)
    {
        _db = db;
    }

    /// <summary>
    /// 获取代码生成配置列表 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取代码生成配置列表")]
    public async Task<List<CodeGenConfig>> GetList([FromQuery] CodeGenConfig input)
    {
        return await _db.Queryable<SysCodeGenConfig>()
            .Where(u => u.CodeGenId == input.CodeGenId)
            .Select<CodeGenConfig>()
            .Mapper(u =>
            {
                u.NetType = (u.EffectType == "EnumSelector" ? u.DictTypeCode : u.NetType);
                u.FkDisplayColumnList = u.FkDisplayColumns?.Split(",").ToList();
            })
            .OrderBy(u => new { u.OrderNo, u.Id })
            .ToListAsync();
    }

    /// <summary>
    /// 更新代码生成配置 🔖
    /// </summary>
    /// <param name="inputList"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新代码生成配置")]
    public async Task UpdateCodeGenConfig(List<CodeGenConfig> inputList)
    {
        var codeGenId = CodeGenConfigContracts.GetCodeGenId(inputList);
        var provider = _db.AsTenant().GetConnectionScope(SqlSugarConst.MainConfigId);
        await provider.Ado.BeginTranAsync();
        try
        {
            // 锁定主配置与当前字段，全部校验完成后才开始写入。
            var codeGen = await provider.Queryable<SysCodeGen>().TranLock(DbLockType.Wait).FirstAsync(row => row.Id == codeGenId);
            var existing = await provider.Queryable<SysCodeGenConfig>().Where(row => row.CodeGenId == codeGenId).TranLock(DbLockType.Wait).ToListAsync();
            var updates = CodeGenConfigContracts.BuildUpdates(codeGen, inputList, existing);
            foreach (var field in updates)
            {
                if (await CodeGenConfigContracts.CreateUpdate(provider, field).ExecuteCommandAsync() != 1)
                    throw Oops.Oh("字段配置已变化，请重新加载后保存");
            }
            await provider.Ado.CommitTranAsync();
        }
        catch
        {
            await provider.Ado.RollbackTranAsync();
            throw;
        }
    }

    /// <summary>
    /// 删除代码生成配置
    /// </summary>
    /// <param name="codeGenId"></param>
    /// <returns></returns>
    [NonAction]
    public async Task DeleteCodeGenConfig(long codeGenId)
    {
        await _db.Deleteable<SysCodeGenConfig>().Where(u => u.CodeGenId == codeGenId).ExecuteCommandAsync();
    }

    /// <summary>
    /// 获取代码生成配置详情 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取代码生成配置详情")]
    public async Task<SysCodeGenConfig> GetDetail([FromQuery] CodeGenConfig input)
    {
        return await _db.Queryable<SysCodeGenConfig>().FirstAsync(u => u.Id == input.Id);
    }

    /// <summary>
    /// 批量增加代码生成配置
    /// </summary>
    /// <param name="tableColumnOutputList"></param>
    /// <param name="codeGenerate"></param>
    [NonAction]
    public void AddList(List<ColumnOuput> tableColumnOutputList, SysCodeGen codeGenerate)
    {
        if (tableColumnOutputList == null) return;
        var fields = CodeGenConfigContracts.BuildSynchronizedFields(tableColumnOutputList, codeGenerate.Id, new List<SysCodeGenConfig>());
        // 多库代码生成的字段配置始终写入主库。
        var provider = _db.AsTenant().GetConnectionScope(SqlSugarConst.MainConfigId);
        provider.Insertable(fields).ExecuteCommand();
    }
    /// <summary>
    /// 同步实体字段，保留已有字段的全部用户选项与标识。
    /// </summary>
    /// <param name="tableColumnOutputList"></param>
    /// <param name="codeGenId"></param>
    [NonAction]
    public async Task UpdateList(List<ColumnOuput> tableColumnOutputList, long codeGenId)
    {
        // 调用方负责主库事务；读取原始实体，避免列表投影替换枚举的真实 .NET 类型。
        var provider = _db.AsTenant().GetConnectionScope(SqlSugarConst.MainConfigId);
        var existing = await provider.Queryable<SysCodeGenConfig>().Where(row => row.CodeGenId == codeGenId).TranLock(DbLockType.Wait).ToListAsync();
        var fields = CodeGenConfigContracts.BuildSynchronizedFields(tableColumnOutputList, codeGenId, existing);
        var retainedIds = fields.Where(field => field.Id > 0).Select(field => field.Id).ToHashSet();
        var removedIds = existing.Where(field => !retainedIds.Contains(field.Id)).Select(field => field.Id).ToList();
        if (removedIds.Count > 0)
        {
            if (await provider.Deleteable<SysCodeGenConfig>().Where(row => row.CodeGenId == codeGenId && removedIds.Contains(row.Id)).ExecuteCommandAsync() != removedIds.Count)
                throw Oops.Oh("字段配置已变化，请重新加载后同步");
        }
        foreach (var field in fields.Where(field => field.Id > 0))
        {
            if (await provider.Updateable(field).IgnoreColumns(row => new { row.CreateTime, row.CreateUserId, row.CreateUserName }).ExecuteCommandAsync() != 1)
                throw Oops.Oh("字段配置已变化，请重新加载后同步");
        }
        var added = fields.Where(field => field.Id == 0).ToList();
        if (added.Count > 0) await provider.Insertable(added).ExecuteCommandAsync();
    }
}
