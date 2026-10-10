// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using SqlSugar;
using Xunit;

namespace Admin.NET.Test.Region;

public class RegionQueryTests
{
    [Fact]
    public void OrderByPosition_PostgreSqlQuery_OrdersByOrderNoThenIdAscendingWithoutExecuting()
    {
        using var db = CreateSqlGenerator();
        var sql = RegionContracts.OrderByPosition(db.Queryable<SysRegion>()).ToSql().Key;

        Assert.Matches(@"(?is)ORDER BY\s+""OrderNo""(?:\s+ASC)?\s*,\s*""Id""(?:\s+ASC)?\s*;?\s*$", sql);
    }

    [Fact]
    public void OrderByPosition_FilteredChildQuery_RetainsParentPredicate()
    {
        using var db = CreateSqlGenerator();
        const long parentId = 9007199254740993L;
        var result = RegionContracts.OrderByPosition(db.Queryable<SysRegion>().Where(region => region.Pid == parentId)).ToSql();

        Assert.Contains("WHERE", result.Key, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("Pid", result.Key, StringComparison.OrdinalIgnoreCase);
        Assert.Contains(result.Value, parameter => Convert.ToInt64(parameter.Value) == parentId);
        Assert.Matches(@"(?is)ORDER BY\s+""OrderNo""(?:\s+ASC)?\s*,\s*""Id""(?:\s+ASC)?\s*;?\s*$", result.Key);
    }

    private static SqlSugarClient CreateSqlGenerator()
    {
        // 只生成 PostgreSQL SQL，不建立数据库连接或使用替代数据库。
        var db = new SqlSugarClient(new ConnectionConfig
        {
            DbType = DbType.PostgreSQL,
            ConnectionString = "Host=unused;Database=unused;Username=unused;Password=unused",
            IsAutoCloseConnection = true,
            InitKeyType = InitKeyType.Attribute
        });
        db.Aop.OnLogExecuting = (_, _) => throw new InvalidOperationException("SQL 合同测试不得执行数据库命令");
        return db;
    }
}
