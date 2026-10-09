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

namespace Admin.NET.Test.Registration;

[CollectionDefinition("RegistrationDatabase", DisableParallelization = true)]
public class RegistrationDatabaseCollection;

[Collection("RegistrationDatabase")]
public class RegistrationBoundaryTests : IDisposable
{
    private readonly ITenant _previous = SqlSugarSetup.ITenant;
    private readonly string _file = Path.Combine(Path.GetTempPath(), $"adminnet-registration-{Guid.NewGuid():N}.db");
    private readonly SqlSugarScope _db;

    public RegistrationBoundaryTests()
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
        _db.CodeFirst.InitTables<SysTenant, SysUserRegWay, SysRole, SysOrg, SysPos>();
        long nextId = 1000;
        _db.Aop.DataExecuting = (_, info) =>
        {
            if (info.OperationType == DataFilterType.InsertByObject && info.EntityColumnInfo.IsPrimarykey &&
                (long)info.EntityColumnInfo.PropertyInfo.GetValue(info.EntityValue) == 0)
                info.SetValue(Interlocked.Increment(ref nextId));
        };
        foreach (long tenantId in new long[] { 1, 2 })
        {
            _db.Insertable(new SysTenant { Id = tenantId, Status = StatusEnum.Enable }).ExecuteCommand();
            _db.Insertable(new SysRole { Id = tenantId * 10, TenantId = tenantId, Name = "角色", Code = $"r{tenantId}" }).ExecuteCommand();
            _db.Insertable(new SysOrg { Id = tenantId * 10, TenantId = tenantId, Name = "机构", Code = $"o{tenantId}" }).ExecuteCommand();
            _db.Insertable(new SysPos { Id = tenantId * 10, TenantId = tenantId, Name = "职位", Code = $"p{tenantId}" }).ExecuteCommand();
        }
    }

    private static UserManager User(long tenantId, AccountTypeEnum type) => new(new HttpContextAccessor
    {
        HttpContext = new DefaultHttpContext
        {
            User = new ClaimsPrincipal(new ClaimsIdentity([
                new Claim(ClaimConst.TenantId, tenantId.ToString()),
                new Claim(ClaimConst.UserId, "42"),
                new Claim(ClaimConst.AccountType, ((int)type).ToString())
            ], "Test"))
        }
    });
    private static SysUserRegWayService Service(long tenantId = 1, AccountTypeEnum type = AccountTypeEnum.SuperAdmin) =>
        new(new SqlSugarRepository<SysUserRegWay>(), User(tenantId, type));
    private static AddUserRegWayInput Draft(long tenantId = 1) =>
        new() { Name = "测试方案", AccountType = AccountTypeEnum.NormalUser, TenantId = tenantId, RoleId = tenantId * 10, OrgId = tenantId * 10, PosId = tenantId * 10 };

    [Theory]
    [InlineData("role")]
    [InlineData("org")]
    [InlineData("pos")]
    public async Task Add_ForeignAssociation_RejectsWithoutWriting(string field)
    {
        AddUserRegWayInput input = Draft();
        if (field == "role") input.RoleId = 20;
        if (field == "org") input.OrgId = 20;
        if (field == "pos") input.PosId = 20;
        await Assert.ThrowsAnyAsync<Exception>(() => Service().Add(input));
        Assert.Empty(_db.Queryable<SysUserRegWay>().ToList());
    }

    [Theory]
    [InlineData(888)]
    [InlineData(999)]
    [InlineData(123)]
    public async Task Add_PrivilegedOrInvalidAccountType_Rejects(int type)
    {
        AddUserRegWayInput input = Draft();
        input.AccountType = (AccountTypeEnum)type;
        await Assert.ThrowsAnyAsync<Exception>(() => Service().Add(input));
        Assert.Empty(_db.Queryable<SysUserRegWay>().ToList());
    }

    [Fact]
    public async Task Add_ForgedTenant_UsesCurrentIdentity()
    {
        AddUserRegWayInput input = Draft();
        input.TenantId = 2;
        long id = await Service(1, AccountTypeEnum.SysAdmin).Add(input);
        Assert.Equal(1, _db.Queryable<SysUserRegWay>().InSingle(id).TenantId);
    }

    [Fact]
    public async Task Update_ForeignRecord_RejectsAndPreservesData()
    {
        long id = await Service().Add(Draft(2));
        await Assert.ThrowsAnyAsync<Exception>(() => Service(1, AccountTypeEnum.SysAdmin).Update(
            new UpdateUserRegWayInput { Id = id, TenantId = 1, Name = "越权", RoleId = 10, OrgId = 10, PosId = 10 }));
        await Assert.ThrowsAnyAsync<Exception>(() => Service(1, AccountTypeEnum.SysAdmin).Delete(new BaseIdInput { Id = id }));
        Assert.Equal("测试方案", _db.Queryable<SysUserRegWay>().InSingle(id).Name);
    }

    [Fact]
    public async Task Add_SameNameInDifferentTenants_AllowsAndFiltersList()
    {
        await Service().Add(Draft());
        await Service().Add(Draft(2));
        Assert.Single(await Service(1, AccountTypeEnum.SysAdmin).List(new PageUserRegWayInput { TenantId = 2 }));
        await Assert.ThrowsAnyAsync<Exception>(() => Service().Add(Draft()));
    }

    [Fact]
    public async Task Delete_DefaultScheme_DisablesOnlyOwningTenant()
    {
        long id = await Service().Add(Draft());
        _db.Updateable<SysTenant>().SetColumns(u => u.EnableReg == YesNoEnum.Y).SetColumns(u => u.RegWayId == id).Where(u => u.Id == 1).ExecuteCommand();
        await Service().Delete(new BaseIdInput { Id = id });
        SysTenant tenant = _db.Queryable<SysTenant>().InSingle(1);
        Assert.Equal(YesNoEnum.N, tenant.EnableReg);
        Assert.Null(tenant.RegWayId);
        Assert.Empty(_db.Queryable<SysUserRegWay>().ToList());
    }

    [Fact]
    public void SaveSysInfo_MissingLegacyMenu_RequiresExplicitGrant()
    {
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant("sysConfig:saveSysInfo"));
    }

    [Fact]
    public async Task SaveSysInfo_ForeignScheme_RejectsWithoutChangingBrand()
    {
        long id = await Service().Add(Draft(2));
        SysConfigService config = new(new SqlSugarRepository<SysTenant>(), new SqlSugarRepository<SysConfig>(), null, User(1, AccountTypeEnum.SysAdmin));
        await Assert.ThrowsAnyAsync<Exception>(() => config.SaveSysInfo(new InfoSaveInput { Title = "不得保存", EnableReg = YesNoEnum.Y, RegWayId = id }));
        Assert.NotEqual("不得保存", _db.Queryable<SysTenant>().InSingle(1).Title);
    }

    [Fact]
    public async Task SaveSysInfo_DisableRegistration_ClearsSchemeAndPreservesOtherTenant()
    {
        long id = await Service().Add(Draft());
        SysConfigService config = new(new SqlSugarRepository<SysTenant>(), new SqlSugarRepository<SysConfig>(), null, User(1, AccountTypeEnum.SysAdmin));
        await config.SaveSysInfo(new InfoSaveInput { Title = "租户一", EnableReg = YesNoEnum.Y, RegWayId = id });
        Assert.Equal(id, _db.Queryable<SysTenant>().InSingle(1).RegWayId);
        await config.SaveSysInfo(new InfoSaveInput { Title = "已关闭", EnableReg = YesNoEnum.N, RegWayId = id });
        Assert.Null(_db.Queryable<SysTenant>().InSingle(1).RegWayId);
        Assert.NotEqual("已关闭", _db.Queryable<SysTenant>().InSingle(2).Title);
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previous;
        _db.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
