// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.IO.Compression;
using System.Net;
using System.Security.Cryptography;

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统更新管理服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 390)]
public class SysUpdateService : IDynamicApiController, ITransient
{
    private readonly SysCacheService _sysCacheService;
    private readonly CDConfigOptions _cdConfigOptions;
    private readonly UpdateDeploymentCoordinator _deployment;

    public SysUpdateService(IOptions<CDConfigOptions> options, SysCacheService sysCacheService, UpdateDeploymentCoordinator deployment)
    {
        _cdConfigOptions = options.Value;
        _sysCacheService = sysCacheService;
        _deployment = deployment;
    }

    /// <summary>
    /// 获取脱敏的隔离部署授权状态
    /// </summary>
    [SuppressMonitor]
    [DisplayName("隔离部署状态")]
    [ApiDescriptionSettings(Name = "Status"), HttpGet]
    public UpdateStatusOutput GetStatus() => _deployment.GetStatus();

    /// <summary>
    /// 备份列表
    /// </summary>
    [SuppressMonitor]
    [DisplayName("备份列表")]
    [ApiDescriptionSettings(Name = "List"), HttpPost]
    public Task<List<BackupOutput>> List()
    {
        if (!_deployment.GetStatus().Enabled) return Task.FromResult(new List<BackupOutput>());
        var paths = CheckConfig();
        var backups = Directory.GetFiles(paths.Root, _cdConfigOptions.Repo + "*.zip", SearchOption.TopDirectoryOnly)
            .Where(path => UpdateDeploymentCoordinator.IsOwnedBackupName(Path.GetFileName(path), _cdConfigOptions.Repo) && (File.GetAttributes(path) & FileAttributes.ReparsePoint) == 0)
            .Select(path => new FileInfo(path))
            .Select(file => new BackupOutput { CreateTime = file.CreationTime, FilePath = file.FullName, FileName = file.Name })
            .OrderByDescending(file => file.CreateTime).ThenByDescending(file => file.FileName).ToList();
        return Task.FromResult(backups);
    }

    /// <summary>
    /// 还原已存在的备份
    /// </summary>
    [SuppressMonitor]
    [DisplayName("还原")]
    [ApiDescriptionSettings(Name = "Restore"), HttpPost]
    public async Task Restore(RestoreInput input)
    {
        var paths = CheckConfig();
        if (input == null || string.IsNullOrWhiteSpace(input.FileName) || input.FileName != Path.GetFileName(input.FileName) || input.FileName.Contains('/') || input.FileName.Contains('\\'))
            throw Oops.Oh("还原文件名无效");
        try
        {
            await _deployment.RunExclusiveAsync(async cancellationToken =>
            {
                var backup = (await List()).FirstOrDefault(file => file.FileName.Equals(input.FileName, StringComparison.OrdinalIgnoreCase));
                if (backup == null) throw new ArgumentException("备份文件不存在");
                var operation = _deployment.CreateOperationDirectory(paths);
                var replacementCompleted = false;
                try
                {
                    PrintfLog("正在还原选中的备份...");
                    var candidate = Path.Combine(operation, "candidate");
                    using (var stream = File.OpenRead(backup.FilePath)) UpdateDeploymentCoordinator.ExtractArchive(stream, candidate, allowEmpty: true);
                    cancellationToken.ThrowIfCancellationRequested();
                    PrintfLog("备份还原前的部署文件...");
                    _deployment.CreateBackup(paths);
                    cancellationToken.ThrowIfCancellationRequested();
                    UpdateDeploymentCoordinator.ReplaceDeployment(paths, candidate, operation);
                    replacementCompleted = true;
                    await CleanupBackupsAsync(paths);
                    PrintfLog("还原成功，重新启动目标部署后生效...");
                }
                finally { _deployment.DeleteOperationDirectory(paths, operation, replacementCompleted); }
            }, App.HttpContext.RequestAborted);
        }
        catch (OperationCanceledException)
        {
            PrintfLog("还原观察已中断，请重新查看部署结果...");
            throw;
        }
        catch (Exception ex)
        {
            PrintfLog("还原失败：" + ex.Message);
            throw Oops.Oh("还原失败，请查看更新日志");
        }
    }

    /// <summary>
    /// 从配置的仓库更新已授权部署
    /// </summary>
    [SuppressMonitor]
    [DisplayName("系统更新")]
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    public Task Update() => ExecuteUpdateAsync(false, App.HttpContext.RequestAborted);

    private async Task ExecuteUpdateAsync(bool skipInterval, CancellationToken cancellationToken)
    {
        var paths = CheckConfig();
        try
        {
            await _deployment.RunExclusiveAsync(async token =>
            {
                if (!skipInterval && _cdConfigOptions.UpdateInterval > 0)
                {
                    if (_sysCacheService.Get<bool>(CacheConst.KeySysUpdateInterval)) throw new ArgumentException("请勿频繁操作");
                    _sysCacheService.Set(CacheConst.KeySysUpdateInterval, true, TimeSpan.FromMinutes(_cdConfigOptions.UpdateInterval));
                }
                var operation = _deployment.CreateOperationDirectory(paths);
                var replacementCompleted = false;
                try
                {
                    PrintfLog("----------------------------隔离部署更新-开始----------------------------");
                    PrintfLog("下载仓库更新包...");
                    var source = Path.Combine(operation, "source");
                    using (var stream = await DownloadArchiveAsync(token)) UpdateDeploymentCoordinator.ExtractArchive(stream, source);
                    var backend = FindBackendDirectory(source);
                    var published = Path.Combine(operation, "published");
                    PrintfLog("编译发布项目...");
                    await _deployment.PublishAsync(backend, published, PrintfLog, token);
                    var wwwroot = Path.Combine(backend, "Admin.NET.Web.Entry", "wwwroot");
                    if (Directory.Exists(wwwroot)) FileHelper.CopyDirectory(wwwroot, Path.Combine(published, "wwwroot"), true);
                    foreach (var pattern in _cdConfigOptions.ExcludeFiles ?? [])
                        foreach (var excluded in Directory.GetFiles(published, pattern, SearchOption.TopDirectoryOnly)) File.Delete(excluded);
                    var candidate = Path.Combine(operation, "candidate");
                    UpdateDeploymentCoordinator.ValidateTree(paths.Live);
                    FileHelper.CopyDirectory(paths.Live, candidate, true);
                    FileHelper.CopyDirectory(published, candidate, true);
                    UpdateDeploymentCoordinator.ValidateTree(candidate, enforceSnapshotLimits: true);
                    token.ThrowIfCancellationRequested();
                    PrintfLog("备份原部署文件...");
                    _deployment.CreateBackup(paths);
                    token.ThrowIfCancellationRequested();
                    PrintfLog("替换部署文件...");
                    UpdateDeploymentCoordinator.ReplaceDeployment(paths, candidate, operation);
                    replacementCompleted = true;
                    await CleanupBackupsAsync(paths);
                    PrintfLog("更新成功，重新启动目标部署后生效...");
                }
                finally
                {
                    _deployment.DeleteOperationDirectory(paths, operation, replacementCompleted);
                    PrintfLog("----------------------------隔离部署更新-结束----------------------------");
                }
            }, cancellationToken);
        }
        catch (OperationCanceledException)
        {
            PrintfLog("更新观察已中断，请重新查看部署结果...");
            throw;
        }
        catch (Exception ex)
        {
            PrintfLog("更新失败：" + ex.Message);
            throw Oops.Oh("更新失败，请查看更新日志");
        }
    }

    private async Task CleanupBackupsAsync(UpdateDeploymentPaths paths)
    {
        if (_cdConfigOptions.BackupCount <= 0) return;
        foreach (var backup in (await List()).Skip(_cdConfigOptions.BackupCount))
        {
            if (!UpdateDeploymentCoordinator.IsChildOf(paths.Root, backup.FilePath) || !UpdateDeploymentCoordinator.IsOwnedBackupName(backup.FileName, _cdConfigOptions.Repo) || (File.GetAttributes(backup.FilePath) & FileAttributes.ReparsePoint) != 0)
                throw new ArgumentException("备份清理目录无效");
            File.Delete(backup.FilePath);
        }
    }

    private async Task<Stream> DownloadArchiveAsync(CancellationToken cancellationToken)
    {
        Stream source;
        HttpClient client = null;
        try
        {
            if (string.IsNullOrWhiteSpace(_cdConfigOptions.RepositoryArchiveUrl))
                source = await GiteeHelper.DownloadRepoZip(_cdConfigOptions.Owner, _cdConfigOptions.Repo, _cdConfigOptions.AccessToken, _cdConfigOptions.Branch);
            else
            {
                client = new HttpClient(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false, UseCookies = false })
                    { Timeout = TimeSpan.FromSeconds(60), MaxResponseContentBufferSize = 64L * 1024 * 1024 };
                var bytes = await client.GetByteArrayAsync(UpdateDeploymentCoordinator.ValidateArchiveUri(_cdConfigOptions.RepositoryArchiveUrl), cancellationToken);
                source = new MemoryStream(bytes, writable: false);
            }
            using (source)
            {
                var buffered = new MemoryStream();
                var buffer = new byte[81920];
                int read;
                while ((read = await source.ReadAsync(buffer, cancellationToken)) > 0)
                {
                    if (buffered.Length + read > 64L * 1024 * 1024)
                    {
                        buffered.Dispose();
                        throw new ArgumentException("仓库压缩包超出大小上限");
                    }
                    await buffered.WriteAsync(buffer.AsMemory(0, read), cancellationToken);
                }
                buffered.Position = 0;
                return buffered;
            }
        }
        finally { client?.Dispose(); }
    }

    private static string FindBackendDirectory(string source)
    {
        var candidates = Directory.EnumerateDirectories(source).Prepend(source)
            .Select(directory => Path.Combine(directory, "Admin.NET"))
            .Where(directory => Directory.Exists(Path.Combine(directory, "Admin.NET.Web.Entry"))).ToArray();
        if (candidates.Length != 1) throw new ArgumentException("更新包必须包含唯一的 Admin.NET 后端启动项目");
        return candidates[0];
    }

    /// <summary>
    /// 获取 WebHook 密钥，仅显式授权调用，响应不进入监控日志
    /// </summary>
    [SuppressMonitor]
    [DisplayName("获取WebHook接口密钥")]
    [ApiDescriptionSettings(Name = "WebHookKey"), HttpGet]
    public string GetWebHookKey()
    {
        CheckConfig();
        return GetWebHookKeyCore();
    }

    private string GetWebHookKeyCore()
    {
        if (string.IsNullOrWhiteSpace(_cdConfigOptions.AccessToken)) throw Oops.Oh("WebHook 密钥尚未配置");
        // 保留明确支持的 MD5/SM4 旧值；SM2 和未知模式安全派生，禁止随机密钥或明文 Token。
        return CryptogramUtil.CryptoType is "MD5" or "SM4"
            ? CryptogramUtil.Encrypt(_cdConfigOptions.AccessToken)
            : UpdateDeploymentCoordinator.DeriveStableWebHookKey(_cdConfigOptions.AccessToken);
    }

    /// <summary>
    /// 获取日志列表
    /// </summary>
    [SuppressMonitor]
    [DisplayName("获取日志列表")]
    [ApiDescriptionSettings(Name = "Logs"), HttpGet]
    public List<string> LogList()
    {
        lock (_deployment.LogSync)
            return (_sysCacheService.Get<List<string>>(CacheConst.KeySysUpdateLog) ?? []).Select(SanitizeLog).ToList();
    }

    /// <summary>
    /// 清空日志
    /// </summary>
    [SuppressMonitor]
    [DisplayName("清空日志")]
    [ApiDescriptionSettings(Name = "Clear"), HttpGet]
    public async Task ClearLog()
    {
        try
        {
            await _deployment.RunExclusiveAsync(_ =>
            {
                lock (_deployment.LogSync) _sysCacheService.Remove(CacheConst.KeySysUpdateLog);
                return Task.CompletedTask;
            }, App.HttpContext.RequestAborted);
        }
        catch (InvalidOperationException) { throw Oops.Oh("更新或还原执行期间不能清空日志"); }
    }

    private UpdateDeploymentPaths CheckConfig()
    {
        try { return _deployment.ValidateConfiguration(); }
        catch (ArgumentException ex) { throw Oops.Oh(ex.Message); }
        catch (IOException) { throw Oops.Oh("无法读取授权部署目标"); }
        catch (UnauthorizedAccessException) { throw Oops.Oh("授权部署目标不可访问"); }
    }

    private string SanitizeLog(string message)
    {
        var result = message ?? string.Empty;
        foreach (var sensitive in new[] { _cdConfigOptions.AccessToken, _cdConfigOptions.AllowedDeploymentRoot, _cdConfigOptions.BackendOutput, _cdConfigOptions.RepositoryArchiveUrl })
        {
            if (string.IsNullOrWhiteSpace(sensitive)) continue;
            result = result.Replace(sensitive, "[已脱敏]", StringComparison.OrdinalIgnoreCase)
                .Replace(sensitive.Replace('\\', '/'), "[已脱敏]", StringComparison.OrdinalIgnoreCase);
        }
        if (!string.IsNullOrWhiteSpace(_cdConfigOptions.AccessToken))
            result = result.Replace(GetWebHookKeyCore(), "[已脱敏]", StringComparison.Ordinal);
        result = UpdateDeploymentCoordinator.SanitizePaths(LogDataSanitizer.Sanitize(result));
        return result.Length <= 4096 ? result : result[..4096] + "…";
    }

    private void PrintfLog(string message)
    {
        lock (_deployment.LogSync)
        {
            var logs = (_sysCacheService.Get<List<string>>(CacheConst.KeySysUpdateLog) ?? []).TakeLast(1999).ToList();
            var content = $"【{DateTime.Now}】 {SanitizeLog(message)}";
            Console.WriteLine(content);
            logs.Add(content);
            _sysCacheService.Set(CacheConst.KeySysUpdateLog, logs);
        }
    }

    [AllowAnonymous]
    [SuppressMonitor]
    [DisplayName("仓库WebHook接口")]
    [ApiDescriptionSettings(Name = "WebHook"), HttpPost]
    public async Task WebHook(Dictionary<string, object> input)
    {
        CheckConfig();
        PrintfLog("----------------------------收到WebHook请求-开始----------------------------");

        try
        {
            // 获取请求头信息
            var even = App.HttpContext.Request.Headers.FirstOrDefault(u => u.Key == "X-Gitee-Event").Value
                .FirstOrDefault();
            var ua = App.HttpContext.Request.Headers.FirstOrDefault(u => u.Key == "User-Agent").Value.FirstOrDefault();

            var timestamp = input.GetValueOrDefault("timestamp")?.ToString();
            var token = input.GetValueOrDefault("sign")?.ToString();
            PrintfLog("User-Agent：" + ua);
            PrintfLog("Gitee-Event：" + even);

            PrintfLog("开始验签...");
            var secret = GetWebHookKeyCore();
            var stringToSign = $"{timestamp}\n{secret}";
            using var mac = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
            var signData = mac.ComputeHash(Encoding.UTF8.GetBytes(stringToSign));
            var encodedSignData = Convert.ToBase64String(signData);
            var calculatedSignature = WebUtility.UrlEncode(encodedSignData);

            if (string.IsNullOrEmpty(token) || !CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(calculatedSignature), Encoding.UTF8.GetBytes(token))) throw Oops.Oh("非法签名");
            try { _deployment.RegisterWebHook(timestamp, token); }
            catch (ArgumentException ex) { throw Oops.Oh(ex.Message); }
            PrintfLog("验签成功...");

            var hookName = input.GetValueOrDefault("hook_name") as string;
            PrintfLog("Hook-Name：" + hookName);

            switch (hookName)
            {
                // 提交修改
                case "push_hooks":
                    {
                        var commitList = input.GetValueOrDefault("commits")?.Adapt<List<Dictionary<string, object>>>() ?? new();
                        foreach (var commit in commitList)
                        {
                            var author = commit.GetValueOrDefault("author")?.Adapt<Dictionary<string, object>>();
                            PrintfLog("Commit-Message：" + commit.GetValueOrDefault("message"));
                            PrintfLog("Commit-Time：" + commit.GetValueOrDefault("timestamp"));
                            PrintfLog("Commit-Author：" + author?.GetValueOrDefault("username"));
                            PrintfLog("Modified-List：" + author?.GetValueOrDefault("modified")?.Adapt<List<string>>().Join());
                            PrintfLog("----------------------------------------------------------");
                        }

                        break;
                    }
                // 合并 Pull Request
                case "merge_request_hooks":
                    {
                        var pull = input.GetValueOrDefault("pull_request")?.Adapt<Dictionary<string, object>>();
                        var user = pull?.GetValueOrDefault("user")?.Adapt<Dictionary<string, object>>();
                        PrintfLog("Pull-Request-Title：" + pull?.GetValueOrDefault("message"));
                        PrintfLog("Pull-Request-Time：" + pull?.GetValueOrDefault("created_at"));
                        PrintfLog("Pull-Request-Author：" + user?.GetValueOrDefault("username"));
                        PrintfLog("Pull-Request-Body：" + pull?.GetValueOrDefault("body"));
                        break;
                    }
                // 新的issue
                case "issue_hooks":
                    {
                        var issue = input.GetValueOrDefault("issue")?.Adapt<Dictionary<string, object>>();
                        var user = issue?.GetValueOrDefault("user")?.Adapt<Dictionary<string, object>>();
                        var labelList = issue?.GetValueOrDefault("labels")?.Adapt<List<Dictionary<string, object>>>();
                        PrintfLog("Issue-UserName：" + user?.GetValueOrDefault("username"));
                        PrintfLog("Issue-Labels：" + labelList?.Select(u => u.GetValueOrDefault("name")).Join());
                        PrintfLog("Issue-Title：" + issue?.GetValueOrDefault("title"));
                        PrintfLog("Issue-Time：" + issue?.GetValueOrDefault("created_at"));
                        PrintfLog("Issue-Body：" + issue?.GetValueOrDefault("body"));
                        return;
                    }
                // 评论
                case "note_hooks":
                    {
                        var comment = input.GetValueOrDefault("comment")?.Adapt<Dictionary<string, object>>();
                        var user = input.GetValueOrDefault("user")?.Adapt<Dictionary<string, object>>();
                        PrintfLog("comment-UserName：" + user?.GetValueOrDefault("username"));
                        PrintfLog("comment-Time：" + comment?.GetValueOrDefault("created_at"));
                        PrintfLog("comment-Content：" + comment?.GetValueOrDefault("body"));
                        return;
                    }
                default:
                    return;
            }

            await ExecuteUpdateAsync(true, App.HttpContext.RequestAborted);
        }
        finally
        {
            PrintfLog("----------------------------收到WebHook请求-结束----------------------------");
        }
    }
}
