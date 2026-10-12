// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.IO.Compression;
using System.Security.Cryptography;

namespace Admin.NET.Core.Service;

/// <summary>代码生成的模板、目标路径和归档使用同一份清单。</summary>
public static class CodeGenArtifacts
{
    private static readonly HashSet<string> GenerateTypes = new(StringComparer.Ordinal) { "100", "111", "121", "200", "211", "221" };
    private static readonly UTF8Encoding FileEncoding = new(false);

    /// <summary>依据已保存配置确定模板和相对路径，禁止生成路径越界。</summary>
    public static IReadOnlyList<CodeGenArtifactPlan> CreatePlan(SysCodeGen config, string frontRootPath)
    {
        if (config == null || config.Id <= 0) throw Oops.Oh("代码生成配置标识无效");
        if (!GenerateTypes.Contains(config.GenerateType ?? "")) throw Oops.Oh("代码生成方式无效，请重新保存配置");
        ValidateIdentifier(config.TableName, "实体名称");
        if (string.IsNullOrWhiteSpace(config.NameSpace)) throw Oops.Oh("生成命名空间不能为空");
        foreach (var segment in config.NameSpace.Split('.')) ValidateIdentifier(segment, "生成命名空间");
        var pagePath = NormalizeRelativePath(config.PagePath, "页面目录");
        var frontRoot = NormalizeRelativePath(frontRootPath, "前端根目录");
        if (!frontRoot.EndsWith("apps/web-antdv-next", StringComparison.OrdinalIgnoreCase)) frontRoot += "/apps/web-antdv-next";
        var entityName = config.TableName!;
        var lowerName = char.ToLowerInvariant(entityName[0]) + entityName[1..];
        var backendPath = $"{config.NameSpace}/Service/{entityName}";
        var frontendPath = $"{frontRoot}/src/views/{pagePath}/{lowerName}";
        var plans = new List<CodeGenArtifactPlan>();
        if (config.GenerateType![1] != '1')
        {
            plans.Add(new("Service.cs", $"{backendPath}/{entityName}Service.cs"));
            plans.Add(new("Input.cs", $"{backendPath}/Dto/{entityName}Input.cs"));
            plans.Add(new("Output.cs", $"{backendPath}/Dto/{entityName}Output.cs"));
            plans.Add(new("Dto.cs", $"{backendPath}/Dto/{entityName}Dto.cs"));
        }
        if (config.GenerateType[1] != '2')
        {
            plans.Add(new("index.vue", $"{frontendPath}/index.vue"));
            plans.Add(new("editDialog.vue", $"{frontendPath}/component/editDialog.vue"));
            plans.Add(new("api.ts", $"{frontRoot}/src/api/{pagePath}/{lowerName}.ts"));
        }
        foreach (var plan in plans) NormalizeRelativePath(plan.RelativePath, "生成文件路径");
        return plans;
    }

    /// <summary>完整写入后计算文件清单；校验先于任何文件写入。</summary>
    public static async Task<IReadOnlyList<CodeGenArtifactManifest>> WriteFilesAsync(string rootPath, IReadOnlyList<CodeGenArtifactPlan> plans,
        IReadOnlyDictionary<string, string> rendered, bool overwrite = false, CancellationToken cancellationToken = default)
    {
        ValidateRendered(plans, rendered);
        var targets = plans.Select(plan => (Plan: plan, Path: ResolveUnderRoot(rootPath, plan.RelativePath))).ToArray();
        if (targets.Select(target => target.Path).Distinct(StringComparer.OrdinalIgnoreCase).Count() != targets.Length)
            throw Oops.Oh("生成文件路径重复");
        var manifests = new List<CodeGenArtifactManifest>();
        foreach (var target in targets)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Directory.CreateDirectory(Path.GetDirectoryName(target.Path)!);
            await using (var stream = new FileStream(target.Path, overwrite ? FileMode.Create : FileMode.CreateNew, FileAccess.Write, FileShare.None, 81920, true))
            {
                var bytes = FileEncoding.GetBytes(rendered[target.Plan.Template]);
                await stream.WriteAsync(bytes, cancellationToken);
                await stream.FlushAsync(cancellationToken);
                manifests.Add(new(target.Plan.Template, target.Plan.RelativePath, bytes.LongLength, Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant()));
            }
        }
        return manifests;
    }

    /// <summary>每次生成独立归档；完成写入、压缩和业务动作后才发布下载文件。</summary>
    public static async Task<CodeGenArchive> CreateArchiveAsync(string webRootPath, string entityName, IReadOnlyList<CodeGenArtifactPlan> plans,
        IReadOnlyDictionary<string, string> rendered, Func<Task> beforePublish = null, CancellationToken cancellationToken = default)
    {
        ValidateIdentifier(entityName, "实体名称");
        ValidateRendered(plans, rendered);
        var operationId = Guid.NewGuid().ToString("N");
        var stagingPath = Path.Combine(Path.GetTempPath(), "adminnet-codegen", operationId);
        var downloadDirectory = Path.Combine(Path.GetFullPath(webRootPath), "CodeGen");
        var pendingPath = Path.Combine(downloadDirectory, $".{operationId}.tmp");
        var fileName = $"{entityName}-{operationId}.zip";
        var publishedPath = Path.Combine(downloadDirectory, fileName);
        var published = false;
        try
        {
            var manifest = await WriteFilesAsync(stagingPath, plans, rendered, cancellationToken: cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            Directory.CreateDirectory(downloadDirectory);
            ZipFile.CreateFromDirectory(stagingPath, pendingPath, CompressionLevel.Optimal, false, FileEncoding);
            string hash;
            await using (var stream = File.OpenRead(pendingPath))
                hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, cancellationToken)).ToLowerInvariant();
            // 暂存清理也属于发布前步骤；清理失败不能返回已发布的下载文件。
            Directory.Delete(stagingPath, true);
            if (beforePublish != null) await beforePublish();
            cancellationToken.ThrowIfCancellationRequested();
            File.Move(pendingPath, publishedPath, false);
            published = true;
            return new(fileName, hash, manifest);
        }
        finally
        {
            try
            {
                if (Directory.Exists(stagingPath)) Directory.Delete(stagingPath, true);
            }
            finally
            {
                if (!published && File.Exists(pendingPath)) File.Delete(pendingPath);
            }
        }
    }

    /// <summary>按路径边界检查目标，而非使用字符串公共前缀。</summary>
    public static string ResolveUnderRoot(string rootPath, string relativePath)
    {
        var normalized = NormalizeRelativePath(relativePath, "生成文件路径");
        var root = Path.GetFullPath(rootPath);
        var resolved = Path.GetFullPath(Path.Combine(root, normalized.Replace('/', Path.DirectorySeparatorChar)));
        var comparison = OperatingSystem.IsWindows() ? StringComparison.OrdinalIgnoreCase : StringComparison.Ordinal;
        if (!resolved.StartsWith(Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar, comparison))
            throw Oops.Oh("生成文件路径不能超出指定目录");
        return resolved;
    }

    private static void ValidateRendered(IReadOnlyList<CodeGenArtifactPlan> plans, IReadOnlyDictionary<string, string> rendered)
    {
        if (plans == null || plans.Count == 0 || rendered == null || plans.Count != rendered.Count ||
            plans.Select(plan => plan.Template).Distinct(StringComparer.Ordinal).Count() != plans.Count ||
            plans.Any(plan => !rendered.TryGetValue(plan.Template, out var content) || string.IsNullOrWhiteSpace(content)))
            throw Oops.Oh("生成模板结果不完整，请检查模板后重试");
    }

    private static string NormalizeRelativePath(string path, string label)
    {
        if (string.IsNullOrWhiteSpace(path) || Path.IsPathRooted(path)) throw Oops.Oh($"{label}必须是安全的相对路径");
        var normalized = path.Replace('\\', '/');
        var segments = normalized.Split('/');
        if (segments.Any(segment => segment.Length == 0 || segment is "." or ".." || segment.EndsWith('.') || segment.EndsWith(' ') ||
            segment.Any(character => character < 32 || ":*?\"<>|".Contains(character)) ||
            Regex.IsMatch(segment, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", RegexOptions.IgnoreCase)))
            throw Oops.Oh($"{label}包含无效路径片段");
        return normalized;
    }

    private static void ValidateIdentifier(string value, string label)
    {
        if (string.IsNullOrWhiteSpace(value) || !Microsoft.CodeAnalysis.CSharp.SyntaxFacts.IsValidIdentifier(value))
            throw Oops.Oh($"{label}无效");
    }
}

/// <summary>一个模板对应一个明确的输出文件。</summary>
public sealed record CodeGenArtifactPlan(string Template, string RelativePath);

/// <summary>生成文件的实际 UTF-8 字节数与摘要。</summary>
public sealed record CodeGenArtifactManifest(string Template, string Path, long Size, string Sha256);

/// <summary>已完整发布的归档，路径只包含相对文件名。</summary>
public sealed record CodeGenArchive(string FileName, string Sha256, IReadOnlyList<CodeGenArtifactManifest> Manifest);