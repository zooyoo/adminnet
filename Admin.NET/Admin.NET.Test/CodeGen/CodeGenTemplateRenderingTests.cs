// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Furion.ViewEngine;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Microsoft.Extensions.DependencyInjection;
using System.Runtime.CompilerServices;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public class CodeGenTemplateRenderingTests
{
    [Theory]
    [InlineData("Service.cs.vm")]
    [InlineData("Input.cs.vm")]
    [InlineData("Output.cs.vm")]
    [InlineData("Dto.cs.vm")]
    public async Task Render_RealBackendTemplate_CompilesRazor(string file)
    {
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var engine = provider.GetRequiredService<IViewEngine>();
        var source = File.ReadAllText(Path.Combine(RepositoryRoot(), "Admin.NET/Admin.NET.Web.Entry/wwwroot/template", file));
        var output = await engine.RunCompileFromCachedAsync(source, Model(), builderAction: builder =>
        {
            builder.AddAssemblyReferenceByName("System.Text.RegularExpressions");
            builder.AddAssemblyReferenceByName("System.Collections");
            builder.AddAssemblyReferenceByName("System.Linq");
            builder.AddAssemblyReferenceByName(typeof(CustomViewEngine).Assembly.GetName().Name);
            builder.AddUsing("System.Text.RegularExpressions");
            builder.AddUsing("System.Collections.Generic");
            builder.AddUsing("System.Linq");
        });
        Assert.Contains("CgProbe", output);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task Generate_BackendFiles_CompileAsOneAssembly(bool advanced)
    {
        // Arrange：使用真实后端模板，并覆盖组合主键、联表、树、导入导出和查询分支。
        var model = Model();
        if (advanced)
        {
            model.TableField[1].WhetherImport = "Y";
            model.TableField.AddRange(new[]
            {
                Field("RegionKey", "string", key: true), Field("Count", "int?", query: ">"),
                Field("Amount", "decimal?", query: "<="), Field("CreatedAt", "DateTime?", query: "~"),
                Field("Active", "bool?", query: "!="), Field("Optional", "string", query: "isNotNull"),
                Field("OrgId", "long?", effect: "ForeignKey", import: true), Field("ParentId", "long?", effect: "ApiTreeSelector", import: true),
                Field("AttachmentId", "long?", effect: "Upload_SingleFile"), Field("DictCode", "string", effect: "DictSelector", import: true)
            });
            foreach (var field in model.TableField.Where(field => field.EffectType is "ForeignKey" or "ApiTreeSelector"))
            {
                field.FkEntityName = "global::Example.Codegen.Entity.CgOrg"; field.FkLinkColumnName = "Id"; field.FkDisplayColumnList = new() { "Name" }; field.FkColumnNetType = "long"; field.PidColumn = "Pid";
            }
            model = RefreshFields(model);
            model.TableUniqueConfigList = new() { new() { Columns = new() { "Name" }, Message = "名称\"重复" } };
        }
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var engine = provider.GetRequiredService<IViewEngine>();
        var sources = new List<SyntaxTree>();
        foreach (var template in new[] { "Service.cs.vm", "Input.cs.vm", "Output.cs.vm", "Dto.cs.vm" })
        {
            var content = File.ReadAllText(Path.Combine(RepositoryRoot(), "Admin.NET/Admin.NET.Web.Entry/wwwroot/template", template));
            var rendered = await engine.RunCompileFromCachedAsync(content, model, builderAction: builder =>
            {
                builder.AddAssemblyReferenceByName("System.Text.RegularExpressions");
                builder.AddAssemblyReferenceByName("System.Collections");
                builder.AddAssemblyReferenceByName("System.Linq");
                builder.AddAssemblyReferenceByName(typeof(CustomViewEngine).Assembly.GetName().Name);
                builder.AddUsing("System.Text.RegularExpressions");
                builder.AddUsing("System.Collections.Generic");
                builder.AddUsing("System.Linq");
            });
            sources.Add(CSharpSyntaxTree.ParseText(rendered, path: template[..^3]));
        }
        var entity = "namespace Example.Codegen.Entity { [SqlSugar.SugarTable(\"cg_probe\")] public class CgProbe : Admin.NET.Core.EntityBaseId { " +
            string.Join(" ", model.TableField.Where(field => field.PropertyName != "Id").Select(field => (field.ColumnKey == "True" ? "[SqlSugar.SugarColumn(IsPrimaryKey=true)] " : "") + "public " + field.NetType + " " + field.PropertyName + " {get;set;}")) + " } public class CgOrg { public long Id {get;set;} public long? Pid {get;set;} public string Name {get;set;} } } namespace Example.Codegen { public static class CodegenConst { public const string GroupName=\"Probe\"; } }";
        sources.Add(CSharpSyntaxTree.ParseText(entity, path: "Entity.cs"));
        sources.Add(CSharpSyntaxTree.ParseText("global using System; global using System.Threading.Tasks; global using System.Linq; global using System.Collections.Generic; global using Admin.NET.Core; global using Furion.DynamicApiController; global using Furion.DependencyInjection; global using Furion.UnifyResult; global using Microsoft.AspNetCore.Mvc; global using Example.Codegen.Entity;", path: "GlobalUsings.cs"));

        // Act：真实编译生成的四个文件，包含所有真实依赖。
        var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator).Select(path => MetadataReference.CreateFromFile(path));
        var compilation = CSharpCompilation.Create("CodeGenProbe" + Guid.NewGuid().ToString("N"), sources, references, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        using var output = new MemoryStream();
        var result = compilation.Emit(output);

        // Assert：未删减服务分支，生成代码必须可编译。
        Assert.True(result.Success, string.Join("\n", result.Diagnostics.Where(diagnostic => diagnostic.Severity == DiagnosticSeverity.Error)));
    }

    private static CodeGenConfig Field(string name, string type, bool key = false, string query = "==", string effect = "Input", bool import = false) => new()
    {
        Id = name.GetHashCode(), CodeGenId = 10, ColumnName = name, PropertyName = name, ColumnComment = name, ColumnKey = key ? "True" : "False", WhetherCommon = "N", NetType = type, DataType = type,
        WhetherQuery = "Y", QueryType = query, WhetherAddUpdate = "Y", WhetherImport = import ? "Y" : "N", WhetherRequired = "N", EffectType = effect, DictTypeCode = effect == "DictSelector" ? "cg_probe" : null
    };
    internal static CustomViewEngine Model()
    {
        var fields = new List<CodeGenConfig>
        {
            new() { Id = 1, CodeGenId = 10, ColumnName = "Id", PropertyName = "Id", ColumnKey = "True", WhetherCommon = "N", NetType = "long", DataType = "long", ColumnComment = "主键", EffectType = "InputNumber", WhetherQuery = "N", WhetherAddUpdate = "N", WhetherImport = "N", WhetherRequired = "N" },
            new() { Id = 2, CodeGenId = 10, ColumnName = "Name", PropertyName = "Name", ColumnKey = "False", WhetherCommon = "N", NetType = "string", DataType = "string", ColumnComment = "名称", EffectType = "Input", QueryType = "like", WhetherQuery = "Y", WhetherAddUpdate = "Y", WhetherImport = "N", WhetherRequired = "Y", ColumnLength = 64 },
            new() { Id = 3, CodeGenId = 10, ColumnName = "Status", PropertyName = "Status", ColumnKey = "False", WhetherCommon = "N", NetType = "StatusEnum", DataType = "int", ColumnComment = "状态", EffectType = "EnumSelector", DictTypeCode = "StatusEnum", QueryType = "==", WhetherQuery = "Y", WhetherAddUpdate = "Y", WhetherImport = "N", WhetherRequired = "Y" }
        };
        return new CodeGenRenderModel
        {
            EntityNamespace = "Example.Codegen.Entity", EntityNamespaces = new[] { "Example.Codegen.Entity" }, ConfigId = "1300000000001", NameSpace = "Example.Codegen", ProjectLastName = "Codegen", ClassName = "CgProbe", LowerClassName = "cgProbe", BusName = "测试实体", AuthorName = "验收", PagePath = "main", PrintType = "off",
            TableField = fields, PrimaryKeyFieldList = fields.Where(field => field.ColumnKey == "True").ToList(), AddUpdateFieldList = fields.Where(field => field.WhetherAddUpdate == "Y").ToList(), QueryWhetherList = fields.Where(field => field.WhetherQuery == "Y").ToList(),
            ImportFieldList = new(), UploadFieldList = new(), ApiTreeFieldList = new(), DropdownFieldList = new(), DefaultValueList = new(), TableUniqueConfigList = new(), HasEnumField = true, HasLikeQuery = true
        };
    }

    private static CustomViewEngine RefreshFields(CustomViewEngine model)
    {
        var fields = model.TableField;
        model.PrimaryKeyFieldList = fields.Where(field => field.ColumnKey == "True").ToList();
        model.AddUpdateFieldList = fields.Where(field => field.WhetherAddUpdate == "Y").ToList();
        model.QueryWhetherList = fields.Where(field => field.WhetherQuery == "Y").ToList();
        model.ImportFieldList = fields.Where(field => field.WhetherImport == "Y").ToList();
        model.UploadFieldList = fields.Where(field => field.EffectType is "Upload" or "Upload_SingleFile").ToList();
        model.ApiTreeFieldList = fields.Where(field => field.EffectType == "ApiTreeSelector").ToList();
        model.DropdownFieldList = fields.Where(field => field.EffectType is "ForeignKey" or "ApiTreeSelector").ToList();
        model.HasJoinTable = model.DropdownFieldList.Count > 0;
        model.HasDictField = fields.Any(field => field.EffectType == "DictSelector");
        return model;
    }
    internal static string RepositoryRoot([CallerFilePath] string sourcePath = "") => Path.GetFullPath(Path.Combine(Path.GetDirectoryName(sourcePath)!, "../../.."));
}
