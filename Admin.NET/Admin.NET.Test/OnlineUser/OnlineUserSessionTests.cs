// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;
using NewLife.Caching;
using SqlSugar;
using System.Reflection;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.OnlineUser;

[CollectionDefinition("OnlineUserDatabase", DisableParallelization = true)]
public class OnlineUserDatabaseCollection;

[Collection("OnlineUserDatabase")]
public class OnlineUserSessionTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _database;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-online-{Guid.NewGuid():N}.db");
    private readonly string _prefix = $"online-test:{Guid.NewGuid():N}:";
    private readonly SysCacheService _cache;
    private readonly RecordingHub _hub = new();

    public OnlineUserSessionTests()
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
        _cache = new SysCacheService(new CacheProvider { Cache = Cache.Default }, Options.Create(new CacheOptions { Prefix = _prefix }));
        _database.CodeFirst.InitTables<SysOnlineUser>();
        _database.Insertable(new[]
        {
            new SysOnlineUser { Id = 11, UserId = 101, TenantId = 1, ConnectionId = "same-a", UserName = "same" },
            new SysOnlineUser { Id = 12, UserId = 101, TenantId = 1, ConnectionId = "same-b", UserName = "same" },
            new SysOnlineUser { Id = 21, UserId = 201, TenantId = 2, ConnectionId = "foreign", UserName = "foreign" }
        }).ExecuteCommand();
        _cache.Set(CacheConst.KeyConfig + ConfigConst.SysLoginOutReminder, "False");
    }

    [Theory]
    [InlineData(AccountTypeEnum.SysAdmin, 2)]
    [InlineData(AccountTypeEnum.SuperAdmin, 1)]
    public async Task Page_WithForeignTenantFilter_RespectsIdentity(AccountTypeEnum type, int expected)
    {
        SysOnlineUserService service = CreateService(type);
        var result = await service.Page(new PageOnlineUserInput { Page = 1, PageSize = 20, TenantId = 2 });
        Assert.Equal(expected, result.Total);
        Assert.All(result.Items, row => Assert.Equal(type == AccountTypeEnum.SuperAdmin ? 2 : 1, row.TenantId));
    }

    [Fact]
    public async Task ForceOffline_SelectedSession_PreservesOtherSessionsAndNewerCache()
    {
        SysOnlineUser newer = _database.Queryable<SysOnlineUser>().InSingle(12);
        _cache.HashAddOrUpdate(CacheConst.KeyUserOnline, "101", newer);
        _cache.HashAddOrUpdate(CacheConst.KeyUserOnline, "101same-a", _database.Queryable<SysOnlineUser>().InSingle(11));
        SysOnlineUserService service = CreateService(AccountTypeEnum.SysAdmin);

        await service.ForceOffline(new SysOnlineUser { Id = 11, ConnectionId = "same-a", UserName = "forged", UserId = 999 });

        Assert.Equal(new[] { "same-a" }, _hub.Forced);
        Assert.Equal(2, _database.Queryable<SysOnlineUser>().Count());
        Assert.Equal("same-b", _cache.HashGetOne<SysOnlineUser>(CacheConst.KeyUserOnline, "101").ConnectionId);
        Assert.Null(_cache.HashGetOne<SysOnlineUser>(CacheConst.KeyUserOnline, "101same-a"));
    }

    [Theory]
    [InlineData(11, "foreign")]
    [InlineData(21, "foreign")]
    [InlineData(999, "missing")]
    [InlineData(0, "same-a")]
    public async Task ForceOffline_ForgedOrMissingTarget_RejectsWithoutSending(long id, string connection)
    {
        SysOnlineUserService service = CreateService(AccountTypeEnum.SysAdmin);
        await Assert.ThrowsAnyAsync<Exception>(() => service.ForceOffline(new SysOnlineUser { Id = id, ConnectionId = connection, UserName = "forged" }));
        Assert.Empty(_hub.Forced);
        Assert.Equal(3, _database.Queryable<SysOnlineUser>().Count());
    }

    [Theory]
    [InlineData("same-a", false)]
    [InlineData("foreign", true)]
    [InlineData("", true)]
    public async Task ForceOfflineConnection_UnauthorizedOrInvalidTarget_DoesNotSend(string connection, bool permission)
    {
        SysOnlineUserService service = CreateService(AccountTypeEnum.SysAdmin, permission);
        await Assert.ThrowsAnyAsync<Exception>(() => service.ForceOfflineConnection(connection));
        Assert.Empty(_hub.Forced);
        Assert.Equal(3, _database.Queryable<SysOnlineUser>().Count());
    }

    [Fact]
    public async Task ForceOfflineConnection_AuthorizedTarget_UsesStoredIdentity()
    {
        await CreateService(AccountTypeEnum.SysAdmin).ForceOfflineConnection("same-b");
        Assert.Equal(new[] { "same-b" }, _hub.Forced);
        Assert.Equal(2, _database.Queryable<SysOnlineUser>().Count());
    }

    [Fact]
    public void OnlineHub_AnonymousClient_RequiresAuthorization()
    {
        Assert.NotNull(typeof(OnlineUserHub).GetCustomAttribute<AuthorizeAttribute>());
    }

    private SysOnlineUserService CreateService(AccountTypeEnum type, bool permitted = true)
    {
        ClaimsIdentity identity = new(new[]
        {
            new Claim(ClaimConst.UserId, "42"),
            new Claim(ClaimConst.TenantId, "1"),
            new Claim(ClaimConst.AccountType, ((int)type).ToString())
        }, "Test");
        UserManager user = new(new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } });
        _cache.Set(CacheConst.KeyUserButton + 42, permitted ? new List<string> { "sysOnlineUser:forceOffline" } : new List<string>());
        SysMenuService menus = new(null, null, null, null, null, _cache, user, null, null);
        SysConfigService config = new(null, null, _cache, user);
        return new SysOnlineUserService(config, _hub, new SqlSugarRepository<SysOnlineUser>(), user, menus, _cache);
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previousTenant;
        _database.Dispose();
        foreach (string key in Cache.Default.Keys.Where(key => key.StartsWith(_prefix)).ToArray()) Cache.Default.Remove(key);
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }

    private sealed class RecordingHub : IHubContext<OnlineUserHub, IOnlineUserHub>
    {
        public List<string> Forced { get; } = [];
        public IHubClients<IOnlineUserHub> Clients => new RecordingClients(Forced);
        public IGroupManager Groups => null;
    }

    private sealed class RecordingClients(List<string> forced) : IHubClients<IOnlineUserHub>
    {
        public IOnlineUserHub All => new RecordingClient(forced, "all");
        public IOnlineUserHub AllExcept(IReadOnlyList<string> excludedConnectionIds) => All;
        public IOnlineUserHub Client(string connectionId) => new RecordingClient(forced, connectionId);
        public IOnlineUserHub Clients(IReadOnlyList<string> connectionIds) => All;
        public IOnlineUserHub Group(string groupName) => All;
        public IOnlineUserHub GroupExcept(string groupName, IReadOnlyList<string> excludedConnectionIds) => All;
        public IOnlineUserHub Groups(IReadOnlyList<string> groupNames) => All;
        public IOnlineUserHub User(string userId) => All;
        public IOnlineUserHub Users(IReadOnlyList<string> userIds) => All;
    }

    private sealed class RecordingClient(List<string> forced, string connection) : IOnlineUserHub
    {
        public Task ForceOffline(object context) { forced.Add(connection); return Task.CompletedTask; }
        public Task OnlineUserList(OnlineUserList context) => Task.CompletedTask;
        public Task PublicNotice(SysNotice context) => Task.CompletedTask;
        public Task ReceiveMessage(object context) => Task.CompletedTask;
    }
}
