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

namespace Admin.NET.Test.Ldap;

[CollectionDefinition("LdapDatabase", DisableParallelization = true)]
public class LdapDatabaseCollection;

[Collection("LdapDatabase")]
public class LdapBoundaryTests : IDisposable
{
    private readonly ITenant _previous = SqlSugarSetup.ITenant;
    private readonly string _file = Path.Combine(Path.GetTempPath(), $"adminnet-ldap-{Guid.NewGuid():N}.db");
    private readonly SqlSugarScope _db;

    public LdapBoundaryTests()
    {
        _db = new SqlSugarScope(new ConnectionConfig
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
        SqlSugarSetup.ITenant = _db;
        _db.CodeFirst.InitTables<SysLdap, SysUserLdap>();
        foreach (long tenantId in new long[] { 1, 2 })
            _db.Insertable(new SysLdap { Id = tenantId, TenantId = tenantId, Host = "localhost", Port = 389, Version = 3,
                BaseDn = "dc=test", BindDn = "cn=admin", BindPass = "stored-secret", AuthFilter = "(uid=%s)" }).ExecuteCommand();
    }
    private static SysLdapService Service(long tenant = 1, AccountTypeEnum type = AccountTypeEnum.SysAdmin) => new(
        new SqlSugarRepository<SysLdap>(), new UserManager(new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimConst.TenantId, tenant.ToString()), new Claim(ClaimConst.AccountType, ((int)type).ToString())
            ], "Test")) }
        }));
    private static UpdateSysLdapInput Draft(long id = 1) => new()
    {
        Id = id, TenantId = id, Host = "127.0.0.1", Port = 1389, Version = 3, BaseDn = "dc=test", BindDn = "cn=admin",
        BindPass = "", AuthFilter = "(uid=%s)", BindAttrAccount = "uid", BindAttrEmployeeId = "employeeNumber", BindAttrCode = "ou", Status = StatusEnum.Enable
    };
    [Fact]
    public async Task Page_TenantUser_FiltersAndRedactsSecrets()
    {
        var page = await Service().Page(new SysLdapInput { Page = 1, PageSize = 10, TenantId = 2 });
        Assert.Null(Assert.Single(page.Items).BindPass);
        Assert.Equal("stored-secret", _db.Queryable<SysLdap>().InSingle(1).BindPass);
        Assert.Single(await Service().GetList());
    }
    [Fact]
    public async Task GetDetail_ForeignTenant_Rejects()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => Service().GetDetail(new DetailSysLdapInput { Id = 2 }));
        await Assert.ThrowsAnyAsync<Exception>(() => Service().Delete(new DeleteSysLdapInput { Id = 2 }));
        Assert.False(_db.Queryable<SysLdap>().InSingle(2).IsDelete);
    }
    [Fact]
    public async Task Update_EmptyPassword_PreservesSecretAndTenant()
    {
        await Service().Update(Draft());
        SysLdap stored = _db.Queryable<SysLdap>().InSingle(1);
        Assert.Equal("stored-secret", stored.BindPass);
        Assert.Equal(1389, stored.Port);
        Assert.Equal(1, stored.TenantId);
    }
    [Fact]
    public async Task Update_ForgedTenant_Rejects()
    {
        UpdateSysLdapInput input = Draft();
        input.TenantId = 2;
        await Assert.ThrowsAnyAsync<Exception>(() => Service().Update(input));
        Assert.Equal(389, _db.Queryable<SysLdap>().InSingle(1).Port);
    }
    [Theory]
    [InlineData(0)]
    [InlineData(65536)]
    public async Task Update_InvalidPort_PreservesConfiguration(int port)
    {
        UpdateSysLdapInput input = Draft();
        input.Port = port;
        await Assert.ThrowsAnyAsync<Exception>(() => Service().Update(input));
        Assert.Equal(389, _db.Queryable<SysLdap>().InSingle(1).Port);
    }
    [Fact]
    public async Task SyncUser_DisabledConfiguration_RejectsBeforeConnecting()
    {
        _db.Updateable<SysLdap>().SetColumns(u => u.Status == StatusEnum.Disable).Where(u => u.Id == 1).ExecuteCommand();
        await Assert.ThrowsAnyAsync<Exception>(() => Service().SyncUser(new SyncSysLdapInput { Id = 1 }));
        await Assert.ThrowsAnyAsync<Exception>(() => Service().AuthAccount(1, "test", "test"));
    }
    [Fact]
    public void SyncDept_LegacyPermission_UsesSyncOrgGrant()
    {
        DefaultHttpContext context = new();
        context.Request.Path = "/api/sysLdap/syncDept";
        Assert.Equal("sysLdap:syncOrg", RoutePermissionUtil.GetPermissionName(context));
    }
    [Fact]
    public async Task InsertUserLdapList_DuplicateAccount_PreservesExistingMapping()
    {
        _db.Insertable(new SysUserLdap { Id = 10, TenantId = 1, Account = "existing", UserName = "existing", UserId = 42, Dn = "uid=existing,dc=test" }).ExecuteCommand();
        SysUserLdapService service = new(new SqlSugarRepository<SysUserLdap>());
        await Assert.ThrowsAnyAsync<Exception>(() => service.InsertUserLdapList(1, [
            new SysUserLdap { TenantId = 1, Account = "duplicate" },
            new SysUserLdap { TenantId = 1, Account = "DUPLICATE" }
        ]));
        Assert.Equal(42, Assert.Single(_db.Queryable<SysUserLdap>().ToList()).UserId);
    }
    [Fact]
    public async Task InsertUserLdapList_ForeignTenant_PreservesExistingMapping()
    {
        _db.Insertable(new SysUserLdap { Id = 10, TenantId = 1, Account = "existing", UserName = "existing", UserId = 42, Dn = "uid=existing,dc=test" }).ExecuteCommand();
        SysUserLdapService service = new(new SqlSugarRepository<SysUserLdap>());
        await Assert.ThrowsAnyAsync<Exception>(() => service.InsertUserLdapList(1, [new SysUserLdap { TenantId = 2, Account = "foreign" }]));
        Assert.Equal(42, Assert.Single(_db.Queryable<SysUserLdap>().ToList()).UserId);
    }
    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previous;
        _db.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
