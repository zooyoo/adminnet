// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷、行政处罚及侵权赔偿由相关行为人自行承担。

using Admin.NET.Core.Service;
using Furion.DynamicApiController;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ApplicationParts;
using Microsoft.AspNetCore.Mvc.Controllers;
using System.Reflection;
using System.Reflection.Emit;
using Xunit;

namespace Admin.NET.Test.Plugin;

public class PluginRuntimeTests
{
    [Fact]
    public void CompileCSharp_ValidThenInvalidSource_PreservesPublishedController()
    {
        ApplicationPartManager parts = new();
        parts.FeatureProviders.Add(new ControllerFeatureProvider());
        MvcActionDescriptorChangeProvider changes = new();
        Type implementation = typeof(IDynamicApiRuntimeChangeProvider).Assembly.GetType("Furion.DynamicApiController.DynamicApiRuntimeChangeProvider", true)!;
        IDynamicApiRuntimeChangeProvider provider = (IDynamicApiRuntimeChangeProvider)Activator.CreateInstance(implementation, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, new object[] { parts, changes }, null)!;
        const string source = "public class PluginCompileProbeController { public string Get() => \"插件34\"; }";
        using var compiled = Furion.App.CompileCSharpClassCode(source, "PluginCompileProbe" + Guid.NewGuid().ToString("N"));
        Assembly published = compiled.Assembly;
        provider.AddAssembliesWithNotifyChanges(published);
        // 服务方法返回前会释放编译句柄，MVC 持有的程序集仍须可发现和调用。
        compiled.Dispose();
        try
        {
            Assert.ThrowsAny<Exception>(() =>
            {
                using var invalid = Furion.App.CompileCSharpClassCode("public class Broken { this is invalid C#; }", "InvalidProbe" + Guid.NewGuid().ToString("N"));
            });
            ControllerFeature feature = new();
            parts.PopulateFeature(feature);
            TypeInfo controller = Assert.Single(feature.Controllers);
            Assert.Same(published, controller.Assembly);
            Assert.Equal("插件34", controller.GetMethod("Get")!.Invoke(Activator.CreateInstance(controller.AsType()), null));
        }
        finally
        {
            provider.RemoveAssembliesWithNotifyChanges(published);
        }
        ControllerFeature removed = new();
        parts.PopulateFeature(removed);
        Assert.Empty(removed.Controllers);
    }

    private static Assembly CreateProbe(string prefix)
    {
        AssemblyBuilder assembly = AssemblyBuilder.DefineDynamicAssembly(new AssemblyName(prefix + Guid.NewGuid().ToString("N")), AssemblyBuilderAccess.RunAndCollect);
        TypeBuilder type = assembly.DefineDynamicModule("Probe").DefineType(prefix + "Controller", TypeAttributes.Public, typeof(ControllerBase));
        MethodBuilder method = type.DefineMethod("Get", MethodAttributes.Public, typeof(int), Type.EmptyTypes);
        ILGenerator code = method.GetILGenerator();
        code.Emit(OpCodes.Ldc_I4, 34);
        code.Emit(OpCodes.Ret);
        // AssemblyBuilder 是构建器包装；MVC 使用完成类型所属的实际运行程序集。
        return type.CreateType()!.Assembly;
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task ExecuteAsync_RealMvcReplacement_RestoresOriginalOnCommitFailure(bool failCommit)
    {
        ApplicationPartManager parts = new();
        parts.FeatureProviders.Add(new ControllerFeatureProvider());
        MvcActionDescriptorChangeProvider changes = new();
        // Furion 将实现类设为 internal；测试实例化实际实现，调用只经公开接口。
        Type implementation = typeof(IDynamicApiRuntimeChangeProvider).Assembly.GetType("Furion.DynamicApiController.DynamicApiRuntimeChangeProvider", true)!;
        IDynamicApiRuntimeChangeProvider provider = (IDynamicApiRuntimeChangeProvider)Activator.CreateInstance(implementation, BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic, null, new object[] { parts, changes }, null)!;
        Assembly previous = CreateProbe("Original");
        Assembly replacement = CreateProbe("Replacement");
        provider.AddAssembliesWithNotifyChanges(previous);
        var token = changes.GetChangeToken();
        bool rolledBack = false;
        Task Execute() => PluginMutation.ExecuteAsync(
            () => Task.CompletedTask, () => Task.CompletedTask,
            () => { provider.RemoveAssemblies(previous); provider.AddAssemblies(replacement); provider.NotifyChanges(); },
            () => failCommit ? Task.FromException(new InvalidOperationException("commit")) : Task.CompletedTask,
            () => { rolledBack = true; return Task.CompletedTask; },
            () => { provider.RemoveAssemblies(replacement); provider.AddAssemblies(previous); provider.NotifyChanges(); });
        if (failCommit) await Assert.ThrowsAsync<InvalidOperationException>(Execute);
        else await Execute();
        Assert.Equal(failCommit, rolledBack);
        Assert.True(token.HasChanged);
        ControllerFeature feature = new();
        parts.PopulateFeature(feature);
        TypeInfo controller = Assert.Single(feature.Controllers);
        Assert.Same(failCommit ? previous : replacement, controller.Assembly);
        Assert.Equal(34, controller.GetMethod("Get")!.Invoke(Activator.CreateInstance(controller.AsType()), null));
        provider.RemoveAssembliesWithNotifyChanges(controller.Assembly);
        ControllerFeature removed = new();
        parts.PopulateFeature(removed);
        Assert.Empty(removed.Controllers);
    }
}
