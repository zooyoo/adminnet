// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core.Service;
using Furion.ViewEngine;
using Microsoft.Extensions.DependencyInjection;
using System.Text.Json;
using Xunit;

namespace Admin.NET.Test.CodeGen;

public class CodeGenFrontendTemplateTests
{
    [Theory]
    [InlineData("api.ts.vm")]
    [InlineData("index.vue.vm")]
    [InlineData("editDialog.vue.vm")]
    public async Task Render_FrontendTemplate_UsesSharedComponentsAndActualSdk(string file)
    {
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var engine = provider.GetRequiredService<IViewEngine>();
        var source = await File.ReadAllTextAsync(Path.Combine(CodeGenTemplateRenderingTests.RepositoryRoot(), "Admin.NET/Admin.NET.Web.Entry/wwwroot/template", file));
        var model = CodeGenTemplateRenderingTests.Model();
        model.BusName = "名称\"</script>安全";
        if (file == "api.ts.vm")
        {
            var upload = model.TableField.First(field => field.PropertyName == "Name");
            upload.EffectType = "Upload_SingleFile";
            upload.WhetherImport = "Y";
            model.ImportFieldList = new() { upload };
            model.UploadFieldList = new() { upload };
        }
        var output = await engine.RunCompileFromCachedAsync(source, model, builderAction: builder =>
        {
            builder.AddAssemblyReferenceByName(typeof(CustomViewEngine).Assembly.GetName().Name);
            builder.AddAssemblyReferenceByName("System.Text.Json");
            builder.AddAssemblyReferenceByName("System.Linq");
            builder.AddAssemblyReferenceByName("System.Collections");
            builder.AddUsing("System.Linq");
        });
        Assert.DoesNotContain("element-plus", output, StringComparison.OrdinalIgnoreCase);
        Assert.DoesNotContain("/@@", output);
        Assert.DoesNotContain("&quot;", output);
        if (file == "api.ts.vm")
        {
            Assert.Contains("getAPI(CgProbeApi)", output);
            Assert.Contains("Parameters<typeof sdk.apiCgProbeDetailGet>[0]", output);
            foreach (var method in new[] { "PagePost", "AddPost", "UpdatePost", "DeletePost", "BatchDeletePost" })
                Assert.Contains($"Parameters<typeof sdk.apiCgProbe{method}>[0]", output);
            Assert.DoesNotContain("@(model.", output);
            Assert.Contains("apiCgProbeSetStatusPost", output);
            Assert.Contains("apiCgProbeImportPostForm(file,", output);
            Assert.Contains("apiCgProbeUploadNamePostForm(file,", output);
            Assert.Contains("response.data instanceof ArrayBuffer", output);
            Assert.Contains("values as unknown as Parameters<typeof sdk.apiCgProbeAddPost>[0]", output);
            Assert.DoesNotContain("UpdatePost>[0]" + ", { signal, silentError: true })).data.result", output);
            Assert.DoesNotContain("</script>", output);
        }
        else Assert.Contains("#/api/main/cgProbe", output);
    }

    [Fact]
    public void Schema_NonNullableBooleanSwitchWithoutDefault_InitializesFalse()
    {
        var model = CodeGenTemplateRenderingTests.Model();
        var field = new CodeGenConfig { PropertyName = "Enabled", NetType = "bool", EffectType = "Switch" };
        model.AddUpdateFieldList.Add(field);
        using var required = JsonDocument.Parse(model.FrontendSchemaJson);
        Assert.False(required.RootElement.GetProperty("defaults").GetProperty("enabled").GetBoolean());
        field.NetType = "bool?";
        using var nullable = JsonDocument.Parse(model.FrontendSchemaJson);
        Assert.False(nullable.RootElement.GetProperty("defaults").TryGetProperty("enabled", out _));
    }

    [Theory]
    [InlineData("NULL", null)]
    [InlineData("(NULL::character varying)", null)]
    [InlineData("('a''b'::text)", "a'b")]
    [InlineData("'NULL'::text", "NULL")]
    [InlineData("gen_random_uuid()", null)]
    public void Schema_PostgreSqlTypedDefault_OnlyCopiesLiteral(string defaultValue, string expected)
    {
        var model = CodeGenTemplateRenderingTests.Model();
        model.AddUpdateFieldList.First(field => field.PropertyName == "Name").DefaultValue = defaultValue;
        using var json = JsonDocument.Parse(model.FrontendSchemaJson);
        var exists = json.RootElement.GetProperty("defaults").TryGetProperty("name", out var value);
        Assert.Equal(expected != null, exists);
        if (exists) Assert.Equal(expected, value.GetString());
    }

    [Fact]
    public void Schema_QuotesAndSqlDefaults_UsesSafeJsonAndTypedValues()
    {
        var model = CodeGenTemplateRenderingTests.Model();
        model.BusName = "标题\"</script>";
        model.AddUpdateFieldList[0].DefaultValue = "('a''b')";
        using var json = JsonDocument.Parse(model.FrontendSchemaJson);
        Assert.Equal(model.BusName, json.RootElement.GetProperty("title").GetString());
        Assert.DoesNotContain("</script>", model.FrontendSchemaJson);
        Assert.Equal("a'b", json.RootElement.GetProperty("defaults").GetProperty("name").GetString());
    }
}