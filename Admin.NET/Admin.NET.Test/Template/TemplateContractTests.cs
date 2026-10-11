// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Security.Claims;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Admin.NET.Core;
using Admin.NET.Core.Service;
using Furion.FriendlyException;
using Furion.ViewEngine;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;
using Microsoft.Extensions.DependencyInjection;
using SqlSugar;
using Xunit;

namespace Admin.NET.Test.Template;

// 复用 RegionContractTests 注册的 AssemblyFixture<RegionTestHost>，不创建第二个 Furion Host。
public class TemplateContractTests
{
    private const string RawContent = "  <p>中文🌱 &amp; @(title)</p>\r\n\t保留空格  ";

    [Theory]
    [InlineData(1)]
    [InlineData(2)]
    [InlineData(3)]
    [InlineData(4)]
    [InlineData(7)]
    public void ValidateTemplate_ExistingEnumValues_PreservesFields(int type)
    {
        var input = AddInput();
        input.Type = (TemplateTypeEnum)type;
        input.Name = new string('名', 128);
        input.Code = new string('C', 128);
        input.GroupName = new string('组', 32);
        input.Remark = new string('注', 128);

        TemplateContracts.ValidateTemplate(input);
        var entity = TemplateContracts.CreateEntity(input, false, 1);

        Assert.Equal(input.Name, entity.Name);
        Assert.Equal(input.Code, entity.Code);
        Assert.Equal(input.GroupName, entity.GroupName);
        Assert.Equal(input.Remark, entity.Remark);
        Assert.Equal(input.Type, entity.Type);
        Assert.Equal(RawContent, entity.Content);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(5)]
    [InlineData(6)]
    [InlineData(8)]
    [InlineData(-1)]
    public async Task AddAndPage_UndefinedEnum_RejectBeforeRepository(int type)
    {
        var service = Service();
        var input = AddInput();
        input.Type = (TemplateTypeEnum)type;

        var addError = await Assert.ThrowsAsync<AppFriendlyException>(() => service.AddTemplate(input));
        var pageError = await Assert.ThrowsAsync<AppFriendlyException>(() => service.Page(new PageTemplateInput { Type = input.Type }));

        Assert.Equal("模板类型无效", addError.Message);
        Assert.Equal("模板类型无效", pageError.Message);
        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.WriteAttempts);
    }

    [Theory]
    [InlineData("Name", 129, "名称长度不能超过128个字符")]
    [InlineData("Code", 129, "编码长度不能超过128个字符")]
    [InlineData("GroupName", 33, "分组名称长度不能超过32个字符")]
    [InlineData("Remark", 129, "备注长度不能超过128个字符")]
    public async Task Add_OverColumnLength_RejectBeforeRepository(string field, int length, string message)
    {
        var service = Service();
        var input = AddInput();
        typeof(AddTemplateInput).GetProperty(field).SetValue(input, new string('x', length));

        var error = await Assert.ThrowsAsync<AppFriendlyException>(() => service.AddTemplate(input));

        Assert.Equal(message, error.Message);
        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.WriteAttempts);
    }

    [Theory]
    [InlineData("Name", "名称不能为空")]
    [InlineData("Code", "编码不能为空")]
    [InlineData("GroupName", "分组名称不能为空")]
    [InlineData("Content", "模板内容不能为空")]
    public async Task Add_WhitespaceRequiredField_RejectBeforeRepository(string field, string message)
    {
        var service = Service();
        var input = AddInput();
        typeof(AddTemplateInput).GetProperty(field).SetValue(input, " \r\n\t ");

        var error = await Assert.ThrowsAsync<AppFriendlyException>(() => service.AddTemplate(input));

        Assert.Equal(message, error.Message);
        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.WriteAttempts);
    }

    [Fact]
    public async Task Add_LongRawContent_DoesNotIntroduceLengthLimit()
    {
        var service = Service();
        var input = AddInput();
        input.Content = RawContent + new string('长', 70000);

        await service.AddTemplate(input);

        Assert.Equal(input.Content, Assert.Single(service.Templates).Content);
    }

    [Fact]
    public async Task Add_UntrustedIdentityAndAudit_CopiesOnlyEditableFields()
    {
        var service = Service();
        var input = AddInput();
        input.Id = 888;
        input.TenantId = 0;
        input.CreateTime = new DateTime(2001, 1, 1);
        input.UpdateTime = new DateTime(2002, 1, 1);
        input.CreateUserId = input.UpdateUserId = 888;
        input.CreateUserName = input.UpdateUserName = "伪造审计";

        await service.AddTemplate(input);
        var stored = Assert.Single(service.Templates);

        Assert.Equal(1L, stored.Id);
        Assert.Equal(1L, stored.TenantId);
        Assert.Equal(default(DateTime), stored.CreateTime);
        Assert.Null(stored.UpdateTime);
        Assert.Null(stored.CreateUserId);
        Assert.Null(stored.UpdateUserId);
        Assert.Null(stored.CreateUserName);
        Assert.Null(stored.UpdateUserName);
        Assert.Equal(RawContent, stored.Content);
        Assert.Equal(888L, input.Id);
        Assert.Equal("伪造审计", input.CreateUserName);
    }

    [Fact]
    public async Task AddAndUpdate_ForeignSuppliedTenant_RejectBeforeRepository()
    {
        var service = Service();
        var add = AddInput();
        add.TenantId = 2;
        var update = UpdateInput(1);
        update.TenantId = 2;

        await AssertBusinessErrorAsync(() => service.AddTemplate(add), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.UpdateTemplate(update), ErrorCodeEnum.D1016);

        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.WriteAttempts);
    }

    [Fact]
    public async Task OrdinaryAccount_MissingTenantClaim_RejectsStoredTemplateOperations()
    {
        var service = Service(tenantId: 0);

        await AssertBusinessErrorAsync(() => service.Page(new PageTemplateInput()), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.GetGroupList(), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.GetTemplate("模板"), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.AddTemplate(AddInput()), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.UpdateTemplate(UpdateInput(1)), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.DeleteTemplate(new BaseIdInput { Id = 1 }), ErrorCodeEnum.D1016);
        await AssertBusinessErrorAsync(() => service.ProView(new ProViewTemplateInput { Id = 1, Data = new object() }), ErrorCodeEnum.D1016);

        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.WriteAttempts);
        Assert.Equal(0, service.Engine.Calls);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(-1)]
    public async Task UpdateDeleteAndProView_NonPositiveId_RejectBeforeRepository(long id)
    {
        var service = Service();
        await AssertBusinessErrorAsync(() => service.UpdateTemplate(UpdateInput(id)), ErrorCodeEnum.D1012);
        await AssertBusinessErrorAsync(() => service.DeleteTemplate(new BaseIdInput { Id = id }), ErrorCodeEnum.D1012);
        await AssertBusinessErrorAsync(() => service.ProView(new ProViewTemplateInput { Id = id, Data = new object() }), ErrorCodeEnum.D1012);

        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.WriteAttempts);
        Assert.Equal(0, service.Engine.Calls);
    }

    [Theory]
    [InlineData(2)]
    [InlineData(404)]
    public async Task UpdateDeleteAndProView_ForeignOrMissingId_DoesNotWriteOrRender(long id)
    {
        var service = Service();
        var foreign = Stored(2, 2);
        service.Templates.Add(foreign);

        await AssertBusinessErrorAsync(() => service.UpdateTemplate(UpdateInput(id)), ErrorCodeEnum.D1002);
        await AssertBusinessErrorAsync(() => service.DeleteTemplate(new BaseIdInput { Id = id }), ErrorCodeEnum.D1002);
        await AssertBusinessErrorAsync(() => service.ProView(new ProViewTemplateInput { Id = id, Data = new object() }), ErrorCodeEnum.D1002);

        Assert.Equal(0, service.WriteAttempts);
        Assert.Equal(0, service.Engine.Calls);
        Assert.Same(foreign, Assert.Single(service.Templates));
        Assert.Equal(RawContent, foreign.Content);
        Assert.Equal(2L, foreign.TenantId);
    }

    [Fact]
    public async Task GetTemplate_LegacyNameLookup_RemainsTenantScoped()
    {
        var service = Service();
        var byName = Stored(1, 1);
        byName.Name = "lookup";
        byName.Code = "other-code";
        var byCode = Stored(2, 1);
        byCode.Name = "other-name";
        byCode.Code = "lookup";
        var foreign = Stored(3, 2);
        foreign.Name = "foreign";
        service.Templates.AddRange(new[] { byName, byCode, foreign });

        Assert.Same(byName, await service.GetTemplate("lookup"));
        await AssertBusinessErrorAsync(() => service.GetTemplate("foreign"), ErrorCodeEnum.D1002);
        await AssertBusinessErrorAsync(() => service.GetTemplate("missing"), ErrorCodeEnum.D1002);

        Assert.Equal(0, service.WriteAttempts);
        Assert.Equal(0, service.Engine.Calls);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public async Task AddAndUpdate_DuplicateNameOrGlobalCode_DoNotWrite(bool duplicateName)
    {
        var service = Service();
        var existing = Stored(10, duplicateName ? 1 : 2);
        existing.Name = duplicateName ? "模板" : "其他租户模板";
        existing.Code = duplicateName ? "another-code" : "template-code";
        var original = Stored(1, 1);
        original.Name = "原名称";
        original.Code = "original-code";
        service.Templates.AddRange(new[] { original, existing });
        var code = duplicateName ? ErrorCodeEnum.T1000 : ErrorCodeEnum.T1001;

        await AssertBusinessErrorAsync(() => service.AddTemplate(AddInput()), code);
        await AssertBusinessErrorAsync(() => service.UpdateTemplate(UpdateInput(original.Id)), code);

        Assert.Equal(0, service.WriteAttempts);
        Assert.Equal(RawContent, original.Content);
        Assert.Equal("原名称", original.Name);
        if (!duplicateName) Assert.Equal(2, service.GlobalCodeChecks);
    }

    [Fact]
    public async Task Update_OwnNameAndCode_PreservesRawContentOwnerAndCreateAuditAndClearsRemark()
    {
        var service = Service();
        var original = Stored(1, 1);
        original.CreateTime = new DateTime(2020, 1, 1);
        original.CreateUserId = 123;
        original.CreateUserName = "原创建人";
        original.Remark = "待清空";
        service.Templates.Add(original);
        var input = UpdateInput(original.Id);
        input.Content = RawContent + "\r\n  更新后的正文  ";
        input.Remark = null;
        input.CreateTime = new DateTime(2001, 1, 1);
        input.CreateUserId = input.UpdateUserId = 888;
        input.CreateUserName = input.UpdateUserName = "伪造审计";

        await service.UpdateTemplate(input);
        var reopened = await service.GetTemplate(input.Name);

        Assert.Equal(input.Content, reopened.Content);
        Assert.Null(reopened.Remark);
        Assert.Equal(1L, reopened.TenantId);
        Assert.Equal(new DateTime(2020, 1, 1), reopened.CreateTime);
        Assert.Equal(123L, reopened.CreateUserId);
        Assert.Equal("原创建人", reopened.CreateUserName);
        Assert.Null(service.LastWrite.UpdateUserId);
        Assert.Null(service.LastWrite.UpdateUserName);
    }

    [Fact]
    public async Task SuperAdmin_CrossTenantCrud_KeepsExistingOwner()
    {
        var service = Service(superAdmin: true);
        var original = Stored(1, 2);
        service.Templates.Add(original);
        var input = UpdateInput(original.Id);
        input.TenantId = 9;

        await service.UpdateTemplate(input);
        Assert.Equal(2L, original.TenantId);
        Assert.Equal(2L, service.LastWrite.TenantId);
        Assert.Same(original, await service.GetTemplate(original.Name));
        await service.ProView(new ProViewTemplateInput { Id = original.Id, Data = new object() });
        await service.DeleteTemplate(new BaseIdInput { Id = original.Id });
        Assert.Empty(service.Templates);
        var add = AddInput();
        add.TenantId = 9;
        await service.AddTemplate(add);
        Assert.Equal(9L, Assert.Single(service.Templates).TenantId);
    }

    [Theory]
    [InlineData("add")]
    [InlineData("update")]
    [InlineData("delete")]
    public async Task Mutation_RepositoryFailure_AllowsSameInputRetry(string operation)
    {
        var service = Service();
        var original = Stored(1, 1);
        if (operation != "add") service.Templates.Add(original);
        var add = AddInput();
        var update = UpdateInput(1);
        update.Content = RawContent + "\r\n重试内容 ";
        Func<Task> action = operation switch
        {
            "add" => () => service.AddTemplate(add),
            "update" => () => service.UpdateTemplate(update),
            _ => () => service.DeleteTemplate(new BaseIdInput { Id = 1 })
        };
        service.FailNextWrite = true;

        var error = await Assert.ThrowsAsync<AppFriendlyException>(action);

        Assert.Equal("模板保存失败，请稍后重试", error.Message);
        Assert.Equal(0, service.Writes);
        Assert.Equal(RawContent, original.Content);
        Assert.Equal(RawContent, add.Content);
        Assert.Equal(RawContent + "\r\n重试内容 ", update.Content);
        await action();
        Assert.Equal(1, service.Writes);
        if (operation == "delete") Assert.Empty(service.Templates);
        else Assert.Equal(operation == "add" ? add.Content : update.Content, Assert.Single(service.Templates).Content);
    }

    [Fact]
    public async Task Render_CompileFailure_PreservesInputAndAllowsRetryWithOriginalEngineContract()
    {
        var service = Service();
        var data = new Dictionary<string, object> { ["title"] = "渲染值" };
        var input = new RenderTemplateInput { Content = RawContent, Data = data };
        service.Engine.FailNext = true;

        var error = await Assert.ThrowsAsync<AppFriendlyException>(() => service.Render(input));

        Assert.Equal("模板渲染失败，请检查模板内容与渲染参数后重试", error.Message);
        Assert.Equal(RawContent, input.Content);
        Assert.Same(data, input.Data);
        Assert.Equal("引擎返回值", await service.Render(input));
        Assert.Equal(2, service.Engine.Calls);
        Assert.Equal("  <p>中文🌱 &amp; @(Model.title)</p>\r\n\t保留空格  ", service.Engine.CompiledContent);
        Assert.Same(data, service.Engine.Data);
        Assert.Equal(0, service.WriteAttempts);
    }

    [Fact]
    public async Task RenderAsync_ExistingRegexAndCompileOptions_DoesNotExpandEngineCapabilities()
    {
        var service = Service();
        var data = new object();
        var content = "@(title)\r\n@(items[0])\r\n@(line\r\ncontinued)";

        await service.RenderAsync(content, data);

        Assert.Equal("@(Model.title)\r\n@(Model.items[0])\r\n@(line\r\ncontinued)", service.Engine.CompiledContent);
        Assert.Same(data, service.Engine.Data);
        Assert.Equal(new[] { "System.Text.RegularExpressions", "System.Collections", "System.Linq" }, service.Engine.Options.Assemblies);
        Assert.Equal(new[] { "System.Text.RegularExpressions", "System.Collections.Generic", "System.Linq" }, service.Engine.Options.Usings);
    }

    [Fact]
    public async Task ProView_OwnSavedTemplate_PassesSavedContentAndExactDataToEngine()
    {
        var service = Service();
        var stored = Stored(1, 1);
        stored.Content = "  <p>不含表达式的中文🌱</p>\r\n  ";
        service.Templates.Add(stored);
        var data = new object();

        Assert.Equal("引擎返回值", await service.ProView(new ProViewTemplateInput { Id = 1, Data = data }));

        Assert.Equal(stored.Content, service.Engine.CompiledContent);
        Assert.Same(data, service.Engine.Data);
        Assert.Equal(0, service.WriteAttempts);
    }

    [Fact]
    public async Task RenderAndProView_InvalidContentOrData_DoNotCallEngine()
    {
        var service = Service();
        var emptyContent = await Assert.ThrowsAsync<AppFriendlyException>(() => service.Render(new RenderTemplateInput { Content = " \r\n ", Data = new object() }));
        var emptyData = await Assert.ThrowsAsync<AppFriendlyException>(() => service.Render(new RenderTemplateInput { Content = RawContent, Data = null }));
        var previewData = await Assert.ThrowsAsync<AppFriendlyException>(() => service.ProView(new ProViewTemplateInput { Id = 1, Data = null }));

        Assert.Equal("模板内容不能为空", emptyContent.Message);
        Assert.Equal("渲染参数不能为空", emptyData.Message);
        Assert.Equal("渲染参数不能为空", previewData.Message);
        Assert.Equal(0, service.Reads);
        Assert.Equal(0, service.Engine.Calls);
    }

    [Theory]
    [InlineData("groupList", "page")]
    [InlineData("template", "page")]
    [InlineData("render", "preview")]
    [InlineData("proView", "preview")]
    [InlineData("page", "page")]
    [InlineData("add", "add")]
    [InlineData("update", "update")]
    [InlineData("delete", "delete")]
    public void RoutePermission_TemplateEndpoints_UseExistingExplicitGrant(string action, string grant)
    {
        var context = new DefaultHttpContext();
        context.SetEndpoint(new RouteEndpoint(_ => Task.CompletedTask, RoutePatternFactory.Parse($"/api/sysTemplate/{action}"), 0, new EndpointMetadataCollection(), "template"));

        var permission = RoutePermissionUtil.GetPermissionName(context);

        Assert.Equal($"sysTemplate:{grant}", permission);
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant(permission));
        Assert.True(RoutePermissionUtil.HasPermission(permission, new[] { $"sysTemplate:{grant}" }));
        Assert.False(RoutePermissionUtil.HasPermission(permission, Array.Empty<string>()));
        Assert.False(RoutePermissionUtil.HasPermission(permission, new[] { "sysTemplate:*" }));
    }

    [Fact]
    public void RoutePermission_PageGrant_DoesNotAuthorizePreviewOrUndeclaredRoutes()
    {
        Assert.False(RoutePermissionUtil.HasPermission("sysTemplate:preview", new[] { "sysTemplate:page", "sysTemplate:add", "sysTemplate:update" }));
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant("sysTemplate:futureAction"));
        Assert.True(RoutePermissionUtil.RequiresExplicitGrant("SYSTEMPLATE:render"));
    }

    [Fact]
    public void PageQuery_OrdinaryForeignTenantFilter_DerivesOnlyOwnTenantPostgreSql()
    {
        using var db = SqlOnlyDatabase();
        var query = TemplateContracts.PageQuery(db.Queryable<SysTemplate>(), new PageTemplateInput { TenantId = 2 }, false, 1).ToSql();

        Assert.Contains("tenantid", NormalizeSql(query.Key));
        Assert.Contains(query.Value, parameter => parameter.Value?.ToString() == "1");
        Assert.DoesNotContain(query.Value, parameter => parameter.Value?.ToString() == "2");
        Assert.Contains("orderby", NormalizeSql(query.Key));
    }

    [Fact]
    public void PageQuery_SuperAdminTenantFilter_PreservesCrossTenantContract()
    {
        using var db = SqlOnlyDatabase();
        var query = TemplateContracts.PageQuery(db.Queryable<SysTemplate>(), new PageTemplateInput { TenantId = 2 }, true, 1).ToSql();

        Assert.Contains("tenantid", NormalizeSql(query.Key));
        Assert.Contains(query.Value, parameter => parameter.Value?.ToString() == "2");
        Assert.DoesNotContain(query.Value, parameter => parameter.Value?.ToString() == "1");
    }

    [Fact]
    public void UpdateQuery_NullRemark_UsesWhitelistAndOwnerInPostgreSql()
    {
        using var db = SqlOnlyDatabase();
        var input = UpdateInput(11);
        input.Remark = null;
        var update = TemplateContracts.UpdateEntity(Stored(11, 2), input);
        var command = TemplateContracts.UpdateQuery(db.Updateable(update), update.Id, update.TenantId).ToSql();
        var sql = NormalizeSql(command.Key);
        var parts = sql.Split("where", 2);
        var set = parts[0].Split("set", 2)[1];

        Assert.Contains("remark", set);
        Assert.Contains("content", set);
        Assert.Contains("updatetime", set);
        Assert.DoesNotContain("tenantid", set);
        Assert.DoesNotContain("createtime", set);
        Assert.DoesNotContain("createuserid", set);
        Assert.DoesNotContain("createusername", set);
        var whereIndex = command.Key.IndexOf("WHERE", StringComparison.OrdinalIgnoreCase);
        Assert.True(whereIndex >= 0, "模板更新必须包含 WHERE 谓词");
        var where = command.Key[(whereIndex + "WHERE".Length)..];
        // 匹配独立列名及其实际绑定参数，不能由 tenantid 或未使用的 @Id 参数误满足。
        var idCondition = Regex.Match(where, "\"id\"\\s*=\\s*(?<parameter>@[A-Za-z0-9_]+)", RegexOptions.IgnoreCase);
        var ownerCondition = Regex.Match(where, "\"tenantid\"\\s*=\\s*(?<parameter>@[A-Za-z0-9_]+)", RegexOptions.IgnoreCase);
        Assert.True(idCondition.Success, where);
        Assert.True(ownerCondition.Success, where);
        Assert.NotEqual(idCondition.Groups["parameter"].Value, ownerCondition.Groups["parameter"].Value);
        var idParameter = Assert.Single(command.Value.Where(parameter => parameter.ParameterName == idCondition.Groups["parameter"].Value));
        var ownerParameter = Assert.Single(command.Value.Where(parameter => parameter.ParameterName == ownerCondition.Groups["parameter"].Value));
        Assert.Equal(11L, Convert.ToInt64(idParameter.Value));
        Assert.Equal(2L, Convert.ToInt64(ownerParameter.Value));
    }

    [Fact]
    public void CodeDuplicateQuery_GlobalIndex_ClearsOnlyTenantFilter()
    {
        using var db = SqlOnlyDatabase();
        db.QueryFilter.AddTableFilter<ITenantIdFilter>(template => template.TenantId == 1);
        var predicate = TemplateContracts.CodeDuplicatePredicate("global-code", 11);
        var scoped = db.Queryable<SysTemplate>().Where(predicate).ToSql();
        var global = db.Queryable<SysTemplate>().ClearFilter<ITenantIdFilter>().Where(predicate).ToSql();

        var scopedWhereIndex = scoped.Key.IndexOf("WHERE", StringComparison.OrdinalIgnoreCase);
        var globalWhereIndex = global.Key.IndexOf("WHERE", StringComparison.OrdinalIgnoreCase);
        Assert.True(scopedWhereIndex >= 0, "租户判重查询必须保留 WHERE 谓词");
        Assert.True(globalWhereIndex >= 0, "全局 Code 判重查询必须保留 WHERE 谓词");
        var scopedWhere = NormalizeSql(scoped.Key[(scopedWhereIndex + "WHERE".Length)..]);
        var globalWhere = NormalizeSql(global.Key[(globalWhereIndex + "WHERE".Length)..]);

        Assert.Contains("tenantid", scopedWhere);
        Assert.DoesNotContain("tenantid", globalWhere);
        Assert.Contains("code", globalWhere);
        Assert.Contains("id", globalWhere);
        Assert.Contains(global.Value, parameter => parameter.Value?.ToString() == "global-code");
        Assert.Contains(global.Value, parameter => parameter.Value?.ToString() == "11");
        Assert.False(predicate.Compile()(new SysTemplate { Id = 11, Code = "global-code", TenantId = 2 }));
        Assert.True(predicate.Compile()(new SysTemplate { Id = 12, Code = "global-code", TenantId = 2 }));
    }

    private static async Task AssertBusinessErrorAsync(Func<Task> action, ErrorCodeEnum code)
    {
        var expected = Oops.Oh(code);
        var actual = await Assert.ThrowsAsync<AppFriendlyException>(action);
        Assert.Equal(expected.ErrorCode, actual.ErrorCode);
        Assert.Equal(expected.Message, actual.Message);
    }

    [Theory]
    [InlineData(false)]
    [InlineData(true)]
    public async Task RenderAsync_ClrOrExpandoModel_RendersWithOriginalEngineContract(bool useExpando)
    {
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var service = new SysTemplateService(null, provider.GetRequiredService<IViewEngine>(), null);
        object data = new { name = "服务端预览" };
        if (useExpando)
        {
            data = new System.Dynamic.ExpandoObject();
            ((IDictionary<string, object>)data)["name"] = "服务端预览";
        }
        Assert.Equal("只预览 服务端预览", await service.RenderAsync("只预览 @(name)", data));
    }

    [Fact]
    public async Task Render_HttpJsonModel_RendersWithRealEngine()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.AddClayConverters();
        var input = System.Text.Json.JsonSerializer.Deserialize<RenderTemplateInput>("""{"content":"只预览 @(name)","data":{"name":"服务端预览"}}""", options);
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var service = Service(engine: provider.GetRequiredService<IViewEngine>());
        Assert.Equal("只预览 服务端预览", await service.Render(input));
    }

    [Fact]
    public async Task ProView_HttpJsonModel_RendersSavedContentWithRealEngine()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        options.Converters.AddClayConverters();
        var input = System.Text.Json.JsonSerializer.Deserialize<ProViewTemplateInput>("""{"id":11,"data":{"name":"服务端预览"}}""", options);
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var service = Service(engine: provider.GetRequiredService<IViewEngine>());
        var saved = Stored(11, 1);
        saved.Content = "只预览 @(name)";
        service.Templates.Add(saved);
        Assert.Equal("只预览 服务端预览", await service.ProView(input));
        Assert.Equal("只预览 @(name)", saved.Content);
        Assert.Equal(0, service.Writes);
    }

    [Fact]
    public void CreateHttpRenderModel_NestedJson_PreservesOriginalKeysUnicodeNullAndValues()
    {
        var json = System.Text.Json.JsonSerializer.Deserialize<JsonElement>("""{" 原 键 ":"  雪☃<b>\r\n  ","空值":null,"nested":{"名称":"嵌套"},"items":["第一项",2,2.5,true,null],"decimal":1.234567890123456789}""");
        var original = json.GetRawText();
        var model = Assert.IsAssignableFrom<IDictionary<string, object>>(TemplateContracts.CreateHttpRenderModel(json));
        Assert.Equal(5, model.Count);
        Assert.True(model.ContainsKey(" 原 键 "));
        Assert.False(model.ContainsKey("原 键"));
        Assert.Equal("  雪☃<b>\r\n  ", model[" 原 键 "]);
        Assert.Null(model["空值"]);
        var nested = Assert.IsAssignableFrom<IDictionary<string, object>>(model["nested"]);
        Assert.Equal("嵌套", nested["名称"]);
        var items = Assert.IsType<object[]>(model["items"]);
        Assert.Equal(5, items.Length);
        Assert.Equal("第一项", items[0]);
        Assert.Equal(2L, items[1]);
        Assert.Equal(2.5m, items[2]);
        Assert.Equal(true, items[3]);
        Assert.Null(items[4]);
        Assert.Equal(1.234567890123456789m, model["decimal"]);
        Assert.Equal(original, json.GetRawText());
    }

    [Fact]
    public void CreateHttpRenderModel_ClrAndDictionary_PreservesOriginalInstances()
    {
        object clr = new { name = "原模型" };
        var dictionary = new Dictionary<string, object> { [" 原 键 "] = "Unicode 雪☃", ["empty"] = null };
        Assert.Same(clr, TemplateContracts.CreateHttpRenderModel(clr));
        Assert.Same(dictionary, TemplateContracts.CreateHttpRenderModel(dictionary));
        Assert.True(dictionary.ContainsKey(" 原 键 "));
        Assert.Null(dictionary["empty"]);
    }

    [Fact]
    public async Task Render_NestedHttpJson_RendersUnicodeArrayNumbersBooleanAndNullWithRealEngine()
    {
        var data = System.Text.Json.JsonSerializer.Deserialize<JsonElement>("""{"profile":{"name":"嵌套"},"items":[{"name":"第一项"}],"count":42,"enabled":true,"empty":null,"unicode":"雪☃"}""");
        var original = data.GetRawText();
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var service = Service(engine: provider.GetRequiredService<IViewEngine>());
        var input = new RenderTemplateInput
        {
            Content = "@(profile.name)|@(items[0].name)|@(count)|@(enabled)|@(empty)|@(unicode)",
            Data = data
        };
        Assert.Equal("嵌套|第一项|42|True||雪☃", await service.Render(input));
        Assert.Equal(original, ((JsonElement)input.Data).GetRawText());
    }

    [Fact]
    public async Task Render_DictionaryModel_RendersOriginalIndexerAndPreservesInputWithRealEngine()
    {
        var data = new Dictionary<string, object> { [" 原 键 "] = "服务端预览" };
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var service = Service(engine: provider.GetRequiredService<IViewEngine>());
        var input = new RenderTemplateInput { Content = "字典 @Model[\" 原 键 \"]", Data = data };
        Assert.Equal("字典 服务端预览", await service.Render(input));
        Assert.Same(data, input.Data);
        Assert.True(data.ContainsKey(" 原 键 "));
    }

    [Fact]
    public async Task Render_HttpJsonMissingMember_ReturnsRecoverableErrorAndRetriesWithRealEngine()
    {
        var data = System.Text.Json.JsonSerializer.Deserialize<JsonElement>("""{"other":"原值"}""");
        var original = data.GetRawText();
        using var provider = new ServiceCollection().AddViewEngine().BuildServiceProvider();
        var service = Service(engine: provider.GetRequiredService<IViewEngine>());
        var input = new RenderTemplateInput { Content = "只预览 @(name)", Data = data };
        var error = await Assert.ThrowsAsync<AppFriendlyException>(() => service.Render(input));
        Assert.Equal("模板渲染失败，请检查模板内容与渲染参数后重试", error.Message);
        Assert.Equal("只预览 @(name)", input.Content);
        Assert.Equal(original, ((JsonElement)input.Data).GetRawText());
        input.Data = System.Text.Json.JsonSerializer.Deserialize<JsonElement>("""{"name":"恢复成功"}""");
        Assert.Equal("只预览 恢复成功", await service.Render(input));
    }

    private static AddTemplateInput AddInput() => new()
    {
        Name = "模板", Code = "template-code", GroupName = "分组", Content = RawContent,
        Type = TemplateTypeEnum.Notice, OrderNo = 100, Remark = "备注"
    };

    private static UpdateTemplateInput UpdateInput(long id) => new()
    {
        Id = id, Name = "模板", Code = "template-code", GroupName = "分组", Content = RawContent,
        Type = TemplateTypeEnum.Notice, OrderNo = 100, TenantId = 1, Remark = "备注"
    };

    private static SysTemplate Stored(long id, long tenantId) => new()
    {
        Id = id, TenantId = tenantId, Name = "模板", Code = "template-code", GroupName = "分组",
        Content = RawContent, Type = TemplateTypeEnum.Notice, OrderNo = 100
    };

    private static MemoryTemplateService Service(bool superAdmin = false, long tenantId = 1, IViewEngine engine = null)
    {
        engine ??= DispatchProxy.Create<IViewEngine, ViewEngineSpy>();
        var user = new ClaimsPrincipal(new ClaimsIdentity(new[]
        {
            new Claim(ClaimConst.UserId, "101"),
            new Claim(ClaimConst.TenantId, tenantId.ToString()),
            new Claim(ClaimConst.AccountType, superAdmin ? "999" : "777")
        }, "template-test"));
        var manager = new UserManager(new HttpContextAccessor { HttpContext = new DefaultHttpContext { User = user } });
        return new MemoryTemplateService(engine, manager, superAdmin);
    }

    private static SqlSugarClient SqlOnlyDatabase() => new(new ConnectionConfig
    {
        DbType = DbType.PostgreSQL, InitKeyType = InitKeyType.Attribute, IsAutoCloseConnection = true,
        // 仅派生 SQL，不打开连接，不依赖 SQLite 或真实 PostgreSQL 进程。
        ConnectionString = "Host=127.0.0.1;Port=1;Database=template_contract_sql_only;Username=sql_only;Password=unused"
    });

    private static string NormalizeSql(string value) => string.Concat(value.ToLowerInvariant().Where(char.IsLetterOrDigit));

    private sealed class MemoryTemplateService : SysTemplateService
    {
        private readonly bool _superAdmin;
        public List<SysTemplate> Templates { get; } = new();
        public ViewEngineSpy Engine { get; }
        public int Reads { get; private set; }
        public int GlobalCodeChecks { get; private set; }
        public int WriteAttempts { get; private set; }
        public int Writes { get; private set; }
        public bool FailNextWrite { get; set; }
        public SysTemplate LastWrite { get; private set; }

        public MemoryTemplateService(IViewEngine engine, UserManager manager, bool superAdmin) : base(null, engine, manager)
        {
            Engine = engine as ViewEngineSpy;
            _superAdmin = superAdmin;
        }

        protected override Task<SysTemplate> FindTemplateAsync(Expression<Func<SysTemplate, bool>> predicate)
        {
            Reads++;
            return Task.FromResult(Templates.FirstOrDefault(predicate.Compile()));
        }

        protected override Task<bool> TemplateExistsAsync(Expression<Func<SysTemplate, bool>> predicate, bool globalCode)
        {
            Reads++;
            if (globalCode) GlobalCodeChecks++;
            var visible = globalCode || _superAdmin ? Templates : Templates.Where(template => template.TenantId == 1);
            return Task.FromResult(visible.Any(predicate.Compile()));
        }

        protected override Task InsertTemplateAsync(SysTemplate template)
        {
            BeforeWrite();
            template.Id = Templates.Select(item => item.Id).DefaultIfEmpty().Max() + 1;
            Templates.Add(template);
            LastWrite = template;
            Writes++;
            return Task.CompletedTask;
        }

        protected override Task UpdateTemplateAsync(SysTemplate template)
        {
            BeforeWrite();
            var saved = Templates.Single(item => item.Id == template.Id && item.TenantId == template.TenantId);
            saved.Name = template.Name;
            saved.Code = template.Code;
            saved.GroupName = template.GroupName;
            saved.Content = template.Content;
            saved.Type = template.Type;
            saved.OrderNo = template.OrderNo;
            saved.Remark = template.Remark;
            LastWrite = template;
            Writes++;
            return Task.CompletedTask;
        }

        protected override Task DeleteTemplateAsync(SysTemplate template)
        {
            BeforeWrite();
            Templates.RemoveAll(item => item.Id == template.Id && item.TenantId == template.TenantId);
            LastWrite = template;
            Writes++;
            return Task.CompletedTask;
        }

        private void BeforeWrite()
        {
            WriteAttempts++;
            if (!FailNextWrite) return;
            FailNextWrite = false;
            throw new InvalidOperationException("模拟写入失败");
        }
    }

    public class ViewEngineSpy : DispatchProxy
    {
        public int Calls { get; private set; }
        public string CompiledContent { get; private set; }
        public object Data { get; private set; }
        public bool FailNext { get; set; }
        public CompileOptionsSpy Options { get; private set; }

        protected override object Invoke(MethodInfo targetMethod, object[] args)
        {
            if (targetMethod.Name != nameof(IViewEngine.RunCompileFromCachedAsync))
                throw new InvalidOperationException($"不应调用其他引擎方法：{targetMethod.Name}");
            Calls++;
            CompiledContent = (string)args[0];
            Data = args[1];
            var options = DispatchProxy.Create<IViewEngineCompileOptions, CompileOptionsSpy>();
            Options = (CompileOptionsSpy)options;
            args.OfType<Action<IViewEngineCompileOptions>>().Single()(options);
            if (!FailNext) return Task.FromResult("引擎返回值");
            FailNext = false;
            return Task.FromException<string>(new InvalidOperationException("模拟编译失败"));
        }
    }

    public class CompileOptionsSpy : DispatchProxy
    {
        public List<string> Assemblies { get; } = new();
        public List<string> Usings { get; } = new();

        protected override object Invoke(MethodInfo targetMethod, object[] args)
        {
            // 兼容编译 options 接口的单个 string 与 params string[] 参数，仍精确核对引用和 using。
            var values = args.SelectMany(argument => argument switch
            {
                string value => new[] { value },
                string[] items => items,
                _ => throw new InvalidOperationException("编译 options 参数类型不符合既有合同")
            });
            if (targetMethod.Name == "AddAssemblyReferenceByName") Assemblies.AddRange(values);
            else if (targetMethod.Name == "AddUsing") Usings.AddRange(values);
            else throw new InvalidOperationException($"不应添加其他编译能力：{targetMethod.Name}");
            return targetMethod.ReturnType.IsInstanceOfType(this) ? this : null;
        }
    }
}
