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

namespace Admin.NET.Test.Org;

[Collection("RoleMenuDatabase")]
public class OrganizationParentTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _db;
    private readonly SysOrgService _orgs;
    private readonly HttpContextAccessor _accessor = new();
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"org-parent-{Guid.NewGuid():N}.db");

    public OrganizationParentTests()
    {
        _db = new SqlSugarScope(new ConnectionConfig
        {
            ConfigId = SqlSugarConst.MainConfigId, DbType = DbType.Sqlite,
            ConnectionString = $"Data Source={_file}", IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute,
            ConfigureExternalServices = new ConfigureExternalServices
            {
                EntityService = (property, column) =>
                {
                    if (new NullabilityInfoContext().Create(property).WriteState == NullabilityState.Nullable)
                        column.IsNullable = true;
                }
            }
        });
        SqlSugarSetup.ITenant = _db;
        _db.CodeFirst.InitTables<SysOrg>();
        _db.Insertable(new[]
        {
            new SysOrg { Id = 10, TenantId = 1, Pid = 0, Name = "根机构", Code = "root" },
            new SysOrg { Id = 11, TenantId = 1, Pid = 10, Name = "子机构", Code = "child" },
            new SysOrg { Id = 12, TenantId = 1, Pid = 11, Name = "孙机构", Code = "grandchild" },
            new SysOrg { Id = 20, TenantId = 2, Pid = 0, Name = "外租户机构", Code = "foreign" }
        }).ExecuteCommand();
        _accessor.HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity(new[]
            {
                new Claim(ClaimConst.UserId, "42"), new Claim(ClaimConst.TenantId, "1"),
                new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.SuperAdmin).ToString())
            }, "Test"))
        };
        var cache = new SysCacheService(new CacheProvider { Cache = Cache.Default }, Options.Create(new CacheOptions { Prefix = $"org-parent:{Guid.NewGuid():N}:" }));
        _orgs = new SysOrgService(new UserManager(_accessor), cache, null, null, null, new SqlSugarRepository<SysOrg>());
    }

    [Theory]
    [InlineData(11)]
    [InlineData(12)]
    [InlineData(20)]
    [InlineData(999)]
    public async Task UpdateOrg_WithInvalidParent_PreservesTree(long parent)
    {
        // Arrange
        var input = new UpdateOrgInput { Id = 11, Pid = parent, Name = "篡改", Code = "child", TenantId = 2 };
        // Act
        await Assert.ThrowsAnyAsync<Exception>(() => _orgs.UpdateOrg(input));
        // Assert
        var saved = await _db.Queryable<SysOrg>().InSingleAsync(11);
        Assert.Equal(10, saved.Pid);
        Assert.Equal("子机构", saved.Name);
        Assert.Equal(1, saved.TenantId);
    }

    [Fact]
    public async Task UpdateOrg_WithValidParent_PreservesTenantAndCreator()
    {
        // Arrange
        var input = new UpdateOrgInput { Id = 12, Pid = 10, Name = "移动", Code = "grandchild", TenantId = 2, CreateUserId = 999 };
        // Act
        await _orgs.UpdateOrg(input);
        // Assert
        var saved = await _db.Queryable<SysOrg>().InSingleAsync(12);
        Assert.Equal(10, saved.Pid);
        Assert.Equal("移动", saved.Name);
        Assert.Equal(1, saved.TenantId);
        Assert.NotEqual(999, saved.CreateUserId);
    }

    public void Dispose()
    {
        _accessor.HttpContext = null;
        _db.Dispose();
        SqlSugarSetup.ITenant = _previousTenant;
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        File.Delete(_file);
    }
}
