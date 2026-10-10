// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.IO.Compression;
using System.Text.Json;
using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Options;
using Xunit;

namespace Admin.NET.Test.Update;

public sealed class SystemUpdateBoundaryTests : IDisposable
{
    private readonly Guid _id = Guid.NewGuid();
    private readonly string _root;
    private readonly CDConfigOptions _options;

    public SystemUpdateBoundaryTests()
    {
        _root = Path.Combine(Path.GetTempPath(), "adminnet-update-tests-" + _id.ToString("N"));
        Directory.CreateDirectory(Path.Combine(_root, "live"));
        File.WriteAllText(Path.Combine(_root, UpdateDeploymentCoordinator.MarkerFileName), _id.ToString());
        File.WriteAllText(Path.Combine(_root, "live", "VERSION"), "v1");
        _options = new CDConfigOptions
        {
            Enabled = true, AllowedDeploymentRoot = _root, BackendOutput = Path.Combine(_root, "live"), DeploymentId = _id.ToString(),
            Repo = "Admin.NET", Branch = "main", Owner = "fixture", AccessToken = "unit-fixture-token",
            RepositoryArchiveUrl = "http://127.0.0.1:8080/archive.zip", PublishTimeoutSeconds = 10,
            Publish = new PublishOptions { Configuration = "Release", TargetFramework = "net10.0", RuntimeIdentifier = "win-x64" }
        };
    }

    private UpdateDeploymentCoordinator Coordinator() => new(Options.Create(_options));

    [Fact]
    public void MissingAuthorization_DisablesExecutionWithoutDisclosingConfiguration()
    {
        _options.AllowedDeploymentRoot = null;
        var status = Coordinator().GetStatus();
        Assert.False(status.Enabled);
        var json = JsonSerializer.Serialize(status);
        Assert.DoesNotContain(_root, json);
        Assert.DoesNotContain(_options.AccessToken, json);
        Assert.DoesNotContain(_options.RepositoryArchiveUrl, json);
        Assert.Throws<ArgumentException>(() => Coordinator().ValidateConfiguration());
    }

    [Fact]
    public void ExplicitlyDisabledDeployment_IsNotExecutable()
    {
        _options.Enabled = false;
        Assert.False(Coordinator().GetStatus().Enabled);
        Assert.Throws<ArgumentException>(() => Coordinator().ValidateConfiguration());
    }

    [Fact]
    public void ValidMarkerAndChildDirectory_AuthorizeNamedTargetOnly()
    {
        var paths = Coordinator().ValidateConfiguration();
        Assert.Equal(_root, paths.Root);
        Assert.Equal(Path.Combine(_root, "live"), paths.Live);
        var status = Coordinator().GetStatus();
        Assert.True(status.Enabled);
        Assert.Equal("隔离更新部署", status.TargetName);
        Assert.DoesNotContain(_root, JsonSerializer.Serialize(status));
    }

    [Fact]
    public void IncorrectMarker_RejectsDeployment()
    {
        File.WriteAllText(Path.Combine(_root, UpdateDeploymentCoordinator.MarkerFileName), Guid.NewGuid().ToString());
        Assert.Throws<ArgumentException>(() => Coordinator().ValidateConfiguration());
    }

    [Fact]
    public void RootItself_IsNotADeploymentChild()
    {
        _options.BackendOutput = _root;
        Assert.Throws<ArgumentException>(() => Coordinator().ValidateConfiguration());
        Assert.False(UpdateDeploymentCoordinator.IsChildOf(_root, _root));
        Assert.False(UpdateDeploymentCoordinator.IsChildOf(_root, _root + "-neighbor"));
    }

    [Fact]
    public void RepositoryMarker_RejectsSourceTreeOperations()
    {
        Directory.CreateDirectory(Path.Combine(_root, ".git"));
        Assert.Throws<ArgumentException>(() => Coordinator().ValidateConfiguration());
    }

    [Theory]
    [InlineData(null)]
    [InlineData("http://localhost:8080/archive.zip")]
    [InlineData("file:///C:/archive.zip")]
    [InlineData("http://person:secret@127.0.0.1/archive.zip")]
    [InlineData("http://127.0.0.1/archive.zip?access_token=example")]
    [InlineData("http://127.0.0.1/archive.zip#fragment")]
    public void UnboundedArchiveOrigins_AreRejected(string uri)
    {
        Assert.Throws<ArgumentException>(() => UpdateDeploymentCoordinator.ValidateArchiveUri(uri));
    }

    [Theory]
    [InlineData("../escape.txt")]
    [InlineData("folder/../../escape.txt")]
    [InlineData("/absolute.txt")]
    [InlineData("C:/outside.txt")]
    [InlineData("folder\\..\\escape.txt")]
    [InlineData("folder/.git/config")]
    public void InvalidArchivePath_IsRejectedBeforeAnyExtraction(string name)
    {
        using var stream = Archive(name);
        var destination = Path.Combine(_root, "extract");
        Assert.Throws<ArgumentException>(() => UpdateDeploymentCoordinator.ExtractArchive(stream, destination));
        Assert.False(Directory.Exists(destination));
        Assert.Equal("v1", File.ReadAllText(Path.Combine(_root, "live", "VERSION")));
    }

    [Fact]
    public void ArchiveSymlink_IsRejectedBeforeExtraction()
    {
        using var stream = Archive("link", unchecked((int)0xA1FF0000));
        Assert.Throws<ArgumentException>(() => UpdateDeploymentCoordinator.ExtractArchive(stream, Path.Combine(_root, "extract")));
    }

    [Fact]
    public void CompleteSnapshotReplacement_RetainsRollbackUntilCleanup()
    {
        var coordinator = Coordinator();
        var paths = coordinator.ValidateConfiguration();
        var operation = coordinator.CreateOperationDirectory(paths);
        var candidate = Path.Combine(operation, "candidate");
        Directory.CreateDirectory(candidate);
        File.WriteAllText(Path.Combine(candidate, "VERSION"), "v2");
        UpdateDeploymentCoordinator.ReplaceDeployment(paths, candidate, operation);
        Assert.Equal("v2", File.ReadAllText(Path.Combine(paths.Live, "VERSION")));
        Assert.Equal("v1", File.ReadAllText(Path.Combine(operation, "previous", "VERSION")));
        coordinator.DeleteOperationDirectory(paths, operation, replacementCompleted: true);
        Assert.False(Directory.Exists(operation));
        Assert.Equal("v2", File.ReadAllText(Path.Combine(paths.Live, "VERSION")));
    }

    [Fact]
    public void MissingCandidate_DoesNotMoveExistingDeployment()
    {
        var coordinator = Coordinator();
        var paths = coordinator.ValidateConfiguration();
        var operation = coordinator.CreateOperationDirectory(paths);
        Assert.ThrowsAny<IOException>(() => UpdateDeploymentCoordinator.ReplaceDeployment(paths, Path.Combine(operation, "missing"), operation));
        Assert.Equal("v1", File.ReadAllText(Path.Combine(paths.Live, "VERSION")));
    }

    [Fact]
    public void CleanupCannotDeleteLiveDirectory()
    {
        var coordinator = Coordinator();
        var paths = coordinator.ValidateConfiguration();
        Assert.Throws<ArgumentException>(() => coordinator.DeleteOperationDirectory(paths, paths.Live));
        Assert.Equal("v1", File.ReadAllText(Path.Combine(paths.Live, "VERSION")));
    }

    [Fact]
    public void EmptyBackupSnapshot_CanBeRestored()
    {
        using var stream = new MemoryStream();
        using (new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true)) { }
        stream.Position = 0;
        var destination = Path.Combine(_root, "empty-snapshot");
        UpdateDeploymentCoordinator.ExtractArchive(stream, destination, allowEmpty: true);
        Assert.True(Directory.Exists(destination));
        Assert.Empty(Directory.EnumerateFileSystemEntries(destination));
    }

    [Fact]
    public async Task OverlappingMutation_IsRejectedAndGateIsReleasedAfterFailure()
    {
        var coordinator = Coordinator();
        var started = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var finish = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        var running = coordinator.RunExclusiveAsync(async _ => { started.SetResult(); await finish.Task; }, CancellationToken.None);
        await started.Task;
        try
        {
            Assert.True(coordinator.IsRunning);
            await Assert.ThrowsAsync<InvalidOperationException>(() => coordinator.RunExclusiveAsync(_ => Task.CompletedTask, CancellationToken.None));
        }
        finally { finish.TrySetResult(); await running; }
        Assert.False(coordinator.IsRunning);
        await Assert.ThrowsAsync<InvalidOperationException>(() => coordinator.RunExclusiveAsync(_ => throw new InvalidOperationException("fixture"), CancellationToken.None));
        Assert.False(coordinator.IsRunning);
        await coordinator.RunExclusiveAsync(_ => Task.CompletedTask, CancellationToken.None);
    }

    [Fact]
    public async Task PreCancelledMutation_DoesNotRunAction()
    {
        var called = false;
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => Coordinator().RunExclusiveAsync(_ => { called = true; return Task.CompletedTask; }, new CancellationToken(true)));
        Assert.False(called);
    }

    [Theory]
    [InlineData("status", "sysUpdate:list", nameof(SysUpdateService.GetStatus))]
    [InlineData("list", "sysUpdate:list", nameof(SysUpdateService.List))]
    [InlineData("logs", "sysUpdate:logs", nameof(SysUpdateService.LogList))]
    [InlineData("update", "sysUpdate:update", nameof(SysUpdateService.Update))]
    [InlineData("restore", "sysUpdate:restore", nameof(SysUpdateService.Restore))]
    [InlineData("clear", "sysUpdate:clear", nameof(SysUpdateService.ClearLog))]
    [InlineData("webHookKey", "sysUpdate:webHookKey", nameof(SysUpdateService.GetWebHookKey))]
    public void ManualEndpoints_RequireOriginalExplicitGrantAndSuppressMonitor(string action, string permission, string method)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/api/sysUpdate/" + action;
        Assert.Equal(permission, RoutePermissionUtil.GetPermissionName(context));
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
        var attributes = typeof(SysUpdateService).GetMethod(method)!.GetCustomAttributes(false);
        Assert.DoesNotContain(attributes, attribute => attribute.GetType().Name == "AllowAnonymousAttribute");
        Assert.Contains(attributes, attribute => attribute.GetType().Name == "SuppressMonitorAttribute");
    }

    [Fact]
    public void DeploymentCannotOverlapApiOrWorkingDirectoryInEitherDirection()
    {
        var basePath = Path.Combine(_root, "api");
        Assert.True(UpdateDeploymentCoordinator.DirectoriesOverlap(basePath, Path.Combine(basePath, "wwwroot")));
        Assert.True(UpdateDeploymentCoordinator.DirectoriesOverlap(Path.Combine(basePath, "plugins"), basePath));
        Assert.True(UpdateDeploymentCoordinator.DirectoriesOverlap(basePath, basePath));
        Assert.False(UpdateDeploymentCoordinator.DirectoriesOverlap(basePath, Path.Combine(_root, "isolated-target")));
    }

    [Fact]
    public void IncompleteReplacement_CleanupPreservesOriginalDeployment()
    {
        var coordinator = Coordinator();
        var paths = coordinator.ValidateConfiguration();
        var operation = coordinator.CreateOperationDirectory(paths);
        Directory.Move(paths.Live, Path.Combine(operation, "previous"));
        Assert.Throws<InvalidOperationException>(() => coordinator.DeleteOperationDirectory(paths, operation));
        Assert.Equal("v1", File.ReadAllText(Path.Combine(operation, "previous", "VERSION")));
    }

    [Fact]
    public void SelfCreatedSnapshot_IsRestorableAndRetainsPriorDeployment()
    {
        var coordinator = Coordinator();
        var paths = coordinator.ValidateConfiguration();
        var backup = coordinator.CreateBackup(paths);
        Assert.True(UpdateDeploymentCoordinator.IsOwnedBackupName(Path.GetFileName(backup), _options.Repo));
        var destination = Path.Combine(_root, "restored");
        using var stream = File.OpenRead(backup);
        UpdateDeploymentCoordinator.ExtractArchive(stream, destination, allowEmpty: true);
        Assert.Equal("v1", File.ReadAllText(Path.Combine(destination, "VERSION")));
    }

    [Fact]
    public void FailedSnapshot_DoesNotExposePartialBackupOrRemoveExistingSnapshot()
    {
        var coordinator = Coordinator();
        var paths = coordinator.ValidateConfiguration();
        var existing = coordinator.CreateBackup(paths);
        using var locked = File.Open(Path.Combine(paths.Live, "VERSION"), FileMode.Open, FileAccess.ReadWrite, FileShare.None);
        Assert.ThrowsAny<IOException>(() => coordinator.CreateBackup(paths));
        Assert.Equal([existing], Directory.GetFiles(_root, "*.zip"));
        Assert.Empty(Directory.GetFiles(_root, "*.tmp"));
    }

    [Fact]
    public void OversizeDeployment_IsRejectedBeforeBackupOrReplacement()
    {
        using (var stream = File.Create(Path.Combine(_options.BackendOutput, "oversize.bin"))) stream.SetLength(512L * 1024 * 1024 + 1);
        var coordinator = Coordinator();
        Assert.Throws<ArgumentException>(() => coordinator.ValidateConfiguration());
        Assert.Throws<ArgumentException>(() => coordinator.CreateBackup(new UpdateDeploymentPaths(_root, _options.BackendOutput)));
        Assert.Empty(Directory.EnumerateFiles(_root, "*.zip"));
        Assert.Equal("v1", File.ReadAllText(Path.Combine(_options.BackendOutput, "VERSION")));
    }

    [Theory]
    [InlineData("Admin.NET_2026_10_10.zip", true)]
    [InlineData("Admin.NET_2026_10_10_131800123_0123456789abcdef0123456789abcdef.zip", true)]
    [InlineData("Admin.NET-unrelated.zip", false)]
    [InlineData("Admin.NET-other_2026_10_10.zip", false)]
    [InlineData("Admin.NET_2026_10_10_bad.zip", false)]
    public void BackupOwnership_DoesNotIncludeUnrelatedArchives(string fileName, bool expected)
    {
        Assert.Equal(expected, UpdateDeploymentCoordinator.IsOwnedBackupName(fileName, _options.Repo));
    }

    [Fact]
    public void Sm2WebHookKey_IsStableAcrossRequestsAndInstances()
    {
        var key = UpdateDeploymentCoordinator.DeriveStableWebHookKey("fixture-secret");
        Assert.Equal(key, UpdateDeploymentCoordinator.DeriveStableWebHookKey("fixture-secret"));
        Assert.NotEqual(key, UpdateDeploymentCoordinator.DeriveStableWebHookKey("other-secret"));
        Assert.DoesNotContain("fixture-secret", key);
    }

    [Fact]
    public void WebHookRejectsExpiredFutureAndPreviouslyUsedSignatures()
    {
        var coordinator = Coordinator();
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        coordinator.RegisterWebHook(now.ToString(), "fixture-signature");
        Assert.Throws<ArgumentException>(() => coordinator.RegisterWebHook(now.ToString(), "fixture-signature"));
        Assert.Throws<ArgumentException>(() => coordinator.RegisterWebHook((now - 600000).ToString(), "old-signature"));
        Assert.Throws<ArgumentException>(() => coordinator.RegisterWebHook((now + 600000).ToString(), "future-signature"));
        Assert.Throws<ArgumentException>(() => coordinator.RegisterWebHook("not-a-time", "other-signature"));
    }

    [Theory]
    [InlineData(@"SDK C:\Program Files\dotnet\sdk\10.0.100\NuGet.targets(174): error restore failed")]
    [InlineData(@"Restored C:\Users\fixture\.nuget\packages\secret\project.csproj (in 100 ms)")]
    [InlineData("Restored /home/fixture/private/project.csproj (in 100 ms)")]
    public void PublishLogs_RemoveAbsoluteSdkAndCachePaths(string message)
    {
        var sanitized = UpdateDeploymentCoordinator.SanitizePaths(message);
        Assert.DoesNotContain("fixture", sanitized);
        Assert.DoesNotContain("Program Files", sanitized);
        Assert.Contains("路径已脱敏", sanitized);
    }

    private static MemoryStream Archive(string name, int? attributes = null)
    {
        var stream = new MemoryStream();
        using (var archive = new ZipArchive(stream, ZipArchiveMode.Create, leaveOpen: true))
        {
            var entry = archive.CreateEntry(name);
            if (attributes.HasValue) entry.ExternalAttributes = attributes.Value;
            using var writer = new StreamWriter(entry.Open());
            writer.Write("fixture");
        }
        stream.Position = 0;
        return stream;
    }

    public void Dispose()
    {
        var resolved = Path.GetFullPath(_root);
        if (Path.GetFileName(resolved) != "adminnet-update-tests-" + _id.ToString("N") || !UpdateDeploymentCoordinator.IsChildOf(Path.GetTempPath(), resolved))
            throw new InvalidOperationException("Refuse cleanup outside the owned test fixture");
        if (Directory.Exists(resolved)) Directory.Delete(resolved, true);
    }
}
