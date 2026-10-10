// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Furion.FriendlyException;
using Microsoft.Extensions.Hosting;
using Xunit;

[assembly: AssemblyFixture(typeof(Admin.NET.Test.Region.RegionTestHost))]

namespace Admin.NET.Test.Region;

public class RegionContractTests
{
    [Theory]
    [InlineData("110000", "110000")]
    [InlineData("110000001", "110000001")]
    [InlineData("110000001001", "110000001001")]
    [InlineData("  110000  ", "110000")]
    [InlineData("\tABCDEF\r\n", "ABCDEF")]
    [InlineData("ABC123xyz", "ABC123xyz")]
    [InlineData("ABC123xyz789", "ABC123xyz789")]
    [InlineData("A BCDE", "A BCDE")]
    public void NormalizeCode_ExistingLengthContract_TrimsAndPreservesCharacters(string code, string expected)
    {
        var normalized = RegionContracts.NormalizeCode(code);

        Assert.Equal(expected, normalized);
    }

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("   ")]
    [InlineData("12345")]
    [InlineData("1234567")]
    [InlineData("12345678")]
    [InlineData("1234567890")]
    [InlineData("12345678901")]
    [InlineData("1234567890123")]
    public void NormalizeCode_InvalidLength_RejectsBeforeAnyStorageAccess(string code)
    {
        Assert.Throws<AppFriendlyException>(() => RegionContracts.NormalizeCode(code));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-1L)]
    [InlineData(long.MinValue)]
    public void EnsureValidId_NonpositiveId_Rejects(long id)
    {
        Assert.Throws<AppFriendlyException>(() => RegionContracts.EnsureValidId(id));
    }

    [Theory]
    [InlineData(1L)]
    [InlineData(9007199254740993L)]
    [InlineData(long.MaxValue)]
    public void EnsureValidId_PositiveLongId_AcceptsWithoutLoss(long id)
    {
        RegionContracts.EnsureValidId(id);
    }

    [Fact]
    public async Task ResolveParentIdAsync_Root_DoesNotReadParents()
    {
        var reads = 0;
        Task<SysRegion> ReadById(long _) { reads++; return Task.FromResult<SysRegion>(null); }
        Task<SysRegion> ReadByCode(string _) { reads++; return Task.FromResult<SysRegion>(null); }

        var parentId = await RegionContracts.ResolveParentIdAsync(0, ReadById, ReadByCode);

        Assert.Equal(0L, parentId);
        Assert.Equal(0, reads);
    }

    [Theory]
    [InlineData(-1L)]
    [InlineData(long.MinValue)]
    public async Task ResolveParentIdAsync_NegativeParent_RejectsWithoutReading(long suppliedParent)
    {
        var reads = 0;
        Task<SysRegion> ReadById(long _) { reads++; return Task.FromResult<SysRegion>(null); }
        Task<SysRegion> ReadByCode(string _) { reads++; return Task.FromResult<SysRegion>(null); }

        await Assert.ThrowsAsync<AppFriendlyException>(() => RegionContracts.ResolveParentIdAsync(suppliedParent, ReadById, ReadByCode));

        Assert.Equal(0, reads);
    }

    [Theory]
    [InlineData(110000L)]
    [InlineData(9007199254740993L)]
    [InlineData(long.MaxValue)]
    public async Task ResolveParentIdAsync_ExistingId_TakesPrecedenceOverCodeWithoutLoss(long suppliedParent)
    {
        var codeReads = 0;
        var parent = new SysRegion { Id = suppliedParent, Name = "父区域", Code = "ABCDEF" };

        var resolved = await RegionContracts.ResolveParentIdAsync(suppliedParent,
            id => Task.FromResult(id == suppliedParent ? parent : null),
            _ => { codeReads++; return Task.FromResult(new SysRegion { Id = 200 }); });

        Assert.Equal(suppliedParent, resolved);
        Assert.Equal(0, codeReads);
    }

    [Fact]
    public async Task ResolveParentIdAsync_IdMissing_FallsBackToExactCode()
    {
        var reads = new List<string>();
        var parent = new SysRegion { Id = 9007199254740993L, Code = "110000", Name = "父区域" };

        var resolved = await RegionContracts.ResolveParentIdAsync(110000,
            id => { reads.Add("id:" + id); return Task.FromResult<SysRegion>(null); },
            code => { reads.Add("code:" + code); return Task.FromResult(code == parent.Code ? parent : null); });

        Assert.Equal(parent.Id, resolved);
        Assert.Equal(new[] { "id:110000", "code:110000" }, reads);
    }

    [Fact]
    public async Task ResolveParentIdAsync_UnknownIdAndCode_RejectsAfterBothLookups()
    {
        var reads = new List<string>();

        await Assert.ThrowsAsync<AppFriendlyException>(() => RegionContracts.ResolveParentIdAsync(999999,
            id => { reads.Add("id:" + id); return Task.FromResult<SysRegion>(null); },
            code => { reads.Add("code:" + code); return Task.FromResult<SysRegion>(null); }));

        Assert.Equal(new[] { "id:999999", "code:999999" }, reads);
    }

    [Fact]
    public async Task EnsureValidParentAsync_Root_DoesNotReadDescendants()
    {
        var reads = 0;

        await RegionContracts.EnsureValidParentAsync(10, 0,
            () => { reads++; return Task.FromResult(new List<SysRegion>()); });

        Assert.Equal(0, reads);
    }

    [Fact]
    public async Task EnsureValidParentAsync_Self_RejectsWithoutDescendantRead()
    {
        var reads = 0;

        await Assert.ThrowsAsync<AppFriendlyException>(() => RegionContracts.EnsureValidParentAsync(10, 10,
            () => { reads++; return Task.FromResult(new List<SysRegion>()); }));

        Assert.Equal(0, reads);
    }

    [Fact]
    public async Task EnsureValidParentAsync_CodeResolvesToSelf_RejectsResolvedId()
    {
        var id = 9007199254740993L;
        var resolved = await RegionContracts.ResolveParentIdAsync(110000,
            _ => Task.FromResult<SysRegion>(null),
            _ => Task.FromResult(new SysRegion { Id = id, Code = "110000" }));
        var reads = 0;

        await Assert.ThrowsAsync<AppFriendlyException>(() => RegionContracts.EnsureValidParentAsync(id, resolved,
            () => { reads++; return Task.FromResult(new List<SysRegion>()); }));

        Assert.Equal(0, reads);
    }

    [Theory]
    [InlineData(20L)]
    [InlineData(30L)]
    public async Task EnsureValidParentAsync_DirectOrNestedDescendant_RejectsWithoutChangingTree(long parentId)
    {
        var descendants = new List<SysRegion>
        {
            new() { Id = 10, Pid = 0, Code = "100000" },
            new() { Id = 20, Pid = 10, Code = "200000" },
            new() { Id = 30, Pid = 20, Code = "300000" }
        };
        var originalParents = descendants.Select(region => region.Pid).ToArray();

        await Assert.ThrowsAsync<AppFriendlyException>(() => RegionContracts.EnsureValidParentAsync(10, parentId,
            () => Task.FromResult(descendants)));

        Assert.Equal(originalParents, descendants.Select(region => region.Pid).ToArray());
        Assert.Equal(3, descendants.Count);
    }

    [Fact]
    public async Task EnsureValidParentAsync_UnrelatedExistingParent_Accepts()
    {
        var reads = 0;

        await RegionContracts.EnsureValidParentAsync(10, 40,
            () => { reads++; return Task.FromResult(new List<SysRegion> { new() { Id = 10 }, new() { Id = 20, Pid = 10 } }); });

        Assert.Equal(1, reads);
    }

    [Theory]
    [InlineData("区域一", "110000", true)]
    [InlineData("区域二", "110000", false)]
    [InlineData("区域一", "220000", false)]
    [InlineData("区域二", "220000", false)]
    public void DuplicatePredicate_NameAndCodeCombination_PreservesExistingContract(string name, string code, bool expected)
    {
        var existing = new SysRegion { Id = 10, Name = "区域一", Code = "110000" };
        var predicate = RegionContracts.DuplicatePredicate(name, code).Compile();

        Assert.Equal(expected, predicate(existing));
    }

    [Fact]
    public void DuplicatePredicate_Update_ExcludesOnlyTheCurrentId()
    {
        var predicate = RegionContracts.DuplicatePredicate("区域一", "110000", 10).Compile();

        Assert.False(predicate(new SysRegion { Id = 10, Name = "区域一", Code = "110000" }));
        Assert.True(predicate(new SysRegion { Id = 20, Name = "区域一", Code = "110000" }));
    }

    [Theory]
    [InlineData(null)]
    [InlineData("12345")]
    public async Task AddRegion_InvalidCode_RejectsWithoutRepository(string code)
    {
        var service = new SysRegionService(null, null);

        await Assert.ThrowsAsync<AppFriendlyException>(() => service.AddRegion(new AddRegionInput { Name = "区域一", Code = code }));
    }

    [Fact]
    public async Task AddRegion_NegativeParent_RejectsWithoutRepository()
    {
        var service = new SysRegionService(null, null);

        await Assert.ThrowsAsync<AppFriendlyException>(() => service.AddRegion(new AddRegionInput { Name = "区域一", Code = "110000", Pid = -1 }));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-1L)]
    public async Task UpdateRegion_InvalidId_RejectsWithoutRepository(long id)
    {
        var service = new SysRegionService(null, null);

        await Assert.ThrowsAsync<AppFriendlyException>(() => service.UpdateRegion(new UpdateRegionInput { Id = id, Name = "区域一", Code = "110000" }));
    }

    [Theory]
    [InlineData(0L)]
    [InlineData(-1L)]
    public async Task DeleteRegion_InvalidId_RejectsWithoutRepository(long id)
    {
        var service = new SysRegionService(null, null);

        await Assert.ThrowsAsync<AppFriendlyException>(() => service.DeleteRegion(new DeleteRegionInput { Id = id }));
    }
}

/// <summary>
/// 在任何测试触发 App/Oops 静态初始化前提供 Furion 配置，程序集结束后释放宿主。
/// </summary>
public sealed class RegionTestHost : IDisposable
{
    private readonly IHost _host;

    public RegionTestHost()
    {
        // 只构建配置和依赖容器，不启动 Web 服务、后台任务或数据库连接。
        _host = Host.CreateDefaultBuilder().Inject(false).Build();
    }

    public void Dispose()
    {
        _host.Dispose();
    }
}
