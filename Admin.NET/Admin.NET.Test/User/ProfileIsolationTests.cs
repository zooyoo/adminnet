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
using System.Runtime.CompilerServices;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.User;

[CollectionDefinition("ProfileDatabase", DisableParallelization = true)]
public class ProfileDatabaseCollection;

[Collection("ProfileDatabase")]
public class ProfileIsolationTests : IDisposable
{
    private readonly ITenant _previous = SqlSugarSetup.ITenant;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-profile-{Guid.NewGuid():N}.db");
    private readonly SqlSugarScope _db;

    public ProfileIsolationTests()
    {
        _db = new SqlSugarScope(new ConnectionConfig
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
        SqlSugarSetup.ITenant = _db;
        try
        {
            _db.CodeFirst.InitTables<SysUser>();
            _db.Insertable(new[] { Draft(42, 1), Draft(43, 2) }).ExecuteCommand();
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    private static SysUser Draft(long id, long tenant)
    {
        // 实体的默认语言依赖 Web Host；本测试只验证真实数据库写入，显式填充所需字段。
        SysUser user = (SysUser)RuntimeHelpers.GetUninitializedObject(typeof(SysUser));
        user.Id = id;
        user.TenantId = tenant;
        user.Account = $"profile-{id}";
        user.RealName = "原姓名";
        user.Password = "unchanged";
        user.Phone = $"138000000{id}";
        user.AccountType = AccountTypeEnum.NormalUser;
        user.Status = StatusEnum.Enable;
        user.OrgId = 10;
        user.PosId = 11;
        user.CreateUserId = 42;
        user.LangCode = "zh-CN";
        return user;
    }

    private static SysUserService Service()
    {
        UserManager user = new(new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([
                    new Claim(ClaimConst.UserId, "42"), new Claim(ClaimConst.TenantId, "1"),
                    new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.NormalUser).ToString())
                ], "Test"))
            }
        });
        return new SysUserService(user, null, null, null, null, null, null, null, new SqlSugarRepository<SysUser>(), null, null);
    }

    [Fact]
    public async Task UpdateBaseInfo_ForeignUser_RejectsWithoutWriting()
    {
        SysUser input = Draft(43, 2);
        input.RealName = "越权姓名";
        await Assert.ThrowsAnyAsync<Exception>(() => Service().UpdateBaseInfo(input));
        Assert.Equal("原姓名", await _db.Queryable<SysUser>().Where(u => u.Id == 43).Select(u => u.RealName).FirstAsync());
    }

    [Fact]
    public async Task UpdateBaseInfo_ForgedManagementFields_PreservesIdentity()
    {
        SysUser input = Draft(42, 2);
        input.RealName = "新姓名";
        input.Account = "forged";
        input.AccountType = AccountTypeEnum.SuperAdmin;
        input.Status = StatusEnum.Disable;
        input.OrgId = 90;
        input.PosId = 91;
        input.Password = "forged";
        input.CreateUserId = 99;
        await Service().UpdateBaseInfo(input);
        var stored = await _db.Queryable<SysUser>().Where(u => u.Id == 42).Select(u => new
        {
            u.RealName, u.Account, u.TenantId, u.AccountType, u.Status, u.OrgId, u.PosId, u.Password, u.CreateUserId
        }).FirstAsync();
        Assert.Equal("新姓名", stored.RealName);
        Assert.Equal("profile-42", stored.Account);
        Assert.Equal(1, stored.TenantId);
        Assert.Equal(AccountTypeEnum.NormalUser, stored.AccountType);
        Assert.Equal(StatusEnum.Enable, stored.Status);
        Assert.Equal(10, stored.OrgId);
        Assert.Equal(11, stored.PosId);
        Assert.Equal("unchanged", stored.Password);
        Assert.Equal(42, stored.CreateUserId);
    }

    [Fact]
    public async Task UpdateBaseInfo_DuplicatePhone_RejectsWithoutWriting()
    {
        SysUser input = Draft(42, 1);
        input.Phone = Draft(43, 2).Phone;
        await Assert.ThrowsAnyAsync<Exception>(() => Service().UpdateBaseInfo(input));
        Assert.Equal(Draft(42, 1).Phone, await _db.Queryable<SysUser>().Where(u => u.Id == 42).Select(u => u.Phone).FirstAsync());
    }

    [Fact]
    public async Task UpdateBaseInfo_UnchangedLegacyDuplicatePhone_AllowsOtherProfileChanges()
    {
        SysUser input = Draft(42, 1);
        await _db.Ado.ExecuteCommandAsync("UPDATE SysUser SET Phone = @phone WHERE Id = 43", new SugarParameter("@phone", input.Phone));
        input.RealName = "新姓名";
        await Service().UpdateBaseInfo(input);
        Assert.Equal("新姓名", await _db.Queryable<SysUser>().Where(u => u.Id == 42).Select(u => u.RealName).FirstAsync());
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previous;
        _db.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
