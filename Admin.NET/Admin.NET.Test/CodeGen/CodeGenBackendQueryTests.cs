// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using System.Reflection;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public class CodeGenBackendQueryTests
{
    [Theory]
    [InlineData("string", "==", true)]
    [InlineData("string", "!=", true)]
    [InlineData("string", ">", true)]
    [InlineData("string", ">=", true)]
    [InlineData("string", "<", true)]
    [InlineData("string", "<=", true)]
    [InlineData("string", "like", true)]
    [InlineData("string", "isNotNull", true)]
    [InlineData("string", "isNotNull", false)]
    [InlineData("int?", ">", true)]
    [InlineData("decimal?", "<=", true)]
    [InlineData("DateTime?", "~", true)]
    [InlineData("bool?", "!=", true)]
    [InlineData("bool?", ">", true)]
    [InlineData("Guid?", ">=", true)]
    [InlineData("StatusEnum?", ">=", true)]
    [InlineData("string", "~", true)]
    [InlineData("int?", "~", true)]
    public void Query_SavedOption_CompilesAndTranslatesForPostgreSql(string type, string query, bool nonEmpty)
    {
        // Arrange：真实模板共用规则生成谓词，PostgreSQL provider 只做表达式翻译，不访问数据库。
        var field = new CodeGenConfig { PropertyName = "Value", NetType = type, QueryType = query };
        var predicate = CodeGenTemplateSupport.Query(field);
        var inputType = query == "isNotNull" ? "bool?" : CodeGenTemplateSupport.NullableType(type);
        var value = inputType.TrimEnd('?') switch { "string" => "\"probe\"", "DateTime" => "new DateTime(2026, 1, 1)", "bool" => nonEmpty ? "true" : "false", "decimal" => "2m", "Guid" => "new Guid(\"00000000-0000-0000-0000-000000000001\")", "StatusEnum" => "(StatusEnum)1", _ => "2" };
        var initializer = "Value = " + value + ", ValueRange = new " + inputType + "[] { " + value + ", " + value + " }";
        var source = "using System; using SqlSugar; using Admin.NET.Core; public class SqlProbe { [SugarColumn(IsPrimaryKey=true)] public long Id {get;set;} public " + type + " Value {get;set;} } " +
            "public class ProbeInput { public " + inputType + " Value {get;set;} public " + inputType + "[] ValueRange {get;set;} } " +
            "public static class QueryProbe { public static string Run() { var input = new ProbeInput { " + initializer + " }; using var db = new SqlSugarClient(new ConnectionConfig { DbType = DbType.PostgreSQL, ConnectionString = \"Host=localhost;Database=codegen_query_translation;Username=translation\", IsAutoCloseConnection=true }); return db.Queryable<SqlProbe>()" + predicate + ".ToSql().Key; } }";
        var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator).Select(path => MetadataReference.CreateFromFile(path));
        var compilation = CSharpCompilation.Create("CodeGenQuery" + Guid.NewGuid().ToString("N"), new[] { CSharpSyntaxTree.ParseText(source) }, references, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        using var output = new MemoryStream();

        // Act / Assert：先要求生成谓词可编译，再执行真实 provider 的 SQL 翻译。
        var emit = compilation.Emit(output);
        Assert.True(emit.Success, string.Join("\n", emit.Diagnostics.Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)));
        var assembly = Assembly.Load(output.ToArray());
        var method = assembly.GetType("QueryProbe")!.GetMethod("Run")!;
        var sql = (string)method.Invoke(null, null)!;
        Assert.Contains("SELECT", sql, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("WHERE", sql, StringComparison.OrdinalIgnoreCase);
        if (query == "isNotNull") Assert.Contains(nonEmpty ? "IS NOT NULL" : "IS NULL", sql, StringComparison.OrdinalIgnoreCase);
    }
}
