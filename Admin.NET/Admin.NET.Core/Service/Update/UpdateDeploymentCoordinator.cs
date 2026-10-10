// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.IO.Compression;
using System.Net;
using System.Text.RegularExpressions;

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统更新的授权目录、发布命令与单任务边界
/// </summary>
public sealed class UpdateDeploymentCoordinator : ISingleton
{
    public const string MarkerFileName = ".adminnet-update-target";
    private readonly CDConfigOptions _options;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly object _webHookSync = new();
    private readonly Dictionary<string, long> _acceptedWebHooks = new(StringComparer.Ordinal);
    private static StringComparison PathComparison => OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
    private static StringComparer PathComparer => OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal;

    public UpdateDeploymentCoordinator(IOptions<CDConfigOptions> options)
    {
        _options = options.Value;
    }

    public object LogSync { get; } = new();
    public bool IsRunning => _gate.CurrentCount == 0;

    public UpdateStatusOutput GetStatus()
    {
        try
        {
            ValidateConfiguration();
            return new UpdateStatusOutput { Enabled = true, TargetName = _options.DeploymentName, IsRunning = IsRunning };
        }
        catch (ArgumentException ex)
        {
            return new UpdateStatusOutput { Reason = ex.Message, IsRunning = IsRunning };
        }
        catch (IOException)
        {
            return new UpdateStatusOutput { Reason = "无法读取授权部署目标", IsRunning = IsRunning };
        }
        catch (UnauthorizedAccessException)
        {
            return new UpdateStatusOutput { Reason = "授权部署目标不可访问", IsRunning = IsRunning };
        }
    }

    public UpdateDeploymentPaths ValidateConfiguration()
    {
        if (!_options.Enabled) throw new ArgumentException("持续部署未启用");
        if (string.IsNullOrWhiteSpace(_options.AllowedDeploymentRoot) || string.IsNullOrWhiteSpace(_options.BackendOutput) ||
            !Guid.TryParse(_options.DeploymentId, out var deploymentId)) throw new ArgumentException("尚未配置已授权的隔离部署");
        if (!Path.IsPathFullyQualified(_options.AllowedDeploymentRoot) || !Path.IsPathFullyQualified(_options.BackendOutput))
            throw new ArgumentException("授权部署目录必须是绝对路径");
        var root = Path.TrimEndingDirectorySeparator(Path.GetFullPath(_options.AllowedDeploymentRoot));
        var live = Path.TrimEndingDirectorySeparator(Path.GetFullPath(_options.BackendOutput));
        if (!Directory.Exists(root) || !Directory.Exists(live) || !IsChildOf(root, live)) throw new ArgumentException("部署目录必须位于已授权根目录内");
        CheckAncestors(root);
        CheckAncestors(live);
        if (DirectoriesOverlap(live, AppContext.BaseDirectory) || DirectoriesOverlap(live, Environment.CurrentDirectory))
            throw new ArgumentException("禁止更新当前 API 或开发进程的运行目录");
        var marker = Path.Combine(root, MarkerFileName);
        if (!File.Exists(marker) || (File.GetAttributes(marker) & FileAttributes.ReparsePoint) != 0 || new FileInfo(marker).Length > 128 ||
            !Guid.TryParse(File.ReadAllText(marker).Trim(), out var markerId) || markerId != deploymentId)
            throw new ArgumentException("隔离部署授权标识不匹配");
        if (string.IsNullOrWhiteSpace(_options.DeploymentName) || _options.DeploymentName.Length > 128 || _options.DeploymentName.Any(char.IsControl))
            throw new ArgumentException("部署名称无效");
        if (string.IsNullOrWhiteSpace(_options.Repo) || !Regex.IsMatch(_options.Repo, "^[A-Za-z0-9_-][A-Za-z0-9._-]{0,99}$"))
            throw new ArgumentException("仓库名称无效");
        if (_options.Publish == null || !Regex.IsMatch(_options.Publish.Configuration ?? "", "^[A-Za-z0-9_-]{1,32}$") ||
            !Regex.IsMatch(_options.Publish.TargetFramework ?? "", "^net[0-9]+\\.[0-9]+(?:-[a-z0-9.]+)?$") ||
            !Regex.IsMatch(_options.Publish.RuntimeIdentifier ?? "", "^[A-Za-z0-9.-]{1,64}$") || _options.PublishTimeoutSeconds is < 1 or > 1800)
            throw new ArgumentException("编译发布配置无效");
        if (_options.UpdateInterval < 0 || _options.BackupCount < 0) throw new ArgumentException("更新间隔与保留备份数量不能为负数");
        if ((_options.ExcludeFiles ?? []).Any(pattern => string.IsNullOrWhiteSpace(pattern) || pattern.Contains('/') || pattern.Contains('\\') || pattern is "." or ".."))
            throw new ArgumentException("排除文件只能配置部署目录顶层文件模式");
        if (!string.IsNullOrWhiteSpace(_options.RepositoryArchiveUrl)) ValidateArchiveUri(_options.RepositoryArchiveUrl);
        else if (string.IsNullOrWhiteSpace(_options.Owner) || string.IsNullOrWhiteSpace(_options.AccessToken) || string.IsNullOrWhiteSpace(_options.Branch))
            throw new ArgumentException("仓库来源尚未配置");
        ValidateTree(live, enforceSnapshotLimits: true);
        return new UpdateDeploymentPaths(root, live);
    }

    public static Uri ValidateArchiveUri(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Length > 2048 || !Uri.TryCreate(value, UriKind.Absolute, out var uri) || uri.Scheme is not ("http" or "https") ||
            !IPAddress.TryParse(uri.Host.Trim('[', ']'), out _) || !string.IsNullOrEmpty(uri.UserInfo) || !string.IsNullOrEmpty(uri.Query) || !string.IsNullOrEmpty(uri.Fragment))
            throw new ArgumentException("隔离仓库来源必须是无凭据的明确数字 IP 地址");
        return uri;
    }

    public async Task RunExclusiveAsync(Func<CancellationToken, Task> action, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        if (!await _gate.WaitAsync(0, cancellationToken)) throw new InvalidOperationException("已有更新或还原任务正在执行");
        try { await action(cancellationToken); }
        finally { _gate.Release(); }
    }

    public string CreateOperationDirectory(UpdateDeploymentPaths paths)
    {
        var directory = Path.Combine(paths.Root, ".operation-" + Guid.NewGuid().ToString("N"));
        if (!IsChildOf(paths.Root, directory)) throw new ArgumentException("临时操作目录越界");
        Directory.CreateDirectory(directory);
        return directory;
    }

    public void DeleteOperationDirectory(UpdateDeploymentPaths paths, string directory, bool replacementCompleted = false)
    {
        var resolved = Path.GetFullPath(directory);
        if (!IsChildOf(paths.Root, resolved) || !Regex.IsMatch(Path.GetFileName(resolved), "^\\.operation-[a-f0-9]{32}$"))
            throw new ArgumentException("拒绝清理未识别的操作目录");
        if (!Directory.Exists(resolved)) return;
        ValidateTree(resolved);
        if (!replacementCompleted && Directory.Exists(Path.Combine(resolved, "previous")))
            throw new InvalidOperationException("替换或回滚未完成，已保留原部署恢复目录，请检查目标部署");
        Directory.Delete(resolved, true);
    }

    public static void ValidateTree(string directory, bool enforceSnapshotLimits = false)
    {
        long size = 0;
        var count = 0;
        var stack = new Stack<string>();
        stack.Push(directory);
        while (stack.TryPop(out var current))
        {
            if ((File.GetAttributes(current) & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("部署目录不能包含链接或重解析点");
            foreach (var entry in Directory.EnumerateFileSystemEntries(current))
            {
                var attributes = File.GetAttributes(entry);
                if ((attributes & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("部署文件不能包含链接或重解析点");
                if (Path.GetFileName(entry).Equals(".git", StringComparison.OrdinalIgnoreCase)) throw new ArgumentException("禁止操作源码仓库目录");
                if (enforceSnapshotLimits)
                {
                    if (++count > 10000) throw new ArgumentException("部署快照文件数量超出可还原上限");
                    if ((attributes & FileAttributes.Directory) == 0) size = checked(size + new FileInfo(entry).Length);
                    if (size > 512L * 1024 * 1024) throw new ArgumentException("部署快照大小超出可还原上限");
                }
                if ((attributes & FileAttributes.Directory) != 0) stack.Push(entry);
            }
        }
    }

    public static void ExtractArchive(Stream source, string destination, bool allowEmpty = false)
    {
        using var archive = new ZipArchive(source, ZipArchiveMode.Read, leaveOpen: true);
        ValidateArchive(archive, destination, allowEmpty);
        Directory.CreateDirectory(destination);
        archive.ExtractToDirectory(destination, true);
        ValidateTree(destination, enforceSnapshotLimits: true);
    }

    private static void ValidateArchive(ZipArchive archive, string destination, bool allowEmpty)
    {
        if ((!allowEmpty && archive.Entries.Count == 0) || archive.Entries.Count > 10000) throw new ArgumentException("更新压缩包为空或文件数量超出上限");
        var files = new HashSet<string>(PathComparer);
        long size = 0;
        foreach (var entry in archive.Entries)
        {
            var name = entry.FullName.Replace('\\', '/');
            var parts = name.Split('/', StringSplitOptions.RemoveEmptyEntries);
            var path = Path.GetFullPath(Path.Combine(destination, name));
            if (parts.Length == 0 || Path.IsPathRooted(name) || parts.Any(part => part is "." or ".." || part.Contains(':') || part.Equals(".git", StringComparison.OrdinalIgnoreCase)) ||
                !IsChildOf(destination, path) || ((entry.ExternalAttributes >> 16) & 0xF000) == 0xA000 || (entry.ExternalAttributes & (int)FileAttributes.ReparsePoint) != 0)
                throw new ArgumentException("压缩包包含不允许的路径或链接");
            size = checked(size + entry.Length);
            if (size > 512L * 1024 * 1024) throw new ArgumentException("压缩包展开大小超出上限");
            if (!name.EndsWith('/') && !files.Add(path)) throw new ArgumentException("压缩包包含重复文件");
        }

    }

    public static void ReplaceDeployment(UpdateDeploymentPaths paths, string candidate, string operationDirectory)
    {
        if (!IsChildOf(operationDirectory, candidate) || !IsChildOf(paths.Root, operationDirectory) || !IsChildOf(paths.Root, paths.Live))
            throw new ArgumentException("部署替换目录越界");
        ValidateTree(candidate, enforceSnapshotLimits: true);
        ValidateTree(paths.Live, enforceSnapshotLimits: true);
        var previous = Path.Combine(operationDirectory, "previous");
        if (Directory.Exists(previous)) throw new ArgumentException("回滚目录已存在");
        Directory.Move(paths.Live, previous);
        try { Directory.Move(candidate, paths.Live); }
        catch
        {
            Directory.Move(previous, paths.Live);
            throw;
        }
    }

    public async Task PublishAsync(string backendDirectory, string output, Action<string> log, CancellationToken cancellationToken)
    {
        var option = _options.Publish;
        var startInfo = new ProcessStartInfo("dotnet")
        {
            WorkingDirectory = backendDirectory, RedirectStandardOutput = true, RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8, StandardErrorEncoding = Encoding.UTF8, UseShellExecute = false, CreateNoWindow = true
        };
        foreach (var argument in new[] { "publish", "Admin.NET.Web.Entry", "-c", option.Configuration, "-f", option.TargetFramework, "-r", option.RuntimeIdentifier,
                     "--output", output, "--disable-build-servers", "-m:1", "-p:UseSharedCompilation=false" }) startInfo.ArgumentList.Add(argument);
        using var process = new Process { StartInfo = startInfo };
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        timeout.CancelAfter(TimeSpan.FromSeconds(_options.PublishTimeoutSeconds));
        process.Start();
        async Task ReadLines(StreamReader reader, string prefix)
        {
            string line;
            while ((line = await reader.ReadLineAsync(timeout.Token)) != null)
                if (!string.IsNullOrWhiteSpace(line)) log(prefix + line.Trim());
        }
        var outputTask = ReadLines(process.StandardOutput, "");
        var errorTask = ReadLines(process.StandardError, "发布错误：");
        try
        {
            await Task.WhenAll(process.WaitForExitAsync(timeout.Token), outputTask, errorTask);
        }
        catch (OperationCanceledException)
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            if (cancellationToken.IsCancellationRequested) throw;
            throw new TimeoutException("编译发布超时，未替换部署文件");
        }
        catch
        {
            if (!process.HasExited) process.Kill(entireProcessTree: true);
            await process.WaitForExitAsync(CancellationToken.None);
            throw;
        }
        if (process.ExitCode != 0) throw new InvalidOperationException($"编译发布失败（退出码 {process.ExitCode}），未替换部署文件");
        if (!Directory.Exists(output) || !Directory.EnumerateFiles(output).Any()) throw new InvalidOperationException("编译未生成部署文件");
        ValidateTree(output);
    }

    public string CreateBackup(UpdateDeploymentPaths paths)
    {
        ValidateTree(paths.Live, enforceSnapshotLimits: true);
        var backup = Path.Combine(paths.Root, $"{_options.Repo}_{DateTime.UtcNow:yyyy_MM_dd_HHmmssfff}_{Guid.NewGuid():N}.zip");
        if (!IsChildOf(paths.Root, backup)) throw new ArgumentException("备份目录越界");
        var pending = backup + ".tmp";
        try
        {
            ZipFile.CreateFromDirectory(paths.Live, pending);
            using (var archive = new ZipArchive(File.OpenRead(pending), ZipArchiveMode.Read))
                ValidateArchive(archive, Path.Combine(paths.Root, ".snapshot-validation"), allowEmpty: true);
            File.Move(pending, backup);
            return backup;
        }
        catch
        {
            if (File.Exists(pending)) File.Delete(pending);
            throw;
        }
    }

    public static bool IsOwnedBackupName(string name, string repo) => Regex.IsMatch(name,
        "^" + Regex.Escape(repo) + @"_\d{4}_\d{2}_\d{2}(?:_\d{9}_[a-f0-9]{32})?\.zip$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    public void RegisterWebHook(string timestamp, string signature)
    {
        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
        if (!long.TryParse(timestamp, out var issuedAt) || issuedAt < now - 300000 || issuedAt > now + 300000)
            throw new ArgumentException("WebHook 时间戳无效或已过期");
        if (string.IsNullOrEmpty(signature) || signature.Length > 256) throw new ArgumentException("WebHook 签名无效");
        lock (_webHookSync)
        {
            foreach (var expired in _acceptedWebHooks.Where(pair => pair.Value <= now).Select(pair => pair.Key).ToArray()) _acceptedWebHooks.Remove(expired);
            if (_acceptedWebHooks.Count >= 4096 || !_acceptedWebHooks.TryAdd(signature, now + 300000))
                throw new ArgumentException("WebHook 签名已使用或请求过于频繁");
        }
    }

    public static string DeriveStableWebHookKey(string token)
    {
        if (string.IsNullOrWhiteSpace(token)) throw new ArgumentException("WebHook 密钥尚未配置");
        return Convert.ToBase64String(System.Security.Cryptography.HMACSHA256.HashData(Encoding.UTF8.GetBytes(token), Encoding.UTF8.GetBytes("Admin.NET.SysUpdate.WebHook")));
    }

    public static string SanitizePaths(string message)
    {
        var result = Regex.Replace(message ?? string.Empty, @"(?:[a-zA-Z]:[\\/]|\\\\)[^\r\n""'<>\[\]]+", "[路径已脱敏]");
        return Regex.Replace(result, @"(?<![\w:])/(?:[^/\s""'<>]+/)+[^\s""'<>]*", "[路径已脱敏]");
    }

    public static bool DirectoriesOverlap(string first, string second) => IsSameOrChildOf(Path.GetFullPath(first), Path.GetFullPath(second)) || IsSameOrChildOf(Path.GetFullPath(second), Path.GetFullPath(first));

    public static bool IsChildOf(string root, string path) => Path.GetFullPath(path).StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)) + Path.DirectorySeparatorChar, PathComparison);
    private static bool IsSameOrChildOf(string root, string path) => Path.TrimEndingDirectorySeparator(root).Equals(Path.TrimEndingDirectorySeparator(path), PathComparison) || IsChildOf(root, path);

    private static void CheckAncestors(string path)
    {
        for (var directory = new DirectoryInfo(path); directory != null; directory = directory.Parent)
        {
            if ((directory.Attributes & FileAttributes.ReparsePoint) != 0) throw new ArgumentException("授权部署路径不能通过链接或重解析点访问");
            if (Directory.Exists(Path.Combine(directory.FullName, ".git")) || File.Exists(Path.Combine(directory.FullName, ".git")))
                throw new ArgumentException("禁止操作当前源码仓库及其子目录");
        }
    }
}

public sealed record UpdateDeploymentPaths(string Root, string Live);
