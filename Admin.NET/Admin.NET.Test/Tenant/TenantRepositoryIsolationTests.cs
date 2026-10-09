// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Microsoft.AspNetCore.Http;
using SqlSugar;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.Tenant;

public class TenantRepositoryIsolationTests : IDisposable
{
    private readonly SqlSugarScope _database;
    private readonly string _prefix = Path.Combine(AppContext.BaseDirectory, $"adminnet-tenant-repository-{Guid.NewGuid():N}");
    private readonly string[] _configIds = [SqlSugarConst.MainConfigId, "2", "3"];

    public TenantRepositoryIsolationTests()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(_prefix)!);
        _database = new SqlSugarScope(_configIds.Select(id => new ConnectionConfig
        {
            ConfigId = id,
            DbType = DbType.Sqlite,
            ConnectionString = $"Data Source={_prefix}-{id}.db",
            IsAutoCloseConnection = true,
            InitKeyType = InitKeyType.Attribute
        }).ToList());
        try
        {
            foreach (var id in _configIds)
            {
                using (var file = new Microsoft.Data.Sqlite.SqliteConnection($"Data Source={_prefix}-{id}.db"))
                {
                    file.Open();
                }
                var connection = _database.GetConnectionScope(id);
                connection.CodeFirst.InitTables<TenantBusinessProbe>();
                connection.Insertable(new TenantBusinessProbe { Id = 1, Value = $"database-{id}" }).ExecuteCommand();
            }
        }
        catch (Exception exception)
        {
            Dispose();
            throw new InvalidOperationException($"SQLite fixture could not open {_prefix}; directory exists: {Directory.Exists(Path.GetDirectoryName(_prefix))}", exception);
        }
    }

    private ProbeRepository Repository(string tenantId, string header = null, bool superAdmin = false)
    {
        var context = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimConst.TenantId, tenantId),
                new Claim(ClaimConst.AccountType, ((int)(superAdmin ? AccountTypeEnum.SuperAdmin : AccountTypeEnum.SysAdmin)).ToString())
            ], "Test"))
        };
        if (header != null) context.Request.Headers[ClaimConst.TenantId] = header;
        return new ProbeRepository(_database, context, id => _database.GetConnectionScope(id.ToString()));
    }

    [Fact]
    public async Task BusinessRepository_TwoTenantIdentities_ReadAndWriteTheirOwnDatabase()
    {
        var first = Repository("2");
        var second = Repository("3");
        Assert.Equal("database-2", (await first.GetByIdAsync(1)).Value);
        Assert.Equal("database-3", (await second.GetByIdAsync(1)).Value);
        await first.UpdateAsync(new TenantBusinessProbe { Id = 1, Value = "updated-only-2" });
        await second.InsertAsync(new TenantBusinessProbe { Id = 2, Value = "created-only-3" });
        Assert.Equal("updated-only-2", (await first.GetByIdAsync(1)).Value);
        Assert.Equal("database-3", (await second.GetByIdAsync(1)).Value);
        Assert.Null(await first.GetByIdAsync(2));
        Assert.Equal("created-only-3", (await second.GetByIdAsync(2)).Value);
        var main = _database.GetConnectionScope(SqlSugarConst.MainConfigId);
        Assert.Equal(1, await main.Queryable<TenantBusinessProbe>().CountAsync());
        Assert.Equal($"database-{SqlSugarConst.MainConfigId}", (await main.Queryable<TenantBusinessProbe>().InSingleAsync(1)).Value);
    }

    [Theory]
    [InlineData("3")]
    [InlineData("1300000000001")]
    [InlineData("invalid")]
    public async Task BusinessRepository_ForgedTenantHeader_RejectsBeforeAnyDatabaseWrite(string header)
    {
        Assert.ThrowsAny<Exception>(() => Repository("2", header));
        foreach (var id in _configIds)
        {
            var rows = await _database.GetConnectionScope(id).Queryable<TenantBusinessProbe>().ToListAsync();
            Assert.Single(rows);
            Assert.Equal($"database-{id}", rows[0].Value);
        }
    }

    [Fact]
    public async Task BusinessRepository_MatchingHeaderAndExplicitSuperAdminScope_SelectExpectedDatabase()
    {
        Assert.Equal("database-2", (await Repository("2", "2").GetByIdAsync(1)).Value);
        Assert.Equal("database-3", (await Repository("2", "3", true).GetByIdAsync(1)).Value);
        Assert.Equal($"database-{SqlSugarConst.MainConfigId}", (await Repository(SqlSugarConst.MainConfigId).GetByIdAsync(1)).Value);
    }

    public void Dispose()
    {
        _database.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        foreach (var id in _configIds)
        {
            var file = $"{_prefix}-{id}.db";
            if (File.Exists(file)) File.Delete(file);
        }
    }

    private sealed class ProbeRepository(ITenant tenant, HttpContext context, Func<long, SqlSugarScopeProvider> resolve)
        : SqlSugarRepository<TenantBusinessProbe>(tenant, () => context, resolve);
}

[SugarTable("TenantBusinessProbe")]
public class TenantBusinessProbe
{
    [SugarColumn(IsPrimaryKey = true)]
    public long Id { get; set; }
    public string Value { get; set; }
}
