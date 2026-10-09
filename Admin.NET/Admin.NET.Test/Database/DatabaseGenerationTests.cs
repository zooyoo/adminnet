// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.Extensions.Options;
using System.Globalization;
using System.Reflection;
using Xunit;

namespace Admin.NET.Test.Database;

public class DatabaseGenerationTests
{
    [Fact]
    public void CSharpLiteral_SpecialValues_CompilesAndRoundTrips()
    {
        // 准备：使用逗号小数文化，验证输出独立于服务器区域设置。
        CultureInfo previous = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = CultureInfo.GetCultureInfo("fr-FR");
            object[] values = ["中文\"\\\r\n\t\0\u2028", '\'', 12.345m, 1.25f, double.NaN, long.MinValue, ulong.MaxValue,
                new DateTime(2026, 10, 10, 1, 2, 3, DateTimeKind.Utc).AddTicks(1234),
                new DateTimeOffset(2026, 10, 10, 1, 2, 3, TimeSpan.FromHours(8)), Guid.NewGuid(), new byte[] { 0, 128, 255 },
                TimeSpan.FromTicks(-12345), new DateOnly(2026, 10, 10), new TimeOnly(123456789), DayOfWeek.Friday];
            MethodInfo literal = typeof(SysDatabaseService).GetMethod("CSharpLiteral", BindingFlags.NonPublic | BindingFlags.Static)!;
            string expressions = string.Join(",", values.Select(value => literal.Invoke(null, [value, value.GetType()])));
            string source = "using System; using System.Globalization; public static class Probe { public static object[] Values() => new object[]{" + expressions + "}; }";

            // 执行：真实编译表达式并执行，避免只比较生成文本。
            IEnumerable<MetadataReference> references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator).Select(path => MetadataReference.CreateFromFile(path));
            CSharpCompilation compilation = CSharpCompilation.Create("LiteralProbe" + Guid.NewGuid().ToString("N"), [CSharpSyntaxTree.ParseText(source)], references, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
            using MemoryStream stream = new();
            var result = compilation.Emit(stream);
            Assert.True(result.Success, string.Join("\n", result.Diagnostics));
            object[] actual = (object[])Assembly.Load(stream.ToArray()).GetType("Probe")!.GetMethod("Values")!.Invoke(null, null)!;

            // 断言：值、日期精度和二进制保持一致。
            Assert.Equal(values.Length, actual.Length);
            for (int i = 0; i < values.Length; i++) Assert.Equal(values[i], actual[i]);
            Assert.Equal(DateTimeKind.Utc, ((DateTime)actual[7]).Kind);
        }
        finally { CultureInfo.CurrentCulture = previous; }
    }

    [Fact]
    public void WriteGeneratedFile_ChangedTarget_RejectsAndPreservesFile()
    {
        // 准备：所有文件位于本测试自己的临时目录。
        string root = Path.Combine(Path.GetTempPath(), "adminnet-generation-test-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(Path.Combine(root, "Admin.NET.Application", "Entity"));
        string target = Path.Combine(root, "Admin.NET.Application", "Entity", "Sample.cs");
        try
        {
            File.WriteAllText(target, "original", System.Text.Encoding.UTF8);
            SysDatabaseService service = new(null, null, Options.Create(new CodeGenOptions { BackendRootPath = root }));
            MethodInfo build = typeof(SysDatabaseService).GetMethod("CreatePreview", BindingFlags.NonPublic | BindingFlags.Instance)!;
            MethodInfo write = typeof(SysDatabaseService).GetMethod("WriteGeneratedFile", BindingFlags.NonPublic | BindingFlags.Instance)!;
            DatabaseCodePreview preview = (DatabaseCodePreview)build.Invoke(service, [target, "replacement"])!;
            File.WriteAllText(target, "external edit", System.Text.Encoding.UTF8);

            // 执行与断言：旧预览和未明确覆盖均不写入。
            Assert.Throws<TargetInvocationException>(() => write.Invoke(service, [preview, preview.Hash, true, preview.TargetHash]));
            Assert.Throws<TargetInvocationException>(() => write.Invoke(service, [preview, preview.Hash, false, preview.TargetHash]));
            Assert.Equal("external edit", File.ReadAllText(target));
            DatabaseCodePreview fresh = (DatabaseCodePreview)build.Invoke(service, [target, "replacement"])!;
            write.Invoke(service, [fresh, fresh.Hash, true, fresh.TargetHash]);
            Assert.Equal("replacement", File.ReadAllText(target));
            Assert.Empty(Directory.GetFiles(Path.GetDirectoryName(target)!, "*.tmp"));
        }
        finally { Directory.Delete(root, true); }
    }
}
