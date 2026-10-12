// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Security.Cryptography;

namespace Admin.NET.Core.Service;

/// <summary>直接生成使用经核对的清单，发布失败时恢复已有文件与目录。</summary>
public static class CodeGenDirectWriter
{
    private static readonly SemaphoreSlim Gate = new(1, 1);
    private static readonly UTF8Encoding FileEncoding = new(false);

    public static CodeGenDirectPlan Inspect(string backendRoot, string frontendRoot, IReadOnlyList<CodeGenArtifactPlan> plans,
        IReadOnlyDictionary<string, string> rendered, string configuration = null)
    {
        if (plans == null || plans.Count == 0 || rendered == null || plans.Count != rendered.Count ||
            plans.Select(plan => plan.Template).Distinct().Count() != plans.Count ||
            plans.Any(plan => !rendered.TryGetValue(plan.Template, out var value) || string.IsNullOrWhiteSpace(value)))
            throw Oops.Oh("生成模板结果不完整，请重新预览");
        var files = plans.Select(plan =>
        {
            var root = plan.Template.EndsWith(".cs", StringComparison.Ordinal) ? backendRoot : frontendRoot;
            var target = CodeGenArtifacts.ResolveUnderRoot(root, plan.RelativePath);
            CheckPath(root, target);
            return new CodeGenDirectFile(plan.Template, target, Hash(FileEncoding.GetBytes(rendered[plan.Template])), CurrentHash(target));
        }).ToArray();
        if (files.Select(file => file.Path).Distinct(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal).Count() != files.Length)
            throw Oops.Oh("生成文件路径重复");
        var fingerprint = Hash(FileEncoding.GetBytes(System.Text.Json.JsonSerializer.Serialize(new { files, configuration })));
        return new(fingerprint, files);
    }

    /// <summary>暂存所有内容和原始字节后，核对每个文件摘要并整批替换；业务事务失败也恢复文件。</summary>
    public static async Task<CodeGenDirectPlan> WriteAsync(string backendRoot, string frontendRoot, IReadOnlyList<CodeGenArtifactPlan> plans,
        IReadOnlyDictionary<string, string> rendered, string fingerprint, bool overwrite, Func<Task> complete,
        CancellationToken cancellationToken = default, string configuration = null)
    {
        await Gate.WaitAsync(cancellationToken);
        var stages = new Dictionary<string, string>(OperatingSystem.IsWindows() ? StringComparer.OrdinalIgnoreCase : StringComparer.Ordinal);
        var entries = new List<DirectEntry>();
        var directories = new List<string>();
        var committed = false;
        var restored = true;
        try
        {
            var snapshot = Inspect(backendRoot, frontendRoot, plans, rendered, configuration);
            if (string.IsNullOrEmpty(fingerprint) || snapshot.Fingerprint != fingerprint)
                throw Oops.Oh("生成配置或目标文件已变化，请重新核对生成清单");
            if (!overwrite && snapshot.Files.Any(file => file.ExistingSha256 != null))
                throw Oops.Oh("目标文件已存在，请核对清单并明确允许覆盖");
            var operationId = Guid.NewGuid().ToString("N");
            for (var index = 0; index < plans.Count; index++)
            {
                cancellationToken.ThrowIfCancellationRequested();
                var plan = plans[index];
                var file = snapshot.Files[index];
                var root = Path.GetFullPath(plan.Template.EndsWith(".cs", StringComparison.Ordinal) ? backendRoot : frontendRoot);
                if (!stages.TryGetValue(root, out var stage))
                {
                    stage = Path.Combine(root, ".adminnet-codegen-" + operationId);
                    Directory.CreateDirectory(stage);
                    stages.Add(root, stage);
                }
                var pending = Path.Combine(stage, index + ".pending");
                var backup = file.ExistingSha256 == null ? null : Path.Combine(stage, index + ".backup");
                await File.WriteAllTextAsync(pending, rendered[plan.Template], FileEncoding, cancellationToken);
                if (backup != null)
                {
                    File.Copy(file.Path, backup, false);
                    if (CurrentHash(backup) != file.ExistingSha256) throw Oops.Oh("目标文件已变化，请重新核对生成清单");
                }
                entries.Add(new(file, root, pending, backup));
            }
            // 保留恢复记录；发布或回滚未完成时不能删除唯一备份。
            foreach (var stage in stages.Values)
                await File.WriteAllTextAsync(Path.Combine(stage, "recovery.json"), System.Text.Json.JsonSerializer.Serialize(entries.Select(entry => new
                { target = entry.File.Path, backup = entry.Backup, originalSha256 = entry.File.ExistingSha256 })), FileEncoding, cancellationToken);
            foreach (var entry in entries)
            {
                cancellationToken.ThrowIfCancellationRequested();
                CheckPath(entry.Root, entry.File.Path);
                if (CurrentHash(entry.File.Path) != entry.File.ExistingSha256) throw Oops.Oh("目标文件已变化，请重新核对生成清单");
                CreateDirectories(Path.GetDirectoryName(entry.File.Path)!, directories);
                File.Move(entry.Pending, entry.File.Path, overwrite);
                entry.Published = true;
            }
            cancellationToken.ThrowIfCancellationRequested();
            if (complete != null) await complete();
            // 业务事务已经提交；此后取消请求不应再撤销文件。
            committed = true;
            return snapshot;
        }
        catch (Exception original)
        {
            if (!committed)
            {
                var failures = new List<Exception>();
                foreach (var entry in entries.Where(entry => entry.Published).Reverse())
                {
                    try
                    {
                        CheckPath(entry.Root, entry.File.Path);
                        if (CurrentHash(entry.File.Path) != entry.File.Sha256) throw new IOException("生成目标在回滚前被修改，保留备份供恢复");
                        if (entry.Backup == null) File.Delete(entry.File.Path);
                        else File.Move(entry.Backup, entry.File.Path, true);
                    }
                    catch (Exception failure) { failures.Add(failure); }
                }
                foreach (var directory in directories.AsEnumerable().Reverse())
                {
                    try { if (Directory.Exists(directory) && !Directory.EnumerateFileSystemEntries(directory).Any()) Directory.Delete(directory); }
                    catch (Exception failure) { failures.Add(failure); }
                }
                if (failures.Count > 0)
                {
                    restored = false;
                    throw new AggregateException("直接生成未能全部恢复，目标根目录的 .adminnet-codegen-* 保留了原文件和 recovery.json，请先恢复后重试", new[] { original }.Concat(failures));
                }
            }
            throw;
        }
        finally
        {
            // 成功后或完整回滚后才清理暂存；清理异常不会逆转已提交的文件和菜单。
            try
            {
                if (restored)
                    foreach (var stage in stages.Values)
                        try { if (Directory.Exists(stage)) Directory.Delete(stage, true); } catch (IOException) { } catch (UnauthorizedAccessException) { }
            }
            finally { Gate.Release(); }
        }
    }

    private static void CheckPath(string root, string target)
    {
        if (!Directory.Exists(root)) throw Oops.Oh("授权的生成根目录不存在，请检查项目位置配置");
        for (var path = Path.GetFullPath(target); path != null; path = Path.GetDirectoryName(path))
        {
            if (!File.Exists(path) && !Directory.Exists(path)) continue;
            if ((File.GetAttributes(path) & FileAttributes.ReparsePoint) != 0)
                throw Oops.Oh("生成路径不能包含符号链接或目录联接");
            if (path == target && Directory.Exists(path)) throw Oops.Oh("生成文件位置已被目录占用");
            if (path != target && File.Exists(path)) throw Oops.Oh("生成目录位置已被文件占用");
        }
    }

    private static void CreateDirectories(string directory, List<string> created)
    {
        if (Directory.Exists(directory)) return;
        CreateDirectories(Path.GetDirectoryName(directory)!, created);
        Directory.CreateDirectory(directory);
        created.Add(directory);
    }

    private static string CurrentHash(string path) => File.Exists(path) ? Hash(File.ReadAllBytes(path)) : null;
    private static string Hash(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private sealed record DirectEntry(CodeGenDirectFile File, string Root, string Pending, string Backup)
    {
        public bool Published { get; set; }
    }
}

public sealed record CodeGenDirectFile(string Template, string Path, string Sha256, string ExistingSha256);
public sealed record CodeGenDirectPlan(string Fingerprint, IReadOnlyList<CodeGenDirectFile> Files);

/// <summary>仅按服务端已保存的配置及已核对清单直接生成。</summary>
public sealed class CodeGenDirectInput : BaseIdInput
{
    [Required]
    public string Fingerprint { get; set; }
    public bool Overwrite { get; set; }
}
