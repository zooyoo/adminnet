// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using SqlSugar;
using System.Reflection;
using Xunit;

namespace Admin.NET.Test.Schedule;

[Collection("ScheduleDatabase")]
public class JobRecordTests
{
    [Fact]
    public void ClearJobTriggerRecord_SqliteWithoutSequence_RemovesAllRecords()
    {
        ITenant previous = SqlSugarSetup.ITenant;
        string file = Path.Combine(AppContext.BaseDirectory, $"adminnet-job-record-{Guid.NewGuid():N}.db");
        using SqlSugarScope db = new(new ConnectionConfig
        {
            ConfigId = SqlSugarConst.MainConfigId, DbType = DbType.Sqlite,
            ConnectionString = $"Data Source={file}", IsAutoCloseConnection = true, InitKeyType = InitKeyType.Attribute,
            ConfigureExternalServices = new ConfigureExternalServices
            {
                EntityService = (property, column) =>
                {
                    if (new NullabilityInfoContext().Create(property).WriteState == NullabilityState.Nullable) column.IsNullable = true;
                }
            }
        });
        SqlSugarSetup.ITenant = db;
        try
        {
            // 准备：雪花主键表不创建 sqlite_sequence。
            db.CodeFirst.InitTables<SysJobTriggerRecord>();
            db.Insertable(new SysJobTriggerRecord { Id = 21, JobId = "isolated", TriggerId = "isolated-trigger" }).ExecuteCommand();
            Assert.False(db.DbMaintenance.IsAnyTable("sqlite_sequence", false));
            SysJobService service = new(null, null, new SqlSugarRepository<SysJobTriggerRecord>(), null, null, null);

            service.ClearJobTriggerRecord();

            Assert.Empty(db.Queryable<SysJobTriggerRecord>().ToList());
        }
        finally
        {
            SqlSugarSetup.ITenant = previous;
            db.Dispose();
            Microsoft.Data.Sqlite.SqliteConnection.ClearAllPools();
            if (File.Exists(file)) File.Delete(file);
        }
    }
}
