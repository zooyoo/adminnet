// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using SqlSugar;
using System.Text.RegularExpressions;
using Xunit;

namespace Admin.NET.Test.Plugin;

public class PluginContractTests
{
    private static AddPluginInput Input() => new() { Name = "插件", CsharpCode = "  // 保留代码原文\r\npublic class Probe {}\r\n", Status = StatusEnum.Enable, TenantId = 1 };

    [Theory]
    [InlineData(null, true, 1, false)]
    [InlineData(null, false, 1, false)]
    [InlineData(0L, true, 1, false)]
    [InlineData(2L, false, 1, false)]
    [InlineData(1L, false, 0, false)]
    [InlineData(1L, false, 1, true)]
    [InlineData(2L, true, 1, true)]
    public void EnsureRemovalOwner_HostOrForeignAssembly_RejectsUnownedTarget(long? owner, bool superAdmin, long tenant, bool allowed)
    {
        if (allowed) PluginContracts.EnsureRemovalOwner(owner, superAdmin, tenant);
        else Assert.ThrowsAny<Exception>(() => PluginContracts.EnsureRemovalOwner(owner, superAdmin, tenant));
    }

    [Fact]
    public void CreateEntity_ForgedIdentityAndAudit_UsesAllowedFieldsOnly()
    {
        AddPluginInput input = Input();
        input.Id = 123;
        input.CreateUserId = 999;
        input.UpdateUserName = "伪造";
        input.Name = "  插件  ";
        SysPlugin plugin = PluginContracts.CreateEntity(input, false, 1);
        Assert.Equal(0, plugin.Id);
        Assert.Null(plugin.CreateUserId);
        Assert.Null(plugin.UpdateUserName);
        Assert.Equal("插件", plugin.Name);
        Assert.Equal(input.CsharpCode, plugin.CsharpCode);
        Assert.Equal(1L, plugin.TenantId);
    }

    [Theory]
    [InlineData("name")]
    [InlineData("code")]
    [InlineData("nameLength")]
    [InlineData("assemblyLength")]
    [InlineData("remarkLength")]
    [InlineData("status")]
    public void Validate_InvalidInput_RejectsBeforeCompilation(string field)
    {
        AddPluginInput input = Input();
        switch (field)
        {
            case "name": input.Name = " "; break;
            case "code": input.CsharpCode = " \n "; break;
            case "nameLength": input.Name = new string('a', 65); break;
            case "assemblyLength": input.AssemblyName = new string('a', 513); break;
            case "remarkLength": input.Remark = new string('a', 129); break;
            case "status": input.Status = (StatusEnum)99; break;
        }
        Assert.ThrowsAny<Exception>(() => PluginContracts.Validate(input));
    }

    [Fact]
    public void CreateEntity_ForeignTenant_RejectsOrdinaryUser()
    {
        AddPluginInput input = Input();
        input.TenantId = 2;
        Assert.ThrowsAny<Exception>(() => PluginContracts.CreateEntity(input, false, 1));
        Assert.Equal(2L, PluginContracts.CreateEntity(input, true, 1).TenantId);
    }

    [Fact]
    public void UpdateEntity_TenantMove_RejectsAndPreservesStoredRecord()
    {
        SysPlugin current = new() { Id = 11, TenantId = 1, Name = "原名称", CsharpCode = "原代码" };
        UpdatePluginInput input = new() { Id = 11, TenantId = 2, Name = "新名称", CsharpCode = "新代码" };
        Assert.ThrowsAny<Exception>(() => PluginContracts.UpdateEntity(current, input));
        Assert.Equal("原代码", current.CsharpCode);
        input.TenantId = null;
        input.Remark = null;
        SysPlugin update = PluginContracts.UpdateEntity(current, input);
        Assert.Equal(1L, update.TenantId);
        Assert.Null(update.Remark);
    }

    [Fact]
    public void RequireAccessible_MissingOrForeignRecord_Rejects()
    {
        Assert.ThrowsAny<Exception>(() => PluginContracts.RequireAccessible(null, false, 1));
        Assert.ThrowsAny<Exception>(() => PluginContracts.RequireAccessible(new SysPlugin { TenantId = 2 }, false, 1));
    }

    [Fact]
    public void UpdateQuery_PostgreSql_RestrictsIdOwnerAndColumns()
    {
        using SqlSugarClient db = new(new ConnectionConfig { DbType = DbType.PostgreSQL, ConnectionString = "Host=127.0.0.1;Database=sql_only;Username=unused", IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute });
        SysPlugin update = new() { Id = 11, TenantId = 2, Name = "名称", CsharpCode = "代码", Remark = null };
        KeyValuePair<string, List<SugarParameter>> command = PluginContracts.UpdateQuery(db.Updateable(update), update.Id, update.TenantId).ToSql();
        string[] parts = command.Key.ToLowerInvariant().Split("where", 2);
        string set = parts[0].Split("set", 2)[1];
        Assert.Contains("remark", set);
        Assert.Contains("csharpcode", set);
        Assert.DoesNotContain("tenantid", set);
        Assert.DoesNotContain("createuserid", set);
        Assert.Contains("updatetime", set);
        foreach ((string column, long expected) in new[] { ("id", 11L), ("tenantid", 2L) })
        {
            Match match = Regex.Match(parts[1], $"\"{column}\"\\s*=\\s*(?<parameter>@[a-z0-9_]+)");
            Assert.True(match.Success, command.Key);
            SugarParameter parameter = Assert.Single(command.Value.Where(value => value.ParameterName.Equals(match.Groups["parameter"].Value, StringComparison.OrdinalIgnoreCase)));
            Assert.Equal(expected, Convert.ToInt64(parameter.Value));
        }
    }

    [Fact]
    public void ScopeQuery_PostgreSql_IncludesOrdinaryTenant()
    {
        using SqlSugarClient db = new(new ConnectionConfig { DbType = DbType.PostgreSQL, ConnectionString = "Host=127.0.0.1;Database=sql_only;Username=unused", IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute });
        var command = PluginContracts.ScopeQuery(db.Queryable<SysPlugin>(), false, 17).ToSql();
        Assert.Contains("tenantid", command.Key.ToLowerInvariant());
        Assert.Contains(command.Value, parameter => parameter.Value?.ToString() == "17");
    }
}
