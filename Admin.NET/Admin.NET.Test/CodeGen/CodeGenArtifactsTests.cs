// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using System.IO.Compression;
using System.Security.Cryptography;
using System.Text;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public class CodeGenArtifactsTests
{
    [Theory]
    [InlineData("100", 7)]
    [InlineData("111", 3)]
    [InlineData("121", 4)]
    [InlineData("200", 7)]
    [InlineData("211", 3)]
    [InlineData("221", 4)]
    public void CreatePlan_PersistedGenerationType_SelectsSameTemplatesAndVbenPaths(string type, int count)
    {
        var plan = CodeGenArtifacts.CreatePlan(Configuration(type), "Web");
        Assert.Equal(count, plan.Count);
        Assert.Equal(plan.Count, plan.Select(file => file.Template).Distinct().Count());
        Assert.All(plan.Where(file => !file.Template.EndsWith(".cs")), file => Assert.StartsWith("Web/apps/web-antdv-next/src/", file.RelativePath));
        Assert.DoesNotContain(plan, file => file.RelativePath.Contains("Web/src/"));
    }

    [Theory]
    [InlineData("110")]
    [InlineData("invalid")]
    [InlineData("")]
    public void CreatePlan_UnknownGenerationType_Rejects(string type)
    {
        Assert.ThrowsAny<Exception>(() => CodeGenArtifacts.CreatePlan(Configuration(type), "Web"));
    }

    [Theory]
    [InlineData("../outside")]
    [InlineData("main/../../outside")]
    [InlineData("C:\\outside")]
    [InlineData("main//empty")]
    [InlineData("main/NUL")]
    public void CreatePlan_UnsafeSavedPagePath_Rejects(string path)
    {
        var configuration = Configuration();
        configuration.PagePath = path;
        Assert.ThrowsAny<Exception>(() => CodeGenArtifacts.CreatePlan(configuration, "Web"));
    }

    [Fact]
    public async Task CreateArchive_ConcurrentSameEntity_PreservesEveryCompleteFileAndHash()
    {
        var root = TemporaryRoot();
        try
        {
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var contents = plans.ToDictionary(file => file.Template, file => file.Template + "\n" + new string('中', 100000));
            var archives = await Task.WhenAll(Enumerable.Range(0, 3).Select(_ => CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, contents)));
            Assert.Equal(3, archives.Select(archive => archive.FileName).Distinct().Count());
            foreach (var archive in archives)
            {
                var path = Path.Combine(root, "CodeGen", archive.FileName);
                Assert.Equal(archive.Sha256, Convert.ToHexString(SHA256.HashData(await File.ReadAllBytesAsync(path))).ToLowerInvariant());
                using var zip = ZipFile.OpenRead(path);
                Assert.Equal(plans.Count, zip.Entries.Count);
                foreach (var manifest in archive.Manifest)
                {
                    var entry = Assert.Single(zip.Entries, entry => entry.FullName == manifest.Path);
                    await using var source = entry.Open();
                    using var bytes = new MemoryStream();
                    await source.CopyToAsync(bytes);
                    Assert.Equal(contents[manifest.Template], Encoding.UTF8.GetString(bytes.ToArray()));
                    Assert.Equal(manifest.Size, bytes.Length);
                    Assert.Equal(manifest.Sha256, Convert.ToHexString(SHA256.HashData(bytes.ToArray())).ToLowerInvariant());
                }
            }
            Assert.Empty(Directory.GetFiles(Path.Combine(root, "CodeGen"), "*.tmp"));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task CreateArchive_MissingRenderedFile_DoesNotPublishOrInvokeBusinessAction()
    {
        var root = TemporaryRoot();
        try
        {
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var invoked = false;
            await Assert.ThrowsAnyAsync<Exception>(() => CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, new Dictionary<string, string>(), () =>
            {
                invoked = true;
                return Task.CompletedTask;
            }));
            Assert.False(invoked);
            Assert.Empty(Directory.GetFileSystemEntries(root));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task CreateArchive_BusinessActionFails_RemovesPendingArchive()
    {
        var root = TemporaryRoot();
        try
        {
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var contents = plans.ToDictionary(file => file.Template, file => file.Template + " complete");
            await Assert.ThrowsAsync<InvalidOperationException>(() => CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, contents,
                () => throw new InvalidOperationException("业务动作失败")));
            Assert.Empty(Directory.GetFiles(root, "*", SearchOption.AllDirectories));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task CreateArchive_Cancelled_DoesNotPublishArchive()
    {
        var root = TemporaryRoot();
        try
        {
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var contents = plans.ToDictionary(file => file.Template, file => file.Template);
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, contents,
                cancellationToken: cancellation.Token));
            Assert.Empty(Directory.GetFileSystemEntries(root));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task CreateArchive_PublishAction_SeesCompleteArchiveWithoutStagingDirectory()
    {
        var root = TemporaryRoot();
        try
        {
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var contents = plans.ToDictionary(file => file.Template, file => file.Template + " complete");
            var invoked = false;
            await CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, contents, () =>
            {
                var pending = Assert.Single(Directory.GetFiles(Path.Combine(root, "CodeGen"), "*.tmp"));
                var operationId = Path.GetFileNameWithoutExtension(pending).TrimStart('.');
                Assert.True(Guid.TryParseExact(operationId, "N", out _));
                Assert.False(Directory.Exists(Path.Combine(Path.GetTempPath(), "adminnet-codegen", operationId)));
                using var zip = ZipFile.OpenRead(pending);
                Assert.Equal(plans.Count, zip.Entries.Count);
                invoked = true;
                return Task.CompletedTask;
            });
            Assert.True(invoked);
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task CreateArchive_PartialWriteFails_RemovesTemporaryFilesAndPreservesEarlierArchive()
    {
        var root = TemporaryRoot();
        try
        {
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var contents = plans.ToDictionary(file => file.Template, file => file.Template + " complete");
            var earlier = await CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, contents);
            var earlierPath = Path.Combine(root, "CodeGen", earlier.FileName);
            var originalBytes = await File.ReadAllBytesAsync(earlierPath);
            var conflictingPlans = new[] { new CodeGenArtifactPlan("first", "collision"), new CodeGenArtifactPlan("second", "collision/second.txt") };
            var conflictingContents = new Dictionary<string, string> { ["first"] = "first complete", ["second"] = "second complete" };

            await Assert.ThrowsAsync<IOException>(() => CodeGenArtifacts.CreateArchiveAsync(root, "Probe", conflictingPlans, conflictingContents));

            Assert.Equal(originalBytes, await File.ReadAllBytesAsync(earlierPath));
            Assert.Equal(earlierPath, Assert.Single(Directory.GetFiles(root, "*", SearchOption.AllDirectories)));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task CreateArchive_CancelledAfterWrite_RemovesPendingDownload()
    {
        var root = TemporaryRoot();
        try
        {
            using var cancellation = new CancellationTokenSource();
            var plans = CodeGenArtifacts.CreatePlan(Configuration(), "Web");
            var contents = plans.ToDictionary(file => file.Template, file => file.Template + " complete");
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CodeGenArtifacts.CreateArchiveAsync(root, "Probe", plans, contents,
                () => { cancellation.Cancel(); return Task.CompletedTask; }, cancellation.Token));
            Assert.Empty(Directory.GetFiles(root, "*", SearchOption.AllDirectories));
        }
        finally { Directory.Delete(root, true); }
    }
    private static SysCodeGen Configuration(string type = "100") => new()
    {
        Id = 7, TableName = "Probe", NameSpace = "Admin.NET.Application", PagePath = "main/example", GenerateType = type
    };

    private static string TemporaryRoot()
    {
        var root = Path.Combine(Path.GetTempPath(), "adminnet-codegen43-test", Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }
}