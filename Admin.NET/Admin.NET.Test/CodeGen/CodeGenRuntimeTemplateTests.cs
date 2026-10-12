// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using Microsoft.CodeAnalysis;
using Microsoft.CodeAnalysis.CSharp;
using Furion.ViewEngine;
using Microsoft.Extensions.DependencyInjection;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public class CodeGenRuntimeTemplateTests
{
    [Theory]
    [InlineData("Service.cs.vm")]
    [InlineData("Input.cs.vm")]
    [InlineData("Output.cs.vm")]
    [InlineData("Dto.cs.vm")]
    [InlineData("index.vue.vm")]
    [InlineData("editDialog.vue.vm")]
    [InlineData("api.ts.vm")]
    public async Task Render_SealedRuntimeModel_UsesConfiguredTemplateBase(string template)
    {
        // Arrange：复用 API 的真实模型类型和同一渲染入口。
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var engine = provider.GetRequiredService<IViewEngine>();
        var model = Assert.IsType<CodeGenRenderModel>(CodeGenTemplateRenderingTests.Model());
        var path = Path.Combine(CodeGenTemplateRenderingTests.RepositoryRoot(), "Admin.NET/Admin.NET.Web.Entry/wwwroot/template", template);
        var source = await File.ReadAllTextAsync(path);

        // Act
        var output = await CodeGenTemplateSupport.RenderAsync(engine, source, model);

        // Assert
        Assert.Contains("cgProbe", output, StringComparison.OrdinalIgnoreCase);
        if (template == "Service.cs.vm")
            Assert.Contains("[ApiDescriptionSettings(Order = 100)]", output);
        Assert.DoesNotContain("element-plus", output, StringComparison.OrdinalIgnoreCase);
    }
    [Fact]
    public async Task Render_TreeForeignEntityWithChildren_UsesIndependentDtoAndExplicitKeys()
    {
        // Arrange：所属实体已带 Children 时，生成 DTO 必须避免同名继承属性。
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var model = CodeGenTemplateRenderingTests.Model();
        model.ApiTreeFieldList = new()
        {
            new CodeGenConfig { PropertyName = "LinkedOrgId", NetType = "long?", EffectType = "ApiTreeSelector", FkEntityName = "SysOrg", FkLinkColumnName = "Id", PidColumn = "Pid" }
        };
        var path = Path.Combine(CodeGenTemplateRenderingTests.RepositoryRoot(), "Admin.NET/Admin.NET.Web.Entry/wwwroot/template/Output.cs.vm");
        var output = await CodeGenTemplateSupport.RenderAsync(provider.GetRequiredService<IViewEngine>(), await File.ReadAllTextAsync(path), model);
        var treeSource = "using System.Collections.Generic;\n" + output[output.IndexOf("public class TreeLinkedOrgOutput", StringComparison.Ordinal)..];
        var references = ((string)AppContext.GetData("TRUSTED_PLATFORM_ASSEMBLIES")!).Split(Path.PathSeparator)
            .Select(path => MetadataReference.CreateFromFile(path)).Append(MetadataReference.CreateFromFile(typeof(SqlSugar.SugarColumn).Assembly.Location));

        // Act：编译实际生成类，并验证反射读取 Children 不会产生歧义。
        var compilation = CSharpCompilation.Create("GeneratedTree_" + Guid.NewGuid().ToString("N"),
            new[] { CSharpSyntaxTree.ParseText(treeSource) }, references, new CSharpCompilationOptions(OutputKind.DynamicallyLinkedLibrary));
        using var bytes = new MemoryStream();
        var result = compilation.Emit(bytes);
        Assert.True(result.Success, string.Join(Environment.NewLine, result.Diagnostics.Where(d => d.Severity == DiagnosticSeverity.Error)));
        var type = System.Reflection.Assembly.Load(bytes.ToArray()).GetType("TreeLinkedOrgOutput")!;

        // Assert
        Assert.Equal(typeof(object), type.BaseType);
        Assert.NotNull(type.GetProperty("Children"));
        Assert.NotNull(type.GetProperty("ParentValue"));
    }
}
