// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using NewLife.Caching;
using SqlSugar;
using System.Reflection;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.Dict;

[CollectionDefinition("DictionaryDatabase", DisableParallelization = true)]
public class DictionaryDatabaseCollection;

[Collection("DictionaryDatabase")]
public class DictionaryConfigTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _database;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-dict-{Guid.NewGuid():N}.db");
    private readonly SysCacheService _cache;
    private readonly MemoryCache _memory = new();

    public DictionaryConfigTests()
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
        _cache = new SysCacheService(new CacheProvider { Cache = _memory }, Options.Create(new CacheOptions { Prefix = $"dict:{Guid.NewGuid():N}:" }));
        _database.CodeFirst.InitTables<SysDictType, SysDictData, SysDictDataTenant, SysConfig, SysTenantConfig>();
        _database.CodeFirst.InitTables<SysTenantConfigData>();
    }

    private static UserManager User(long tenantId, AccountTypeEnum type = AccountTypeEnum.SuperAdmin)
    {
        ClaimsIdentity identity = new(new[]
        {
            new Claim(ClaimConst.UserId, "42"), new Claim(ClaimConst.TenantId, tenantId.ToString()),
            new Claim(ClaimConst.AccountType, ((int)type).ToString())
        }, "Test");
        return new UserManager(new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } });
    }

    private SysDictDataService Data(long tenantId = 1, AccountTypeEnum type = AccountTypeEnum.SuperAdmin) =>
        new(new SqlSugarRepository<SysDictData>(), _cache, User(tenantId, type), null);
    private SysDictTypeService Types(AccountTypeEnum type = AccountTypeEnum.SuperAdmin) =>
        new(new SqlSugarRepository<SysDictType>(), Data(1, type), _cache, User(1, type), null);
    private SysTenantConfigService TenantConfig(long tenantId = 1) =>
        new(_cache, new SqlSugarRepository<SysTenantConfig>(), new SqlSugarRepository<SysTenantConfigData>(), User(tenantId));
    private SysConfigService Config() =>
        new(new SqlSugarRepository<SysTenant>(), new SqlSugarRepository<SysConfig>(), _cache, User(1));

    private void SeedDictionary()
    {
        _database.Insertable(new SysDictType { Id = 10, Name = "共享类型", Code = "shared", IsTenant = YesNoEnum.Y, SysFlag = YesNoEnum.N }).ExecuteCommand();
        _database.Insertable(new[]
        {
            new SysDictDataTenant { Id = 11, DictTypeId = 10, TenantId = 1, Label = "租户一", Value = "a" },
            new SysDictDataTenant { Id = 12, DictTypeId = 10, TenantId = 2, Label = "租户二", Value = "b" }
        }).ExecuteCommand();
    }

    [Fact]
    public async Task GetDataList_TwoTenantSessions_CachesSeparately()
    {
        SeedDictionary();
        Assert.Equal("a", Assert.Single(await Data(1).GetDataList("shared")).Value);
        Assert.Equal("b", Assert.Single(await Data(2).GetDataList("shared")).Value);
    }

    [Fact]
    public async Task SetStatus_PartialInput_PreservesDictionaryFields()
    {
        SeedDictionary();
        await Data().SetStatus(new DictDataInput { Id = 11, Status = StatusEnum.Disable });
        SysDictDataTenant stored = _database.Queryable<SysDictDataTenant>().InSingle(11);
        Assert.Equal(10, stored.DictTypeId);
        Assert.Equal("租户一", stored.Label);
        Assert.Equal("a", stored.Value);
        Assert.Equal(StatusEnum.Disable, stored.Status);
    }

    [Fact]
    public async Task UpdateDictData_ForgedParent_RejectsAndPreservesBuiltin()
    {
        _database.Insertable(new[]
        {
            new SysDictType { Id = 10, Name = "内置", Code = "builtin", IsTenant = YesNoEnum.N, SysFlag = YesNoEnum.Y },
            new SysDictType { Id = 20, Name = "普通", Code = "custom", IsTenant = YesNoEnum.N, SysFlag = YesNoEnum.N }
        }).ExecuteCommand();
        _database.Insertable(new SysDictData { Id = 11, DictTypeId = 10, Label = "内置值", Value = "a" }).ExecuteCommand();
        await Assert.ThrowsAnyAsync<Exception>(() => Data(1, AccountTypeEnum.SysAdmin).UpdateDictData(
            new UpdateDictDataInput { Id = 11, DictTypeId = 20, Label = "伪造", Value = "b" }));
        Assert.Equal(10, _database.Queryable<SysDictData>().InSingle(11).DictTypeId);
    }

    [Fact]
    public async Task DeleteDictType_TenantType_DeletesValuesBeforeTypeAndInvalidatesCache()
    {
        SeedDictionary();
        await Data().GetDataList("shared");
        await Types().DeleteDictType(new DeleteDictTypeInput { Id = 10 });
        Assert.Empty(_database.Queryable<SysDictDataTenant>().ToList());
        Assert.Empty(await Data().GetDataList("shared"));
    }

    private void SeedConfig()
    {
        _database.Insertable(new SysTenantConfig { Id = 20, Name = "租户参数", Code = "same", SysFlag = YesNoEnum.N }).ExecuteCommand();
        _database.Insertable(new[]
        {
            new SysTenantConfigData { Id = 21, ConfigId = 20, TenantId = 1, Value = "one" },
            new SysTenantConfigData { Id = 22, ConfigId = 20, TenantId = 2, Value = "two" }
        }).ExecuteCommand();
    }

    [Fact]
    public async Task GetConfigValue_ExplicitTenant_QueriesRequestedTenant()
    {
        SeedConfig();
        Assert.Equal("two", await TenantConfig(1).GetConfigValueByCode<string>("same", 2));
        Assert.Equal("one", await TenantConfig(1).GetConfigValueByCode("same"));
        Assert.Equal("two", await TenantConfig(2).GetConfigValueByCode("same"));
    }

    [Fact]
    public async Task UpdateConfig_SuperAdminCurrentTenant_DoesNotChangeOtherTenantValue()
    {
        SeedConfig();
        await TenantConfig(2).UpdateConfig(new UpdateConfigInput { Id = 20, Name = "租户参数", Code = "same", SysFlag = YesNoEnum.N, Value = "edited" });
        Assert.Equal("one", _database.Queryable<SysTenantConfigData>().InSingle(21).Value);
        Assert.Equal("edited", _database.Queryable<SysTenantConfigData>().InSingle(22).Value);
    }

    [Fact]
    public async Task UpdateConfig_RenamedCode_InvalidatesOldAndNewCache()
    {
        _database.Insertable(new SysConfig { Id = 30, Name = "参数", Code = "before", Value = "old", SysFlag = YesNoEnum.N }).ExecuteCommand();
        Assert.Equal("old", await Config().GetConfigValueByCode("before"));
        await Config().UpdateConfig(new UpdateConfigInput { Id = 30, Name = "参数", Code = "after", Value = "new", SysFlag = YesNoEnum.N });
        Assert.Null(await Config().GetConfigValueByCode("before"));
        Assert.Equal("new", await Config().GetConfigValueByCode("after"));
    }

    [Fact]
    public async Task UpdateConfig_TenantDefinitionRename_InvalidatesAllTenantValues()
    {
        SeedConfig();
        Assert.Equal("two", await TenantConfig(2).GetConfigValueByCode("same"));
        await TenantConfig().UpdateConfig(new UpdateConfigInput { Id = 20, Name = "租户参数", Code = "renamed", SysFlag = YesNoEnum.N, Value = "changed" });
        Assert.Null(await TenantConfig(2).GetConfigValueByCode("same"));
        Assert.Equal("two", await TenantConfig(2).GetConfigValueByCode("renamed"));
    }

    [Fact]
    public async Task DeleteConfig_SharedDefinition_RemovesAllValuesAndCaches()
    {
        SeedConfig();
        await TenantConfig(2).GetConfigValueByCode("same");
        await TenantConfig().DeleteConfig(new DeleteConfigInput { Id = 20 });
        Assert.Empty(_database.Queryable<SysTenantConfigData>().ToList());
        Assert.Null(await TenantConfig(2).GetConfigValueByCode("same"));
    }

    [Fact]
    public async Task GetConfigValue_TenantCodeBoundary_DoesNotCollide()
    {
        _database.Insertable(new[]
        {
            new SysTenantConfig { Id = 20, Name = "第一项", Code = "23", SysFlag = YesNoEnum.N },
            new SysTenantConfig { Id = 30, Name = "第二项", Code = "3", SysFlag = YesNoEnum.N }
        }).ExecuteCommand();
        _database.Insertable(new[]
        {
            new SysTenantConfigData { Id = 21, ConfigId = 20, TenantId = 1, Value = "first" },
            new SysTenantConfigData { Id = 31, ConfigId = 30, TenantId = 12, Value = "second" }
        }).ExecuteCommand();
        Assert.Equal("first", await TenantConfig(1).GetConfigValueByCode("23"));
        Assert.Equal("second", await TenantConfig(12).GetConfigValueByCode("3"));
    }

    [Fact]
    public async Task GetDataList_ModifiedResponse_DoesNotMutateCachedValue()
    {
        SeedDictionary();
        var first = await Data().GetDataList("shared");
        first[0].Label = "外部改写";
        Assert.Equal("租户一", (await Data().GetDataList("shared"))[0].Label);
    }

    [Theory]
    [InlineData("特殊/&?%2F+", "特殊/&?/+")]
    [InlineData("a%20b", "a b")]
    public void CacheRoute_EncodedKey_DecodesOnceAndPreservesNeighbor(string key, string neighbor)
    {
        HttpContextAccessor accessor = new() { HttpContext = new DefaultHttpContext() };
        SysCacheService cache = new(new CacheProvider { Cache = _memory },
            Options.Create(new CacheOptions { Prefix = "route:" }), accessor);
        cache.Set(key, "selected");
        cache.Set(neighbor, "neighbor");
        var request = new Microsoft.AspNetCore.Http.Features.HttpRequestFeature
        {
            RawTarget = "/api/sysCache/value/" + Uri.EscapeDataString(key)
        };
        accessor.HttpContext.Features.Set<Microsoft.AspNetCore.Http.Features.IHttpRequestFeature>(request);
        Assert.Equal("selected", cache.GetValue(Uri.EscapeDataString(key)));
        request.RawTarget = "/api/sysCache/delete/" + Uri.EscapeDataString(key);
        Assert.Equal(1, cache.Remove(Uri.EscapeDataString(key)));
        Assert.Null(cache.Get<string>(key));
        Assert.Equal("neighbor", cache.Get<string>(neighbor));
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previousTenant;
        _database.Dispose();
        _memory.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
