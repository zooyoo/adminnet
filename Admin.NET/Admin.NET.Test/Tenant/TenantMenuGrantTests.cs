// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.Extensions.Options;
using Microsoft.AspNetCore.Http;
using NewLife.Caching;
using SqlSugar;
using System.Reflection;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.Tenant;

[CollectionDefinition("TenantMenuDatabase", DisableParallelization = true)]
public class TenantMenuDatabaseCollection;

[Collection("TenantMenuDatabase")]
public class TenantMenuGrantTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-tenant-menu-{Guid.NewGuid():N}.db");
    private readonly string _prefix = $"tenant-menu-test:{Guid.NewGuid():N}:";
    private readonly SqlSugarScope _database;
    private readonly SysTenantService _tenants;
    private readonly SysCacheService _cache;
    private readonly HttpContextAccessor _accessor = new();

    public TenantMenuGrantTests()
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
        long nextId = 1000;
        _database.Aop.DataExecuting = (_, info) =>
        {
            if (info.OperationType == DataFilterType.InsertByObject && info.EntityColumnInfo.IsPrimarykey &&
                info.EntityColumnInfo.PropertyInfo.PropertyType == typeof(long) &&
                (long)info.EntityColumnInfo.PropertyInfo.GetValue(info.EntityValue) == 0)
                info.SetValue(Interlocked.Increment(ref nextId));
        };
        try
        {
            _database.CodeFirst.InitTables<SysTenant, SysMenu, SysTenantMenu>();
            _database.Insertable(new[]
            {
                new SysTenant { Id = SqlSugarConst.DefaultTenantId },
                new SysTenant { Id = 2, OrgId = 20, UserId = 21 },
                new SysTenant { Id = 3 }
            }).ExecuteCommand();
            // 拒绝路径只核验用户未变化，不构造依赖应用本地化配置的用户实体。
            _database.Ado.ExecuteCommand("CREATE TABLE SysUser (Id INTEGER PRIMARY KEY, TenantId INTEGER, Account TEXT, Password TEXT)");
            _database.Ado.ExecuteCommand("INSERT INTO SysUser VALUES (21, 2, 'tenant-admin', 'unchanged'), (22, 2, 'tenant-user', 'unchanged')");
            _database.Insertable(new[]
            {
                new SysMenu { Id = 10, Title = "目录", Name = "root", Type = MenuTypeEnum.Dir },
                new SysMenu { Id = 11, Pid = 10, Title = "列表", Name = "list", Type = MenuTypeEnum.Menu },
                new SysMenu { Id = 12, Pid = 11, Title = "查看", Permission = "item:page", Type = MenuTypeEnum.Btn },
                new SysMenu { Id = 13, Pid = 10, Title = "另一个列表", Name = "list", Type = MenuTypeEnum.Menu },
                new SysMenu { Id = 14, Pid = 11, Title = "重复权限", Permission = "item:page", Type = MenuTypeEnum.Btn },
                new SysMenu { Id = 15, Pid = 10, Title = "列表", Name = "other", Type = MenuTypeEnum.Menu }
            }).ExecuteCommand();
            _database.Insertable(new[]
            {
                new SysTenantMenu { Id = 101, TenantId = 2, MenuId = 11 },
                new SysTenantMenu { Id = 102, TenantId = 3, MenuId = 11 },
                new SysTenantMenu { Id = 103, TenantId = SqlSugarConst.DefaultTenantId, MenuId = 11 }
            }).ExecuteCommand();
            var cache = new SysCacheService(new CacheProvider { Cache = Cache.Default }, Options.Create(new CacheOptions { Prefix = _prefix }));
            _cache = cache;
            _accessor.HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.SuperAdmin).ToString())], "Test"))
            };
            _tenants = new SysTenantService(
                new SqlSugarRepository<SysUserExtOrg>(), new SqlSugarRepository<SysTenantMenu>(),
                new SqlSugarRepository<SysRoleMenu>(), new SqlSugarRepository<SysUserRole>(),
                new SqlSugarRepository<SysTenant>(), new SqlSugarRepository<SysUser>(),
                new SqlSugarRepository<SysRole>(), new SqlSugarRepository<SysOrg>(),
                new SqlSugarRepository<SysPos>(), Options.Create(new UploadOptions()), null, null, cache, new UserManager(_accessor));
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    [Fact]
    public async Task GrantMenu_OmittedMenus_PreservesAllGrants()
    {
        await _tenants.GrantMenu(new TenantMenuInput { Id = 2 });
        Assert.Equal(3, await _database.Queryable<SysTenantMenu>().CountAsync());
    }

    [Fact]
    public async Task GrantMenu_EmptyMenus_RevokesOnlySelectedTenantsAndCache()
    {
        Cache.Default.Set(_prefix + CacheConst.KeyUserButton + 42, new[] { "item:page" });
        await _tenants.GrantMenu(new TenantMenuInput { Id = 2, TenantIdList = [3], MenuIdList = [] });
        Assert.Equal(SqlSugarConst.DefaultTenantId, (await _database.Queryable<SysTenantMenu>().SingleAsync()).TenantId);
        Assert.False(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }

    [Theory]
    [InlineData(13)]
    [InlineData(14)]
    [InlineData(15)]
    [InlineData(999)]
    public async Task GrantMenu_NewConflictingOrMissingMenu_PreservesAllGrants(long menuId)
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.GrantMenu(new TenantMenuInput
        {
            Id = 2, TenantIdList = [3], MenuIdList = [12, menuId]
        }));
        Assert.Equal(new long[] { 101, 102, 103 }, await _database.Queryable<SysTenantMenu>().OrderBy(row => row.Id).Select(row => row.Id).ToArrayAsync());
    }

    [Fact]
    public async Task GrantMenu_MissingSyncTarget_PreservesAllGrants()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.GrantMenu(new TenantMenuInput
        {
            Id = 2, TenantIdList = [999], MenuIdList = []
        }));
        Assert.Equal(3, await _database.Queryable<SysTenantMenu>().CountAsync());
    }

    [Fact]
    public async Task GrantMenu_RepeatedTargetsAndMenus_AddsAncestorsOnceAndPreservesDefaultIds()
    {
        var input = new TenantMenuInput { Id = 2, TenantIdList = [2, 3, 3, SqlSugarConst.DefaultTenantId], MenuIdList = [12, 12] };
        await _tenants.GrantMenu(input);
        var grants = await _database.Queryable<SysTenantMenu>().ToListAsync();
        Assert.Equal(9, grants.Count);
        foreach (var tenantId in new[] { 2L, 3L, SqlSugarConst.DefaultTenantId })
            Assert.Equal(new long[] { 10, 11, 12 }, grants.Where(row => row.TenantId == tenantId).Select(row => row.MenuId).Order());
        Assert.Equal(103, grants.Single(row => row.TenantId == SqlSugarConst.DefaultTenantId && row.MenuId == 11).Id);
        Assert.Equal(new long[] { 12, 12 }, input.MenuIdList);
    }

    [Theory]
    [InlineData(12)]
    [InlineData(999)]
    public async Task GrantMenu_CyclicOrMissingParent_PreservesAllGrants(long parentId)
    {
        await _database.Updateable<SysMenu>().SetColumns(row => row.Pid == parentId).Where(row => row.Id == 10).ExecuteCommandAsync();
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.GrantMenu(new TenantMenuInput { Id = 2, MenuIdList = [12] }));
        Assert.Equal(3, await _database.Queryable<SysTenantMenu>().CountAsync());
    }

    [Theory]
    [InlineData(999, 21)]
    [InlineData(20, 22)]
    public async Task UpdateTenant_ForgedAssociation_PreservesTenantAndUsers(long orgId, long userId)
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.UpdateTenant(new UpdateTenantInput
        {
            Id = 2, OrgId = orgId, UserId = userId, Name = "篡改名称", AdminAccount = "forged"
        }));
        var tenant = await _database.Queryable<SysTenant>().InSingleAsync(2);
        Assert.Equal(20, tenant.OrgId);
        Assert.Equal(21, tenant.UserId);
        Assert.Equal("tenant-user", await _database.Queryable<SysUser>().Where(row => row.Id == 22).Select(row => row.Account).SingleAsync());
    }

    [Fact]
    public async Task ResetPwd_NonTenantAdministrator_PreservesPassword()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.ResetPwd(new TenantUserInput { UserId = 22 }));
        Assert.Equal("unchanged", await _database.Queryable<SysUser>().Where(row => row.Id == 22).Select(row => row.Password).SingleAsync());
    }

    [Fact]
    public async Task SetStatus_DefaultTenantWithMissingConfigId_IsRejected()
    {
        var original = await _database.Queryable<SysTenant>().InSingleAsync(SqlSugarConst.DefaultTenantId);
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.SetStatus(new TenantInput { Id = original.Id, Status = StatusEnum.Disable }));
        Assert.Equal(original.Status, (await _database.Queryable<SysTenant>().InSingleAsync(original.Id)).Status);
    }

    [Fact]
    public async Task UpdateTenant_DefaultTenantIsolationChange_IsRejected()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.UpdateTenant(new UpdateTenantInput
        {
            Id = SqlSugarConst.DefaultTenantId, TenantType = TenantTypeEnum.Db
        }));
        Assert.Equal(TenantTypeEnum.Id, (await _database.Queryable<SysTenant>().InSingleAsync(SqlSugarConst.DefaultTenantId)).TenantType);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(999)]
    public async Task CreateDb_FieldIsolatedOrMissingTenant_IsRejected(long id)
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.CreateDb(new TenantInput { Id = id }));
        Assert.Equal(3, await _database.Queryable<SysTenant>().CountAsync());
    }

    [Fact]
    public async Task GoTenant_DisabledTenant_IsRejected()
    {
        await _database.Updateable<SysTenant>().SetColumns(row => row.Status == StatusEnum.Disable).Where(row => row.Id == 2).ExecuteCommandAsync();
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.GoTenant(new BaseIdInput { Id = 2 }));
        Assert.Equal("unchanged", await _database.Queryable<SysUser>().Where(row => row.Id == 21).Select(row => row.Password).SingleAsync());
    }

    [Fact]
    public async Task IdentitySwitch_TenantAdministrator_CannotAssumeAnotherIdentity()
    {
        _accessor.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity([
            new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.SysAdmin).ToString()),
            new Claim(ClaimConst.TenantId, "2"),
            new Claim(ClaimConst.UserId, "21")
        ], "Test"));
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.ChangeTenant(new BaseIdInput { Id = 3 }));
        await Assert.ThrowsAnyAsync<Exception>(() => _tenants.GoTenant(new BaseIdInput { Id = 3 }));
        Assert.Equal(3, await _database.Queryable<SysTenant>().CountAsync());
    }

    [Fact]
    public void GetTenantDbConnectionScope_DisabledOrRemovedTenant_RejectsExistingConnection()
    {
        _database.AddConnection(new ConnectionConfig
        {
            ConfigId = "2", DbType = DbType.Sqlite, ConnectionString = $"Data Source={_file}",
            IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute
        });
        _cache.Set(CacheConst.KeyTenant, new List<SysTenant> { new() { Id = 2, TenantType = TenantTypeEnum.Db, Status = StatusEnum.Enable } });
        Assert.Equal("2", _tenants.GetTenantDbConnectionScope(2).CurrentConnectionConfig.ConfigId.ToString());
        _cache.Set(CacheConst.KeyTenant, new List<SysTenant> { new() { Id = 2, TenantType = TenantTypeEnum.Db, Status = StatusEnum.Disable } });
        Assert.ThrowsAny<Exception>(() => _tenants.GetTenantDbConnectionScope(2));
        _cache.Set(CacheConst.KeyTenant, new List<SysTenant>());
        Assert.ThrowsAny<Exception>(() => _tenants.GetTenantDbConnectionScope(2));
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previousTenant;
        _database.Dispose();
        Cache.Default.Remove(_prefix + CacheConst.KeyUserButton + 42);
        Cache.Default.Remove(_prefix + CacheConst.KeyTenant);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
