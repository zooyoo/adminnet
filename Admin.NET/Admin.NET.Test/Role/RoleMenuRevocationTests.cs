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

namespace Admin.NET.Test.Role;

[CollectionDefinition("RoleMenuDatabase", DisableParallelization = true)]
public class RoleMenuDatabaseCollection;

[Collection("RoleMenuDatabase")]
public class RoleMenuRevocationTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _database;
    private readonly SysRoleService _roles;
    private readonly SysUserRoleService _userRoles;
    private readonly HttpContextAccessor _accessor = new();
    private readonly string _prefix = $"role-menu-test:{Guid.NewGuid():N}:";
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-role-menu-{Guid.NewGuid():N}.db");

    public RoleMenuRevocationTests()
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
            _database.CodeFirst.InitTables<SysMenu, SysTenantMenu, SysRole, SysRoleMenu, SysUserRole>();
            _database.Insertable(new[]
            {
                new SysMenu { Id = 11, Title = "本租户菜单", Pid = 0, Type = MenuTypeEnum.Menu, Status = StatusEnum.Enable },
                new SysMenu { Id = 12, Title = "其他租户菜单", Pid = 0, Type = MenuTypeEnum.Menu, Status = StatusEnum.Enable }
            }).ExecuteCommand();
            _database.Insertable(new SysTenantMenu { Id = 101, TenantId = 1, MenuId = 11 }).ExecuteCommand();
            _database.Insertable(new SysRole { Id = 1, TenantId = 1, Name = "原角色", Code = "test", Status = StatusEnum.Enable, CreateUserId = 42 }).ExecuteCommand();
            _database.Insertable(new SysRoleMenu { Id = 1, RoleId = 1, MenuId = 11 }).ExecuteCommand();
            _database.Insertable(new[]
            {
                new SysRole { Id = 2, TenantId = 1, Name = "同步角色", Code = "sync", Status = StatusEnum.Enable, CreateUserId = 42 },
                new SysRole { Id = 3, TenantId = 2, Name = "其他租户角色", Code = "other", Status = StatusEnum.Enable, CreateUserId = 99 }
            }).ExecuteCommand();
            _database.Insertable(new SysRoleMenu { Id = 2, RoleId = 2, MenuId = 12 }).ExecuteCommand();
            _database.Insertable(new SysUserRole { Id = 1, UserId = 42, RoleId = 1 }).ExecuteCommand();
            Cache.Default.Set(_prefix + CacheConst.KeyUserButton + 42, new[] { "sysUser:page" });
            var cache = new SysCacheService(new CacheProvider { Cache = Cache.Default }, Options.Create(new CacheOptions { Prefix = _prefix }));
            var roleMenus = new SysRoleMenuService(new SqlSugarRepository<SysRoleMenu>(), cache);
            var userRoles = new SysUserRoleService(cache, new SqlSugarRepository<SysUserRole>());
            var identity = new ClaimsIdentity(new[]
            {
                new Claim(ClaimConst.UserId, "42"),
                new Claim(ClaimConst.TenantId, "1"),
                new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.SysAdmin).ToString())
            }, "Test");
            _accessor.HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) };
            var user = new UserManager(_accessor);
            var menus = new SysMenuService(new SqlSugarRepository<SysTenantMenu>(), new SqlSugarRepository<SysMenu>(), roleMenus, userRoles, null, cache, user, null, null);
            _userRoles = userRoles;
            _roles = new SysRoleService(user, null, menus, null, new SqlSugarRepository<SysRole>(), roleMenus, userRoles, cache);
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    [Fact]
    public async Task GrantMenu_WithEmptyMenuList_RemovesGrantsAndCachedPermissions()
    {
        // Arrange
        var input = new RoleMenuInput { Id = 1, MenuIdList = new List<long>() };

        // Act
        await _roles.GrantMenu(input);

        // Assert
        Assert.Empty(await _database.Queryable<SysRoleMenu>().Where(row => row.RoleId == 1).ToListAsync(TestContext.Current.CancellationToken));
        Assert.Single(await _database.Queryable<SysRoleMenu>().Where(row => row.RoleId == 2).ToListAsync(TestContext.Current.CancellationToken));
        Assert.False(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }

    [Fact]
    public async Task UpdateRole_WithEmptyMenuList_UpdatesFieldsAndRevokesMenus()
    {
        // Arrange
        var input = new UpdateRoleInput { Id = 1, Name = "更新角色", Code = "test", MenuIdList = new List<long>() };

        // Act
        await _roles.UpdateRole(input);

        // Assert
        Assert.Equal("更新角色", (await _database.Queryable<SysRole>().InSingleAsync(1)).Name);
        Assert.Empty(await _database.Queryable<SysRoleMenu>().Where(row => row.RoleId == 1).ToListAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task GrantMenu_WithOmittedMenuList_PreservesExistingGrants()
    {
        await _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = null });
        Assert.Single(await _database.Queryable<SysRoleMenu>().Where(row => row.RoleId == 1).ToListAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task GrantMenu_CrossTenantRoleAndMenu_AreRejected()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.GrantMenu(new RoleMenuInput { Id = 3, MenuIdList = new List<long> { 11 } }));
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = new List<long> { 12 } }));
        Assert.Equal(11, (await _database.Queryable<SysRoleMenu>().SingleAsync(row => row.RoleId == 1)).MenuId);
        Assert.Equal(12, (await _database.Queryable<SysRoleMenu>().SingleAsync(row => row.RoleId == 2)).MenuId);
    }

    [Fact]
    public async Task RoleMutations_CrossTenantRole_AreRejected()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.UpdateRole(new UpdateRoleInput { Id = 3, Name = "越权", Code = "other", MenuIdList = new List<long>() }));
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.SetStatus(new RoleInput { Id = 3, Status = StatusEnum.Disable }));
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.DeleteRole(new DeleteRoleInput { Id = 3 }));
        Assert.Equal("其他租户角色", (await _database.Queryable<SysRole>().InSingleAsync(3)).Name);
    }

    [Fact]
    public async Task GrantMenu_WithEmptyMenuListAndSynchronizedRoles_ClearsBothRoles()
    {
        await _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = new List<long>(), RoleIdList = new List<long> { 2 } });
        Assert.Empty(await _database.Queryable<SysRoleMenu>().ToListAsync(TestContext.Current.CancellationToken));
    }

    [Fact]
    public async Task UpdateRole_InvalidMenu_DoesNotSavePartialRoleChanges()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.UpdateRole(new UpdateRoleInput
        {
            Id = 1, Name = "不得保存", Code = "changed", MenuIdList = [12]
        }));
        Assert.Equal("原角色", _database.Queryable<SysRole>().InSingle(1).Name);
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
        Assert.True(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }

    [Fact]
    public async Task UpdateRole_ForgedTenantAndOwner_PreservesPersistedIdentityAndGrants()
    {
        await _roles.UpdateRole(new UpdateRoleInput { Id = 1, Name = "更新", Code = "test", TenantId = 2, CreateUserId = 99 });
        SysRole role = _database.Queryable<SysRole>().InSingle(1);
        Assert.Equal(1, role.TenantId);
        Assert.Equal(42, role.CreateUserId);
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
    }

    [Fact]
    public async Task GrantMenu_ValidMenuAndDuplicates_PersistsExactlyOnce()
    {
        await _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = [11, 11] });
        Assert.Single(_database.Queryable<SysRoleMenu>().Where(row => row.RoleId == 1).ToList());
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
    }

    [Fact]
    public async Task GrantMenu_ForeignSyncTarget_DoesNotRevokeSource()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = [], RoleIdList = [3] }));
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
        Assert.True(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }

    [Theory]
    [InlineData(0)]
    [InlineData(6)]
    [InlineData(1)]
    [InlineData(5)]
    public async Task GrantDataScope_InvalidOrForbiddenScope_PreservesRoleAndCache(int scope)
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.GrantDataScope(new RoleOrgInput { Id = 1, DataScope = scope, OrgIdList = null }));
        Assert.Equal(DataScopeEnum.Self, _database.Queryable<SysRole>().InSingle(1).DataScope);
        Assert.True(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }

    [Fact]
    public async Task AddRole_IllegalMenu_DoesNotCreateOrphanRole()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.AddRole(new AddRoleInput { Name = "不得创建", Code = "invalid", MenuIdList = [12] }));
        Assert.Equal(3, _database.Queryable<SysRole>().Count());
    }

    [Fact]
    public async Task AddRole_ForgedScopeAndTenant_CreatesCurrentTenantSelfScope()
    {
        await _roles.AddRole(new AddRoleInput
        {
            Name = "新角色", Code = "new", TenantId = 2, CreateUserId = 99, DataScope = DataScopeEnum.All, MenuIdList = [11]
        });
        SysRole role = _database.Queryable<SysRole>().Single(row => row.Code == "new");
        Assert.Equal(1, role.TenantId);
        Assert.Equal(42, role.CreateUserId);
        Assert.Equal(DataScopeEnum.Self, role.DataScope);
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == role.Id).MenuId);
    }

    [Fact]
    public async Task GrantMenu_RegularUserCannotDelegateUnownedTenantMenu()
    {
        SetAccountType(AccountTypeEnum.NormalUser);
        _database.Insertable(new SysMenu { Id = 13, Title = "租户内未授权菜单", Type = MenuTypeEnum.Menu }).ExecuteCommand();
        _database.Insertable(new SysTenantMenu { Id = 102, TenantId = 1, MenuId = 13 }).ExecuteCommand();
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = [13] }));
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
        await _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = [11] });
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
    }

    [Fact]
    public async Task GrantMenu_SuperAdminChecksMenuScopeForEverySyncTarget()
    {
        SetAccountType(AccountTypeEnum.SuperAdmin);
        _database.Insertable(new SysTenantMenu { Id = 102, TenantId = 2, MenuId = 12 }).ExecuteCommand();
        await Assert.ThrowsAnyAsync<Exception>(() => _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = [11], RoleIdList = [3] }));
        Assert.Equal(11, _database.Queryable<SysRoleMenu>().Single(row => row.RoleId == 1).MenuId);
        Assert.True(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }

    private void SetAccountType(AccountTypeEnum type)
    {
        _accessor.HttpContext.User = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimConst.UserId, "42"), new Claim(ClaimConst.TenantId, "1"),
            new Claim(ClaimConst.AccountType, ((int)type).ToString())
        }, "Test"));
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previousTenant;
        _database.Dispose();
        Cache.Default.Remove(_prefix + CacheConst.KeyUserButton + 42);
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

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task GrantUserRole_WithNoRemainingRoles_DeletesAssignmentsAndCachedPermissions(bool omitted)
    {
        // Arrange
        var input = new UserRoleInput { UserId = 42, RoleIdList = omitted ? null : new List<long>() };

        // Act
        await _userRoles.GrantUserRole(input);

        // Assert
        Assert.Empty(await _database.Queryable<SysUserRole>().Where(row => row.UserId == 42).ToListAsync(TestContext.Current.CancellationToken));
        Assert.False(Cache.Default.ContainsKey(_prefix + CacheConst.KeyUserButton + 42));
    }
}
