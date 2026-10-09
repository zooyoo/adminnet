// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.Extensions.Options;
using NewLife.Caching;
using SqlSugar;
using System.Reflection;
using Xunit;

namespace Admin.NET.Test.Lang;

[CollectionDefinition("TranslationDatabase", DisableParallelization = true)]
public class TranslationDatabaseCollection;

[Collection("TranslationDatabase")]
public class TranslationLifecycleTests : IDisposable
{
    private readonly ITenant _previous = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _database;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-translation-{Guid.NewGuid():N}.db");
    private readonly MemoryCache _memory = new();
    private readonly SysLangTextCacheService _cache;
    private readonly SysLangTextService _service;

    public TranslationLifecycleTests()
    {
        _database = new SqlSugarScope(new ConnectionConfig
        {
            ConfigId = SqlSugarConst.MainConfigId, DbType = DbType.Sqlite,
            ConnectionString = $"Data Source={_file}", IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute,
            ConfigureExternalServices = new ConfigureExternalServices
            {
                EntityService = (property, column) =>
                {
                    if (new NullabilityInfoContext().Create(property).WriteState == NullabilityState.Nullable) column.IsNullable = true;
                }
            }
        });
        SqlSugarSetup.ITenant = _database;
        _database.CodeFirst.InitTables<SysLangText>();
        var repository = new SqlSugarRepository<SysLangText>();
        var cache = new SysCacheService(new CacheProvider { Cache = _memory }, Options.Create(new CacheOptions { Prefix = "lang-test:" }));
        _cache = new SysLangTextCacheService(cache, repository);
        _service = new SysLangTextService(repository, _cache, _database);
        _database.Insertable(new SysLangText { Id = 1, EntityName = "Fixture", EntityId = 10, FieldName = "Name", LangCode = "en", Content = "before" }).ExecuteCommand();
    }

    [Fact]
    public async Task BatchDelete_EmptySelection_PreservesAllRows()
    {
        await _service.BatchDelete(new List<DeleteSysLangTextInput>());
        Assert.Equal(1, _database.Queryable<SysLangText>().Count());
    }

    [Fact]
    public async Task Update_ChangedTranslationIdentity_InvalidatesOldCache()
    {
        Assert.Equal("before", await _cache.GetTranslation("Fixture", "Name", 10, "en"));
        await _service.Update(new UpdateSysLangTextInput { Id = 1, EntityName = "Fixture", EntityId = 10, FieldName = "Name", LangCode = "fr", Content = "after" });
        Assert.Null(await _cache.GetTranslation("Fixture", "Name", 10, "en"));
        Assert.Equal("after", await _cache.GetTranslation("Fixture", "Name", 10, "fr"));
    }

    [Fact]
    public async Task Update_MissingRecord_DoesNotPopulatePhantomTranslation()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _service.Update(new UpdateSysLangTextInput { Id = 99, EntityName = "Fixture", EntityId = 99, FieldName = "Name", LangCode = "en", Content = "phantom" }));
        Assert.Null(await _cache.GetTranslation("Fixture", "Name", 99, "en"));
    }

    [Fact]
    public async Task Add_ExistingTranslationIdentity_RejectsDuplicate()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _service.Add(new AddSysLangTextInput { EntityName = "Fixture", EntityId = 10, FieldName = "Name", LangCode = "en", Content = "duplicate" }));
        Assert.Equal(1, _database.Queryable<SysLangText>().Count());
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previous;
        _database.Dispose();
        _memory.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
