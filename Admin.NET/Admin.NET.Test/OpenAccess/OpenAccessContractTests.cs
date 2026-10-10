// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core;
using Admin.NET.Core.Service;
using System.ComponentModel.DataAnnotations;
using System.Reflection;
using Xunit;

namespace Admin.NET.Test.OpenAccess;

public class OpenAccessContractTests
{
    [Fact]
    public void AddAndUpdateInput_WritableProperties_ExcludeNavigationAndAuditFields()
    {
        string[] expected = ["AccessKey", "AccessSecret", "BindTenantId", "BindUserId", "Id"];
        foreach (var type in new[] { typeof(AddOpenAccessInput), typeof(UpdateOpenAccessInput) })
        {
            Assert.False(typeof(SysOpenAccess).IsAssignableFrom(type));
            Assert.Equal(expected, type.GetProperties(BindingFlags.Instance | BindingFlags.Public).Select(p => p.Name).OrderBy(n => n).ToArray());
        }
    }

    [Fact]
    public void CandidateOutput_Contract_ContainsOnlyDisplayAndBindingFields()
    {
        Assert.Equal(new[] { "Id", "Name" }, typeof(OpenAccessTenantOutput).GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray());
        Assert.Equal(new[] { "Account", "Id", "RealName", "TenantId" }, typeof(OpenAccessUserOutput).GetProperties().Select(p => p.Name).OrderBy(n => n).ToArray());
    }

    [Fact]
    public void InputValidation_InvalidBindingOrOversizedCredential_Rejects()
    {
        var valid = new AddOpenAccessInput { AccessKey = "key", AccessSecret = " secret ", BindTenantId = 12, BindUserId = 34 };
        Assert.True(IsValid(valid));
        valid.BindTenantId = 0;
        Assert.False(IsValid(valid));
        valid.BindTenantId = 12;
        valid.BindUserId = 0;
        Assert.False(IsValid(valid));
        valid.BindUserId = 34;
        valid.AccessKey = new string('k', 129);
        Assert.False(IsValid(valid));
        valid.AccessKey = "key";
        valid.AccessSecret = new string('s', 257);
        Assert.False(IsValid(valid));
        Assert.False(IsValid(new UpdateOpenAccessInput { Id = 0, AccessKey = "key", AccessSecret = "secret", BindTenantId = 12, BindUserId = 34 }));
        Assert.False(IsValid(new OpenAccessUserListInput { TenantId = 0 }));
    }

    [Theory]
    [InlineData(HttpMethodEnum.Get, 0, "GET")]
    [InlineData(HttpMethodEnum.Post, 1, "POST")]
    [InlineData(HttpMethodEnum.Put, 2, "PUT")]
    [InlineData(HttpMethodEnum.Delete, 3, "DELETE")]
    [InlineData(HttpMethodEnum.Patch, 4, "PATCH")]
    [InlineData(HttpMethodEnum.Head, 5, "HEAD")]
    [InlineData(HttpMethodEnum.Options, 6, "OPTIONS")]
    [InlineData(HttpMethodEnum.Trace, 7, "TRACE")]
    [InlineData(HttpMethodEnum.Connect, 8, "CONNECT")]
    public void GenerateSignature_LegacyEnumValue_KeepsNineMethods(HttpMethodEnum method, int numericValue, string methodName)
    {
        Assert.Equal(numericValue, (int)method);
        var service = new SysOpenAccessService(null, null, null);
        var input = new GenerateSignatureInput
        {
            Method = method, Url = "/api/demo/identity", AccessKey = "key", AccessSecret = " secret ", Timestamp = 1770000000, Nonce = "nonce"
        };
        Assert.Equal(SignatureProtocol.GenerateSignature(methodName, input.Url, input.AccessKey, input.AccessSecret, "1770000000", input.Nonce),
            service.GenerateSignature(input));
    }

    [Fact]
    public async Task CreateSecret_LegacyContract_ReturnsUnpadded22CharacterGuidBase64()
    {
        var service = new SysOpenAccessService(null, null, null);
        var secret = await service.CreateSecret();
        Assert.Equal(22, secret.Length);
        Assert.DoesNotContain("=", secret);
        Assert.Equal(16, Convert.FromBase64String(secret + "==").Length);
    }

    [Theory]
    [InlineData(nameof(SysOpenAccessService.Page))]
    [InlineData(nameof(SysOpenAccessService.AddOpenAccess))]
    [InlineData(nameof(SysOpenAccessService.UpdateOpenAccess))]
    [InlineData(nameof(SysOpenAccessService.DeleteOpenAccess))]
    [InlineData(nameof(SysOpenAccessService.CreateSecret))]
    [InlineData(nameof(SysOpenAccessService.GenerateSignature))]
    [InlineData(nameof(SysOpenAccessService.TenantList))]
    [InlineData(nameof(SysOpenAccessService.UserList))]
    public void SensitiveAction_MonitorMetadata_SuppressesCredentialLogging(string action)
    {
        var method = typeof(SysOpenAccessService).GetMethod(action);
        Assert.NotNull(method);
        Assert.Contains(method.GetCustomAttributes(true), attribute => attribute.GetType().Name == "SuppressMonitorAttribute");
    }

    private static bool IsValid(object input)
    {
        return Validator.TryValidateObject(input, new ValidationContext(input), new List<ValidationResult>(), true);
    }
}
