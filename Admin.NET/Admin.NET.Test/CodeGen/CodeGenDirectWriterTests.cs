// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public sealed class CodeGenDirectWriterTests
{
    [Theory]
    [InlineData("200", 7)]
    [InlineData("211", 3)]
    [InlineData("221", 4)]
    public async Task Write_AuthorizedPlan_MatchesPreviewAndPreservesUnrelatedFiles(string type, int count)
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root, type);
            var sentinel = Path.Combine(root, "keep.txt");
            await File.WriteAllTextAsync(sentinel, "untouched");
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            var businessCompleted = false;
            var result = await CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, false, () =>
            {
                Assert.All(snapshot.Files, file => Assert.Equal(content[file.Template], File.ReadAllText(file.Path)));
                businessCompleted = true;
                return Task.CompletedTask;
            });
            Assert.True(businessCompleted);
            Assert.Equal(count, result.Files.Count);
            Assert.All(result.Files.Where(file => !file.Template.EndsWith(".cs")), file => Assert.Contains("apps" + Path.DirectorySeparatorChar + "web-antdv-next", file.Path));
            Assert.Equal("untouched", await File.ReadAllTextAsync(sentinel));
            Assert.Empty(Directory.EnumerateDirectories(root, ".adminnet-codegen-*", SearchOption.AllDirectories));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_ExistingFileWithoutOverwrite_RejectsBeforePublishing()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var first = CodeGenDirectWriter.Inspect(backend, root, plans, content).Files[0].Path;
            Directory.CreateDirectory(Path.GetDirectoryName(first)!);
            await File.WriteAllTextAsync(first, "manual content");
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            await Assert.ThrowsAnyAsync<Exception>(() => CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, false, null));
            Assert.Equal("manual content", await File.ReadAllTextAsync(first));
            Assert.All(snapshot.Files.Skip(1), file => Assert.False(File.Exists(file.Path)));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_ChangedTargetAfterReview_RejectsStaleApproval()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            var target = snapshot.Files[0].Path;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllTextAsync(target, "new manual work");
            await Assert.ThrowsAnyAsync<Exception>(() => CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, true, null));
            Assert.Equal("new manual work", await File.ReadAllTextAsync(target));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_ChangedTemplateAfterReview_RejectsStaleApproval()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            content[plans[0].Template] = "changed template";
            await Assert.ThrowsAnyAsync<Exception>(() => CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, false, null));
            Assert.All(snapshot.Files, file => Assert.False(File.Exists(file.Path)));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_BusinessFailure_RestoresExactBytesAndNewDirectories()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var initial = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            var target = initial.Files[0].Path;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            var original = new byte[] { 0xef, 0xbb, 0xbf, 65, 13, 10, 0, 99 };
            await File.WriteAllBytesAsync(target, original);
            var directories = Directory.EnumerateDirectories(root, "*", SearchOption.AllDirectories).OrderBy(path => path).ToArray();
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            await Assert.ThrowsAsync<InvalidOperationException>(() => CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, true,
                () => throw new InvalidOperationException("menu transaction failed")));
            Assert.Equal(original, await File.ReadAllBytesAsync(target));
            Assert.All(snapshot.Files.Skip(1), file => Assert.False(File.Exists(file.Path)));
            Assert.Equal(directories, Directory.EnumerateDirectories(root, "*", SearchOption.AllDirectories).OrderBy(path => path).ToArray());
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_ReviewedOverwrite_OnlyReplacesManifestFiles()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var target = CodeGenDirectWriter.Inspect(backend, root, plans, content).Files[0].Path;
            Directory.CreateDirectory(Path.GetDirectoryName(target)!);
            await File.WriteAllTextAsync(target, "old");
            var sibling = Path.Combine(Path.GetDirectoryName(target)!, "Manual.cs");
            await File.WriteAllTextAsync(sibling, "manual");
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            await CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, true, null);
            Assert.Equal(content[plans[0].Template], await File.ReadAllTextAsync(target));
            Assert.Equal("manual", await File.ReadAllTextAsync(sibling));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public void Inspect_TraversalTarget_RejectsBeforeWriting()
    {
        var root = Root();
        try
        {
            Assert.ThrowsAny<Exception>(() => CodeGenDirectWriter.Inspect(root, root, new[] { new CodeGenArtifactPlan("index.vue", "../escape.vue") },
                new Dictionary<string, string> { ["index.vue"] = "source" }));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_CancelledBeforePublish_DoesNotCallBusinessAction()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content);
            using var cancellation = new CancellationTokenSource();
            cancellation.Cancel();
            await Assert.ThrowsAnyAsync<OperationCanceledException>(() => CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, false,
                () => throw new InvalidOperationException("must not execute"), cancellation.Token));
            Assert.All(snapshot.Files, file => Assert.False(File.Exists(file.Path)));
        }
        finally { Directory.Delete(root, true); }
    }

    [Fact]
    public async Task Write_MenuConfigurationChanged_RejectsReviewedPlanBeforeWriting()
    {
        var root = Root();
        try
        {
            var (backend, plans, content) = Fixture(root);
            var snapshot = CodeGenDirectWriter.Inspect(backend, root, plans, content, "menu:42");
            var called = false;
            await Assert.ThrowsAnyAsync<Exception>(() => CodeGenDirectWriter.WriteAsync(backend, root, plans, content, snapshot.Fingerprint, false,
                () => { called = true; return Task.CompletedTask; }, configuration: "menu:43"));
            Assert.False(called);
            Assert.All(snapshot.Files, file => Assert.False(File.Exists(file.Path)));
            Assert.Empty(Directory.GetDirectories(root, ".adminnet-codegen-*", SearchOption.AllDirectories));
        }
        finally { Directory.Delete(root, true); }
    }
    private static string Root()
    {
        var root = Path.Combine(Path.GetTempPath(), "adminnet-codegen44-unit-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(root);
        return root;
    }

    private static (string Backend, IReadOnlyList<CodeGenArtifactPlan> Plans, Dictionary<string, string> Content) Fixture(string root, string type = "200")
    {
        var backend = Path.Combine(root, "Admin.NET");
        Directory.CreateDirectory(backend);
        var plans = CodeGenArtifacts.CreatePlan(new SysCodeGen { Id = 42, TableName = "DirectProbe", NameSpace = "Admin.NET.Application", PagePath = "main", GenerateType = type }, "Web");
        return (backend, plans, plans.ToDictionary(plan => plan.Template, plan => "真实生成：" + plan.Template));
    }
}
