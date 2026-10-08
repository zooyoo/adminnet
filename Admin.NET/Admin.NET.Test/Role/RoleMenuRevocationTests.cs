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
        try
        {
            _database.CodeFirst.InitTables<SysMenu, SysRole, SysRoleMenu, SysUserRole>();
            _database.Insertable(new SysRole { Id = 1, Name = "原角色", Code = "test", Status = StatusEnum.Enable }).ExecuteCommand();
            _database.Insertable(new SysRoleMenu { Id = 1, RoleId = 1, MenuId = 11 }).ExecuteCommand();
            _database.Insertable(new SysRoleMenu { Id = 2, RoleId = 2, MenuId = 12 }).ExecuteCommand();
            _database.Insertable(new SysUserRole { Id = 1, UserId = 42, RoleId = 1 }).ExecuteCommand();
            Cache.Default.Set(_prefix + CacheConst.KeyUserButton + 42, new[] { "sysUser:page" });
            var cache = new SysCacheService(new CacheProvider { Cache = Cache.Default }, Options.Create(new CacheOptions { Prefix = _prefix }));
            var roleMenus = new SysRoleMenuService(new SqlSugarRepository<SysRoleMenu>(), cache);
            var userRoles = new SysUserRoleService(cache, new SqlSugarRepository<SysUserRole>());
            _userRoles = userRoles;
            _roles = new SysRoleService(null, null, null, null, new SqlSugarRepository<SysRole>(), roleMenus, userRoles, cache);
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
    public async Task GrantMenu_WithEmptyMenuListAndSynchronizedRoles_ClearsBothRoles()
    {
        await _roles.GrantMenu(new RoleMenuInput { Id = 1, MenuIdList = new List<long>(), RoleIdList = new List<long> { 2 } });
        Assert.Empty(await _database.Queryable<SysRoleMenu>().ToListAsync(TestContext.Current.CancellationToken));
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
