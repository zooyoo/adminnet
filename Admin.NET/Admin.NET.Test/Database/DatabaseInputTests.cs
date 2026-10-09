// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core.Service;
using System.Reflection;
using Xunit;

namespace Admin.NET.Test.Database;

public class DatabaseInputTests
{
    [Theory]
    [InlineData("Sample", true)]
    [InlineData("sample_name", true)]
    [InlineData("name;DROP TABLE Sample", false)]
    [InlineData("name`", false)]
    [InlineData("1name", false)]
    [InlineData("", false)]
    public void ValidateIdentifier_Input_RejectsUnsafeName(string value, bool valid)
    {
        MethodInfo method = typeof(SysDatabaseService).GetMethod("ValidateIdentifier", BindingFlags.NonPublic | BindingFlags.Static)!;
        Exception error = Record.Exception(() => method.Invoke(null, [value]));
        Assert.Equal(valid, error == null);
    }

    [Theory]
    [InlineData("'O''Brien'", true)]
    [InlineData("1.25", true)]
    [InlineData("CURRENT_TIMESTAMP", true)]
    [InlineData("now()", true)]
    [InlineData("NULL", true)]
    [InlineData("", true)]
    [InlineData("0;DROP TABLE Sample", false)]
    [InlineData("(SELECT password FROM SysUser)", false)]
    public void ValidateDefault_Input_RejectsSqlStatements(string value, bool valid)
    {
        MethodInfo method = typeof(SysDatabaseService).GetMethod("ValidateDefault", BindingFlags.NonPublic | BindingFlags.Static)!;
        Exception error = Record.Exception(() => method.Invoke(null, [value]));
        Assert.Equal(valid, error == null);
    }
}
