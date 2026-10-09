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

namespace Admin.NET.Test.Schedule;

[CollectionDefinition("ScheduleDatabase", DisableParallelization = true)]
public class ScheduleDatabaseCollection;

[Collection("ScheduleDatabase")]
public class ScheduleIsolationTests : IDisposable
{
    private readonly ITenant _previous = SqlSugarSetup.ITenant;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-schedule-{Guid.NewGuid():N}.db");
    private readonly SqlSugarScope _db;

    public ScheduleIsolationTests()
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
        try
        {
            _db.CodeFirst.InitTables<SysSchedule>();
            _db.Insertable(new[]
            {
                Record(10, 42, 1), Record(11, 43, 1), Record(12, 42, 2)
            }).ExecuteCommand();
        }
        catch { Dispose(); throw; }
    }

    private static SysSchedule Record(long id, long user, long tenant) => new()
    {
        Id = id, UserId = user, TenantId = tenant, Content = "原日程",
        ScheduleTime = new DateTime(2026, 10, 9), StartTime = "09:00", EndTime = "10:00"
    };

    private static SysScheduleService Service()
    {
        UserManager user = new(new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity(new[]
                {
                    new Claim(ClaimConst.UserId, "42"), new Claim(ClaimConst.TenantId, "1"),
                    new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.SuperAdmin).ToString())
                }, "Test"))
            }
        });
        return new SysScheduleService(user, new SqlSugarRepository<SysSchedule>());
    }

    private static UpdateScheduleInput Draft(long id = 10) => new()
    {
        Id = id, UserId = 999, TenantId = 2, Content = "修改日程",
        ScheduleTime = new DateTime(2026, 10, 10, 12, 0, 0), StartTime = "13:00", EndTime = "14:00"
    };

    [Fact]
    public async Task Page_WithForeignTenant_OnlyReturnsOwnCurrentTenant()
    {
        // 准备：超管也不能把个人日程查询变成其他身份的查询。
        List<SysSchedule> result = await Service().Page(new ListScheduleInput { TenantId = 2 });
        Assert.Single(result);
        Assert.Equal(10, result[0].Id);
    }

    [Theory]
    [InlineData(11)]
    [InlineData(12)]
    [InlineData(99)]
    public async Task Mutations_WithForeignOrMissingId_RejectWithoutChanges(long id)
    {
        SysScheduleService service = Service();
        await Assert.ThrowsAnyAsync<Exception>(() => service.GetDetail(id));
        await Assert.ThrowsAnyAsync<Exception>(() => service.UpdateUserSchedule(Draft(id)));
        await Assert.ThrowsAnyAsync<Exception>(() => service.DeleteUserSchedule(new DeleteScheduleInput { Id = id }));
        await Assert.ThrowsAnyAsync<Exception>(() => service.SetStatus(new ScheduleInput { Id = id, Status = FinishStatusEnum.Finish }));
        Assert.Equal(3, await _db.Queryable<SysSchedule>().CountAsync());
        Assert.All(await _db.Queryable<SysSchedule>().ToListAsync(), row => Assert.Equal("原日程", row.Content));
    }

    [Fact]
    public async Task Update_WithForgedIdentity_OnlyUpdatesEditableFields()
    {
        await Service().UpdateUserSchedule(Draft());
        SysSchedule row = await _db.Queryable<SysSchedule>().InSingleAsync(10);
        Assert.Equal(42, row.UserId);
        Assert.Equal(1, row.TenantId);
        Assert.Equal("修改日程", row.Content);
        Assert.Equal(new DateTime(2026, 10, 10), row.ScheduleTime);
    }

    [Theory]
    [InlineData("", "10:00", "内容")]
    [InlineData("14:00", "10:00", "内容")]
    [InlineData("24:00", "25:00", "内容")]
    [InlineData("09:00", "10:00", "   ")]
    public async Task Update_WithInvalidInput_RejectsAndPreservesRecord(string start, string end, string content)
    {
        UpdateScheduleInput input = Draft();
        input.StartTime = start; input.EndTime = end; input.Content = content;
        await Assert.ThrowsAnyAsync<Exception>(() => Service().UpdateUserSchedule(input));
        Assert.Equal("原日程", (await _db.Queryable<SysSchedule>().InSingleAsync(10)).Content);
    }

    [Fact]
    public async Task SetStatusAndDelete_WithOwnId_PersistsChanges()
    {
        Assert.Equal(1, await Service().SetStatus(new ScheduleInput { Id = 10, Status = FinishStatusEnum.Finish }));
        Assert.Equal(FinishStatusEnum.Finish, (await Service().GetDetail(10)).Status);
        await Service().DeleteUserSchedule(new DeleteScheduleInput { Id = 10 });
        Assert.False(await _db.Queryable<SysSchedule>().AnyAsync(row => row.Id == 10));
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previous;
        _db.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
