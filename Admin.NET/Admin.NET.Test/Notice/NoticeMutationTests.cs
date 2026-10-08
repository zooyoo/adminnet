// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using SqlSugar;
using System.Reflection;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.Notice;

[CollectionDefinition("NoticeDatabase", DisableParallelization = true)]
public class NoticeDatabaseCollection;

[Collection("NoticeDatabase")]
public class NoticeMutationTests : IDisposable
{
    private readonly ITenant _previousTenant = SqlSugarSetup.ITenant;
    private readonly SqlSugarScope _database;
    private readonly string _file = Path.Combine(AppContext.BaseDirectory, $"adminnet-notice-{Guid.NewGuid():N}.db");
    private readonly SysNoticeService _service;
    private readonly UserManager _user;
    private readonly DateTime _readTime = new(2026, 10, 1, 10, 0, 0);

    public NoticeMutationTests()
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
        // 与生产 DataExecuting 合同一致，只为缺失的 long 主键分配 ID。
        _database.Aop.DataExecuting = (_, info) =>
        {
            if (info.OperationType == DataFilterType.InsertByObject && info.EntityColumnInfo.IsPrimarykey &&
                info.EntityColumnInfo.PropertyInfo.PropertyType == typeof(long) &&
                (long)info.EntityColumnInfo.PropertyInfo.GetValue(info.EntityValue) == 0)
                info.SetValue(Interlocked.Increment(ref nextId));
        };
        try
        {
            _database.CodeFirst.InitTables<SysNotice, SysNoticeUser, SysOnlineUser>();
            _database.Insertable(new[]
            {
                new SysNotice { Id = 1, TenantId = 1, Title = "own draft", Content = "<p>original</p>", Type = NoticeTypeEnum.NOTICE, CreateUserId = 42, PublicUserId = 42, Status = NoticeStatusEnum.DRAFT },
                new SysNotice { Id = 2, TenantId = 1, Title = "foreign draft", Content = "<p>private</p>", Type = NoticeTypeEnum.NOTICE, CreateUserId = 99, PublicUserId = 99, Status = NoticeStatusEnum.DRAFT },
                new SysNotice { Id = 3, TenantId = 1, Title = "published", Content = "<p>published</p>", Type = NoticeTypeEnum.ANNOUNCEMENT, CreateUserId = 42, PublicUserId = 42, Status = NoticeStatusEnum.PUBLIC, PublicTime = _readTime.AddDays(-1) }
            }).ExecuteCommand();
            _database.Insertable(new[]
            {
                new SysNoticeUser { Id = 11, TenantId = 1, NoticeId = 3, UserId = 42, ReadStatus = NoticeUserStatusEnum.READ, ReadTime = _readTime },
                new SysNoticeUser { Id = 12, TenantId = 1, NoticeId = 3, UserId = 99, ReadStatus = NoticeUserStatusEnum.UNREAD }
            }).ExecuteCommand();
            ClaimsIdentity identity = new(new[]
            {
                new Claim(ClaimConst.UserId, "42"),
                new Claim(ClaimConst.TenantId, "1"),
                new Claim(ClaimConst.AccountType, ((int)AccountTypeEnum.SysAdmin).ToString())
            }, "Test");
            _user = new(new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = new ClaimsPrincipal(identity) } });
            SysOnlineUserService online = new(null, null, new SqlSugarRepository<SysOnlineUser>(), _user, null, null);
            _service = new SysNoticeService(_user, null, new SqlSugarRepository<SysNotice>(), new SqlSugarRepository<SysNoticeUser>(), online);
        }
        catch
        {
            Dispose();
            throw;
        }
    }

    [Fact]
    public async Task UpdateNotice_ForgedOwner_CannotChangeForeignNotice()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _service.UpdateNotice(new UpdateNoticeInput
        {
            Id = 2, CreateUserId = 42, Title = "forged", Content = "overwritten", Type = NoticeTypeEnum.NOTICE
        }));
        Assert.Equal("foreign draft", _database.Queryable<SysNotice>().InSingle(2).Title);
    }

    [Fact]
    public async Task UpdateNotice_OmittedOwner_UsesStoredOwnership()
    {
        await _service.UpdateNotice(new UpdateNoticeInput { Id = 1, Title = "edited", Content = "<p>edited</p>", Type = NoticeTypeEnum.ANNOUNCEMENT });
        SysNotice notice = _database.Queryable<SysNotice>().InSingle(1);
        Assert.Equal("edited", notice.Title);
        Assert.Equal(42, notice.CreateUserId);
        Assert.Equal(NoticeTypeEnum.ANNOUNCEMENT, notice.Type);
    }

    [Fact]
    public async Task UpdateNotice_ForgedStatusAndPublisher_ChangesOnlyEditableFields()
    {
        await _service.UpdateNotice(new UpdateNoticeInput
        {
            Id = 1, CreateUserId = 42, Title = "edited", Content = "edited", Type = NoticeTypeEnum.NOTICE,
            Status = NoticeStatusEnum.PUBLIC, PublicTime = _readTime, PublicUserId = 99, CancelTime = _readTime
        });
        SysNotice notice = _database.Queryable<SysNotice>().InSingle(1);
        Assert.Equal(NoticeStatusEnum.DRAFT, notice.Status);
        Assert.Null(notice.PublicTime);
        Assert.Null(notice.CancelTime);
        Assert.Equal(42, notice.PublicUserId);
    }

    [Fact]
    public async Task UpdateNotice_PublishedNotice_RejectsAndPreservesContent()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _service.UpdateNotice(new UpdateNoticeInput
        {
            Id = 3, CreateUserId = 42, Title = "edited", Content = "edited", Type = NoticeTypeEnum.NOTICE
        }));
        Assert.Equal("published", _database.Queryable<SysNotice>().InSingle(3).Title);
        Assert.Equal(NoticeStatusEnum.PUBLIC, _database.Queryable<SysNotice>().InSingle(3).Status);
    }

    [Fact]
    public async Task Public_AlreadyPublished_DoesNotChangePublicationOrReadRecords()
    {
        await _service.Public(new NoticeInput { Id = 3 });
        await _service.Public(new NoticeInput { Id = 3 });
        Assert.Equal(_readTime.AddDays(-1), _database.Queryable<SysNotice>().InSingle(3).PublicTime);
        Assert.Equal(2, _database.Queryable<SysNoticeUser>().Count());
        Assert.Equal(_readTime, _database.Queryable<SysNoticeUser>().InSingle(11).ReadTime);
    }

    [Fact]
    public async Task SetRead_AlreadyRead_PreservesFirstReadTimestamp()
    {
        await _service.SetRead(new NoticeInput { Id = 3 });
        Assert.Equal(_readTime, _database.Queryable<SysNoticeUser>().InSingle(11).ReadTime);
        Assert.Equal(NoticeUserStatusEnum.UNREAD, _database.Queryable<SysNoticeUser>().InSingle(12).ReadStatus);
    }

    [Fact]
    public async Task Public_RecipientLookupFails_RollsBackPublishedState()
    {
        // 故意省略用户仓储模拟收件人查询故障，状态更新必须随事务回滚。
        await Assert.ThrowsAnyAsync<Exception>(() => _service.Public(new NoticeInput { Id = 1 }));
        SysNotice notice = _database.Queryable<SysNotice>().InSingle(1);
        Assert.Equal(NoticeStatusEnum.DRAFT, notice.Status);
        Assert.Null(notice.PublicTime);
        Assert.Equal(2, _database.Queryable<SysNoticeUser>().Count());
    }

    [Fact]
    public async Task DeleteNotice_MissingNotice_ReturnsControlledError()
    {
        Exception error = await Assert.ThrowsAnyAsync<Exception>(() => _service.DeleteNotice(new DeleteNoticeInput { Id = 999 }));
        Assert.IsNotType<NullReferenceException>(error);
    }

    [Fact]
    public async Task DeleteNotice_ForeignNotice_PreservesRecord()
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _service.DeleteNotice(new DeleteNoticeInput { Id = 2 }));
        Assert.NotNull(_database.Queryable<SysNotice>().InSingle(2));
    }

    [Fact]
    public async Task AddNotice_ForgedLifecycleFields_CreatesOwnedDraftOnly()
    {
        await _service.AddNotice(new AddNoticeInput
        {
            Id = 900, Title = "new draft", Content = "<p>body</p>", Type = NoticeTypeEnum.NOTICE,
            CreateUserId = 99, PublicUserId = 99, Status = NoticeStatusEnum.PUBLIC, PublicTime = _readTime,
            CancelTime = _readTime
        });
        SysNotice notice = _database.Queryable<SysNotice>().First(row => row.Title == "new draft");
        Assert.NotEqual(900, notice.Id);
        Assert.Equal(42, notice.CreateUserId);
        Assert.Equal(42, notice.PublicUserId);
        Assert.Equal(NoticeStatusEnum.DRAFT, notice.Status);
        Assert.Null(notice.PublicTime);
        Assert.Null(notice.CancelTime);
    }

    [Theory]
    [InlineData("", "content", 1)]
    [InlineData("title", " ", 1)]
    [InlineData("title", "content", 0)]
    [InlineData("title", "content", 3)]
    [InlineData("123456789012345678901234567890123", "content", 1)]
    public async Task AddNotice_InvalidContent_DoesNotInsert(string title, string content, int type)
    {
        await Assert.ThrowsAnyAsync<Exception>(() => _service.AddNotice(new AddNoticeInput
        {
            Title = title, Content = content, Type = (NoticeTypeEnum)type
        }));
        Assert.Equal(3, _database.Queryable<SysNotice>().Count());
    }

    [Fact]
    public async Task Public_DraftWithRecipients_CommitsBeforeNotification()
    {
        RecordingHub hub = new();
        SysNoticeService service = CreatePublishingService(hub);
        hub.OnNotice = () =>
        {
            // 使用独立连接证明推送时其他请求已能看到提交结果，而非读取本事务的未提交数据。
            using SqlSugarClient observer = new(new ConnectionConfig
            {
                DbType = DbType.Sqlite, ConnectionString = $"Data Source={_file}",
                IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute
            });
            Assert.Equal(NoticeStatusEnum.PUBLIC, observer.Queryable<SysNotice>().InSingle(1).Status);
            Assert.Equal(2, observer.Queryable<SysNoticeUser>().Count(row => row.NoticeId == 1));
        };
        await service.Public(new NoticeInput { Id = 1 });
        Assert.Equal(1, hub.Delivered);
        Assert.All(_database.Queryable<SysNoticeUser>().Where(row => row.NoticeId == 1).ToList(),
            row => Assert.Equal(NoticeUserStatusEnum.UNREAD, row.ReadStatus));
    }

    [Fact]
    public async Task Public_NotificationFails_RetryPreservesCommittedRecipients()
    {
        RecordingHub hub = new() { Fail = true };
        SysNoticeService service = CreatePublishingService(hub);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.Public(new NoticeInput { Id = 1 }));
        var before = _database.Queryable<SysNoticeUser>().Where(row => row.NoticeId == 1).OrderBy(row => row.UserId).ToList();
        Assert.Equal(2, before.Count);
        await service.SetRead(new NoticeInput { Id = 1 });
        hub.Fail = false;
        await service.Public(new NoticeInput { Id = 1 });
        var after = _database.Queryable<SysNoticeUser>().Where(row => row.NoticeId == 1).OrderBy(row => row.UserId).ToList();
        Assert.Equal(before.Select(row => row.Id), after.Select(row => row.Id));
        Assert.Equal(NoticeUserStatusEnum.READ, after.Single(row => row.UserId == 42).ReadStatus);
        Assert.Equal(1, hub.Delivered);
    }

    private SysNoticeService CreatePublishingService(RecordingHub hub)
    {
        // 发布仅查询用户 ID，使用真实 SQLite 的最小投影避免 SysUser 构造器依赖应用宿主。
        _database.Ado.ExecuteCommand("CREATE TABLE SysUser (Id INTEGER PRIMARY KEY, TenantId INTEGER, Account TEXT NOT NULL)");
        _database.Ado.ExecuteCommand("INSERT INTO SysUser (Id, TenantId, Account) VALUES (42, 1, 'author'), (99, 1, 'reader')");
        _database.Insertable(new SysOnlineUser { Id = 80, UserId = 99, TenantId = 1, UserName = "reader", ConnectionId = "reader-connection" }).ExecuteCommand();
        SysOnlineUserService online = new(null, hub, new SqlSugarRepository<SysOnlineUser>(), _user, null, null);
        return new SysNoticeService(_user, new SqlSugarRepository<SysUser>(), new SqlSugarRepository<SysNotice>(), new SqlSugarRepository<SysNoticeUser>(), online);
    }

    private sealed class RecordingHub : IHubContext<OnlineUserHub, IOnlineUserHub>, IOnlineUserHub
    {
        public bool Fail { get; set; }
        public int Delivered { get; private set; }
        public Action OnNotice { get; set; }
        public IHubClients<IOnlineUserHub> Clients => new RecordingClients(this);
        public IGroupManager Groups => null;
        public Task PublicNotice(SysNotice notice)
        {
            if (Fail) throw new InvalidOperationException("Simulated delivery failure");
            OnNotice?.Invoke();
            Delivered++;
            return Task.CompletedTask;
        }
        public Task ForceOffline(object context) => Task.CompletedTask;
        public Task OnlineUserList(OnlineUserList context) => Task.CompletedTask;
        public Task ReceiveMessage(object context) => Task.CompletedTask;
    }

    private sealed class RecordingClients(IOnlineUserHub client) : IHubClients<IOnlineUserHub>
    {
        public IOnlineUserHub All => client;
        public IOnlineUserHub AllExcept(IReadOnlyList<string> ids) => client;
        public IOnlineUserHub Client(string id) => client;
        public IOnlineUserHub Clients(IReadOnlyList<string> ids) => client;
        public IOnlineUserHub Group(string name) => client;
        public IOnlineUserHub GroupExcept(string name, IReadOnlyList<string> ids) => client;
        public IOnlineUserHub Groups(IReadOnlyList<string> names) => client;
        public IOnlineUserHub User(string id) => client;
        public IOnlineUserHub Users(IReadOnlyList<string> ids) => client;
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previousTenant;
        _database.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (File.Exists(_file)) File.Delete(_file);
    }
}
