// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SqlSugar;
using System.Reflection;
using System.Runtime.CompilerServices;
using System.Security.Claims;
using Xunit;

namespace Admin.NET.Test.Files;

[CollectionDefinition("FileDatabase", DisableParallelization = true)]
public class FileDatabaseCollection;

[Collection("FileDatabase")]
public class FileIsolationTests : IDisposable
{
    private readonly ITenant _previous = SqlSugarSetup.ITenant;
    private readonly string _path = Path.Combine(AppContext.BaseDirectory, $"adminnet-files-{Guid.NewGuid():N}.db");
    private readonly SqlSugarScope _db;
    private readonly TestProvider _provider = new();

    public FileIsolationTests()
    {
        _db = new SqlSugarScope(new ConnectionConfig
        {
            ConfigId = SqlSugarConst.MainConfigId, DbType = DbType.Sqlite,
            ConnectionString = $"Data Source={_path}", IsAutoCloseConnection = true,
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
        _db.CodeFirst.InitTables<SysFile>();
        _db.Insertable(new[]
        {
            Record(41, 1, false), Record(42, 2, false), Record(43, 2, true)
        }).ExecuteCommand();
    }

    private static SysFile Record(long id, long tenant, bool isPublic) => new()
    {
        Id = id, TenantId = tenant, FileName = $"文件-{id}", Suffix = ".png",
        FilePath = "test-files", Url = $"test-files/{id}.png", IsPublic = isPublic,
        CreateUserId = tenant, CreateTime = new DateTime(2026, 10, 9), BucketName = "Local",
        FileType = "相关文件", SizeKb = 1
    };

    private SysFileService Service(bool superAdmin = false)
    {
        // 仅跳过提供者的配置选择；服务方法仍使用真实 SQLite 仓储。
        var service = (SysFileService)RuntimeHelpers.GetUninitializedObject(typeof(SysFileService));
        var user = new UserManager(new HttpContextAccessor
        {
            HttpContext = new DefaultHttpContext
            {
                User = new ClaimsPrincipal(new ClaimsIdentity([
                    new Claim(ClaimConst.UserId, "1"), new Claim(ClaimConst.TenantId, "1"),
                    new Claim(ClaimConst.AccountType, ((int)(superAdmin ? AccountTypeEnum.SuperAdmin : AccountTypeEnum.NormalUser)).ToString())
                ], "Test"))
            }
        });
        Set("_userManager", user);
        Set("_sysFileRep", new SqlSugarRepository<SysFile>());
        Set("_customFileProvider", _provider);
        Set("_uploadOptions", new UploadOptions { MaxSize = 1, ContentType = ["image/png"] });
        return service;
        void Set(string name, object value) => typeof(SysFileService).GetField(name, BindingFlags.NonPublic | BindingFlags.Instance)!.SetValue(service, value);
    }

    [Fact]
    public async Task Page_ForgedTenant_OnlyOwnAndPublicFiles()
    {
        var result = await Service().Page(new PageFileInput { Page = 1, PageSize = 20, TenantId = 2 });
        Assert.Equal([41L, 43L], result.Items.Select(u => u.Id).Order().ToArray());
    }

    [Fact]
    public async Task Read_ForeignPrivateFile_RejectsAllReadVariants()
    {
        var service = Service();
        await Assert.ThrowsAnyAsync<Exception>(() => service.GetFile(42));
        await Assert.ThrowsAnyAsync<Exception>(() => service.GetPreview(42));
        await Assert.ThrowsAnyAsync<Exception>(() => service.DownloadFile(new SysFile { Id = 42 }));
        await Assert.ThrowsAnyAsync<Exception>(() => service.DownloadFile(new SysFile { Url = "test-files/42.png" }));
        await Assert.ThrowsAnyAsync<Exception>(() => service.DownloadFileBase64("test-files/42.png"));
        var files = await service.GetFileByIds([41, 42, 43]);
        Assert.Equal([41L, 43L], files.Select(u => u.Id).Order().ToArray());
    }

    [Fact]
    public async Task Download_PublicFile_PreservesChineseName()
    {
        var result = Assert.IsType<FileStreamResult>(await Service().DownloadFile(new SysFile { Id = 43 }));
        Assert.Equal("文件-43.png", result.FileDownloadName);
        await result.FileStream.DisposeAsync();
    }

    [Theory]
    [InlineData(42)]
    [InlineData(43)]
    public async Task Write_ForeignFile_RejectsEvenWhenPublic(long id)
    {
        var service = Service();
        await Assert.ThrowsAnyAsync<Exception>(() => service.UpdateFile(new SysFile { Id = id, FileName = "越权" }));
        await Assert.ThrowsAnyAsync<Exception>(() => service.DeleteFile(new BaseIdInput { Id = id }));
        Assert.Equal($"文件-{id}", _db.Queryable<SysFile>().InSingle(id).FileName);
        Assert.Empty(_provider.Deleted);
    }

    [Fact]
    public async Task Update_ForgedStorageAndIdentity_OnlySavesMetadata()
    {
        await Service().UpdateFile(new SysFile
        {
            Id = 41, FileName = "新名称", FileType = "归档文件", IsPublic = true, DataId = 123, FileAlias = "说明",
            TenantId = 2, CreateUserId = 99, FilePath = "../outside", Suffix = ".exe",
            Url = "https://example.invalid", BucketName = "Other", SizeKb = 999
        });
        var saved = _db.Queryable<SysFile>().InSingle(41);
        Assert.Equal("新名称", saved.FileName);
        Assert.Equal("归档文件", saved.FileType);
        Assert.True(saved.IsPublic);
        Assert.Equal(123, saved.DataId);
        Assert.Equal("说明", saved.FileAlias);
        Assert.Equal(1, saved.TenantId);
        Assert.Equal(1, saved.CreateUserId);
        Assert.Equal("test-files", saved.FilePath);
        Assert.Equal(".png", saved.Suffix);
        Assert.Equal("test-files/41.png", saved.Url);
        Assert.Equal("Local", saved.BucketName);
        Assert.Equal(1, saved.SizeKb);
    }

    [Theory]
    [InlineData("")]
    [InlineData(" ")]
    [InlineData("../escape")]
    public async Task Update_InvalidName_LeavesRecordUnchanged(string name)
    {
        await Assert.ThrowsAnyAsync<Exception>(() => Service().UpdateFile(new SysFile { Id = 41, FileName = name }));
        Assert.Equal("文件-41", _db.Queryable<SysFile>().InSingle(41).FileName);
    }

    [Fact]
    public async Task Delete_StorageFailure_KeepsDatabaseRecord()
    {
        _provider.FailDelete = true;
        await Assert.ThrowsAsync<IOException>(() => Service().DeleteFile(new BaseIdInput { Id = 41 }));
        Assert.True(_db.Queryable<SysFile>().Any(u => u.Id == 41));
    }

    [Fact]
    public async Task Upload_OneByteOverLimit_RejectsBeforeStorage()
    {
        using var bytes = new MemoryStream(new byte[1025]);
        await Assert.ThrowsAnyAsync<Exception>(() => Service().UploadFile(new UploadFileInput
        {
            File = new FormFile(bytes, 0, 1025, "file", "image.png") { Headers = new HeaderDictionary(), ContentType = "image/png" }
        }));
        Assert.Equal(3, _db.Queryable<SysFile>().Count());
    }

    public void Dispose()
    {
        SqlSugarSetup.ITenant = _previous;
        _db.Dispose();
        Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
        if (System.IO.File.Exists(_path)) System.IO.File.Delete(_path);
    }

    private sealed class TestProvider : ICustomFileProvider
    {
        public bool FailDelete { get; set; }
        public List<long> Deleted { get; } = [];
        public Task DeleteFileAsync(SysFile file)
        {
            if (FailDelete) throw new IOException("测试存储失败");
            Deleted.Add(file.Id);
            return Task.CompletedTask;
        }
        public Task<string> DownloadFileBase64Async(SysFile file) => Task.FromResult("ZmlsZQ==");
        public Task<FileStreamResult> GetFileStreamResultAsync(SysFile file, string name) =>
            Task.FromResult(new FileStreamResult(new MemoryStream([1, 2, 3]), "application/octet-stream") { FileDownloadName = name + file.Suffix });
        public Task<SysFile> UploadFileAsync(IFormFile file, SysFile record, string path, string name) => throw new NotSupportedException();
    }
}
