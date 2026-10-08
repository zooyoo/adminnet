// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Http;
using SqlSugar;
using System.Reflection;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.Pos;

[CollectionDefinition("PositionDatabase", DisableParallelization = true)]
public class PositionDatabaseCollection;

[Collection("PositionDatabase")]
public class PositionTenantTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _database;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-position-{Guid.NewGuid():N}.db");

    public PositionTenantTests()
    {
        _database = new SqlSugarScope(new ConnectionConfig
        {
            ConfigId = SqlSugarConst.MainConfigId,
            DbType = DbType.Sqlite,
            ConnectionString = $"Data Source={_file}",
            IsAutoCloseConnection = true,
            InitKeyType = InitKeyType.Attribute,
            ConfigureExternalServices = new ConfigureExternalServices
            {
                EntityService = (property, column) =>
                {
                    if (new NullabilityInfoContext().Create(property).WriteState == NullabilityState.Nullable)
                        column.IsNullable = true;
                }
            }
        });
        SqlSugarSetup.ITenant = _database;
        try
        {
            _database.CodeFirst.InitTables<SysPos>();
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    [Theory]
    [InlineData(AccountTypeEnum.SysAdmin, 1)]
    [InlineData(AccountTypeEnum.SuperAdmin, 2)]
    public async Task AddPos_WithExplicitTenant_RespectsAccountBoundary(AccountTypeEnum accountType, long expectedTenant)
    {
        // 准备当前租户为 1、请求租户为 2 的真实服务输入。
        SysPosService service = CreateService(accountType);
        AddPosInput input = new() { Id = 10, Name = "position", Code = "position", TenantId = 2 };

        await service.AddPos(input);

        SysPos stored = await _database.Queryable<SysPos>().InSingleAsync(10);
        Assert.Equal(expectedTenant, stored.TenantId);
    }

    [Theory]
    [InlineData(AccountTypeEnum.SysAdmin)]
    [InlineData(AccountTypeEnum.SuperAdmin)]
    public async Task UpdatePos_WithForgedTenant_PreservesExistingTenant(AccountTypeEnum accountType)
    {
        // 已有职位属于当前账号，防止以修改资料为由迁移到其他租户。
        await _database.Insertable(new SysPos { Id = 10, Name = "position", Code = "position", TenantId = 1, CreateUserId = 42 }).ExecuteCommandAsync(TestContext.Current.CancellationToken);
        SysPosService service = CreateService(accountType);

        await service.UpdatePos(new UpdatePosInput { Id = 10, Name = "edited", Code = "position", TenantId = 2 });

        SysPos stored = await _database.Queryable<SysPos>().InSingleAsync(10);
        Assert.Equal(1, stored.TenantId);
        Assert.Equal("edited", stored.Name);
    }

    private static SysPosService CreateService(AccountTypeEnum accountType)
    {
        ClaimsIdentity identity = new(new[]
        {
            new Claim(ClaimConst.UserId, "42"),
            new Claim(ClaimConst.TenantId, "1"),
            new Claim(ClaimConst.AccountType, ((int)accountType).ToString())
        }, "Test");
        HttpContextAccessor accessor = new() { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } };
        return new SysPosService(new UserManager(accessor), new SqlSugarRepository<SysPos>(), null);
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previousTenant;
        _database.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        try
        {
            if (File.Exists(_file)) File.Delete(_file);
        }
        catch
        {
            // Ignore temporary file cleanup locks
        }
    }
}
