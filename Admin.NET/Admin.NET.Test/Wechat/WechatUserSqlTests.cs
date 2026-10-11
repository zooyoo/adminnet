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

namespace Admin.NET.Test.Wechat;

public class WechatUserSqlTests
{
    [Fact]
    public void UpdateQuery_PostgreSql_PreservesCredentialsAndIncludesBothOwners()
    {
        using SqlSugarClient db = new(new ConnectionConfig { DbType = DbType.PostgreSQL, ConnectionString = "Host=127.0.0.1;Database=sql_only;Username=unused", IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute });
        SysWechatUser entity = new() { Id = 11, UserId = 22, OpenId = "fixture", City = null, SessionKey = "must-not-write", AccessToken = "must-not-write", RefreshToken = "must-not-write" };
        var command = WechatUserContracts.UpdateQuery(db.Updateable(entity), 11, 21, 22, false, 17).ToSql();
        string[] parts = command.Key.ToLowerInvariant().Split("where", 2);
        string set = parts[0].Split("set", 2)[1];
        foreach (string excluded in new[] { "sessionkey", "accesstoken", "refreshtoken", "expiresin", "scope", "createuserid", "createtime" })
            Assert.DoesNotContain(excluded, set);
        Assert.Contains("city", set);
        Assert.Contains("updatetime", set);
        Assert.Contains(command.Value, parameter => parameter.ParameterName.Contains("City", StringComparison.OrdinalIgnoreCase) && (parameter.Value == null || parameter.Value == DBNull.Value));
        Assert.Equal(2, Regex.Matches(parts[1], "exists", RegexOptions.IgnoreCase).Count);
        Assert.Contains("tenantid", parts[1]);
        foreach (long value in new[] { 11L, 21L, 22L, 17L })
            Assert.Contains(command.Value, parameter => parameter.Value?.ToString() == value.ToString());
        Assert.DoesNotContain(command.Value, parameter => parameter.Value?.ToString() == "must-not-write");
    }

    [Theory]
    [InlineData(0, 17)]
    [InlineData(22, 0)]
    public void UpdateQuery_OrdinaryUserWithInvalidOwner_Rejects(long target, long tenant)
    {
        using SqlSugarClient db = new(new ConnectionConfig { DbType = DbType.PostgreSQL, ConnectionString = "Host=127.0.0.1;Database=sql_only;Username=unused", InitKeyType = InitKeyType.Attribute });
        Assert.ThrowsAny<Exception>(() => WechatUserContracts.UpdateQuery(db.Updateable(new SysWechatUser()), 11, 21, target, false, tenant));
    }
}
