// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 模板输入、租户边界与持久化字段合同。
/// </summary>
public static class TemplateContracts
{
    public static void ValidatePage(PageTemplateInput input)
    {
        if (input == null) throw Oops.Oh("模板查询参数不能为空");
        if (input.Page < 1 || input.PageSize < 1) throw Oops.Oh("分页参数必须大于零");
        ValidateLength(input.Name, 128, "名称");
        ValidateLength(input.Code, 128, "编码");
        ValidateLength(input.GroupName, 32, "分组名称");
        if (input.Type.HasValue) ValidateType(input.Type.Value);
        if (input.TenantId < 0) throw Oops.Oh("租户Id无效");
    }

    public static void ValidateTemplate(AddTemplateInput input)
    {
        if (input == null) throw Oops.Oh("模板参数不能为空");
        ValidateRequired(input.Name, "名称");
        ValidateRequired(input.Code, "编码");
        ValidateRequired(input.GroupName, "分组名称");
        ValidateRequired(input.Content, "模板内容");
        ValidateLength(input.Name, 128, "名称");
        ValidateLength(input.Code, 128, "编码");
        ValidateLength(input.GroupName, 32, "分组名称");
        ValidateLength(input.Remark, 128, "备注");
        ValidateType(input.Type);
    }

    public static void ValidateRender(string content, object data)
    {
        ValidateRequired(content, "模板内容");
        ValidateData(data);
    }

    public static void ValidateData(object data)
    {
        if (data == null) throw Oops.Oh("渲染参数不能为空");
    }

    /// <summary>
    /// 仅将 HTTP 绑定的 JSON 数据树适配为动态模型，既有 CLR 模型原样传递。
    /// </summary>
    public static object CreateHttpRenderModel(object data)
    {
        return data is System.Text.Json.JsonElement element ? ReadJsonRenderValue(element) : data;
    }

    private static object ReadJsonRenderValue(System.Text.Json.JsonElement element)
    {
        switch (element.ValueKind)
        {
            case System.Text.Json.JsonValueKind.Object:
                var model = new System.Dynamic.ExpandoObject();
                var properties = (IDictionary<string, object>)model;
                foreach (var property in element.EnumerateObject())
                    properties[property.Name] = ReadJsonRenderValue(property.Value);
                return model;
            case System.Text.Json.JsonValueKind.Array:
                return element.EnumerateArray().Select(ReadJsonRenderValue).ToArray();
            case System.Text.Json.JsonValueKind.String:
                return element.GetString();
            case System.Text.Json.JsonValueKind.Number:
                if (element.TryGetInt64(out var integer)) return integer;
                if (element.TryGetDecimal(out var number)) return number;
                return element.GetDouble();
            case System.Text.Json.JsonValueKind.True:
                return true;
            case System.Text.Json.JsonValueKind.False:
                return false;
            default:
                return null;
        }
    }

    public static void ValidateId(long id)
    {
        if (id <= 0) throw Oops.Oh(ErrorCodeEnum.D1012);
    }

    public static void ValidateLookup(string code)
    {
        ValidateRequired(code, "模板名称");
        ValidateLength(code, 128, "模板名称");
    }

    public static void EnsureTenant(bool superAdmin, long tenantId)
    {
        if (!superAdmin && tenantId <= 0) throw Oops.Oh(ErrorCodeEnum.D1016);
    }

    public static void EnsureSuppliedTenant(long? suppliedTenantId, bool superAdmin, long tenantId)
    {
        EnsureTenant(superAdmin, tenantId);
        if (suppliedTenantId < 0) throw Oops.Oh("租户Id无效");
        if (!superAdmin && suppliedTenantId > 0 && suppliedTenantId != tenantId)
            throw Oops.Oh(ErrorCodeEnum.D1016);
    }

    public static SysTemplate RequireAccessible(SysTemplate template, bool superAdmin, long tenantId)
    {
        EnsureTenant(superAdmin, tenantId);
        // 越租户与不存在使用同一业务错误，避免泄露其他租户的模板。
        if (template == null || (!superAdmin && template.TenantId != tenantId))
            throw Oops.Oh(ErrorCodeEnum.D1002);
        return template;
    }

    public static ISugarQueryable<SysTemplate> ScopeQuery(ISugarQueryable<SysTemplate> query, bool superAdmin, long tenantId)
    {
        EnsureTenant(superAdmin, tenantId);
        return query.WhereIF(!superAdmin, template => template.TenantId == tenantId);
    }

    public static ISugarQueryable<SysTemplate> PageQuery(ISugarQueryable<SysTemplate> query, PageTemplateInput input, bool superAdmin, long tenantId)
    {
        return ScopeQuery(query, superAdmin, tenantId)
            .WhereIF(!string.IsNullOrWhiteSpace(input.GroupName), template => template.GroupName.Contains(input.GroupName))
            .WhereIF(superAdmin && input.TenantId > 0, template => template.TenantId == input.TenantId)
            .WhereIF(!string.IsNullOrWhiteSpace(input.Name), template => template.Name.Contains(input.Name))
            .WhereIF(!string.IsNullOrWhiteSpace(input.Code), template => template.Code.Contains(input.Code))
            .WhereIF(input.Type.HasValue, template => template.Type == input.Type)
            .OrderBy(template => new { template.OrderNo, template.Id });
    }

    public static Expression<Func<SysTemplate, bool>> IdPredicate(long id, bool superAdmin, long tenantId)
    {
        return template => template.Id == id && (superAdmin || template.TenantId == tenantId);
    }

    public static Expression<Func<SysTemplate, bool>> LegacyNamePredicate(string code, bool superAdmin, long tenantId)
    {
        // 历史 template/{code} 接口按 Name 读取，不能在本次迁移中改成 Code。
        return template => template.Name == code && (superAdmin || template.TenantId == tenantId);
    }

    public static Expression<Func<SysTemplate, bool>> NameDuplicatePredicate(string name, long excludeId, bool superAdmin, long tenantId)
    {
        return template => template.Name == name && template.Id != excludeId && (superAdmin || template.TenantId == tenantId);
    }

    public static Expression<Func<SysTemplate, bool>> CodeDuplicatePredicate(string code, long excludeId)
    {
        // Code 的唯一索引为全局索引，不能只在当前租户内检查。
        return template => template.Code == code && template.Id != excludeId;
    }

    public static SysTemplate CreateEntity(AddTemplateInput input, bool superAdmin, long tenantId)
    {
        return new SysTemplate
        {
            Name = input.Name,
            Code = input.Code,
            GroupName = input.GroupName,
            Content = input.Content,
            Type = input.Type,
            OrderNo = input.OrderNo,
            Remark = input.Remark,
            TenantId = superAdmin && input.TenantId > 0 ? input.TenantId : tenantId
        };
    }

    public static SysTemplate UpdateEntity(SysTemplate existing, UpdateTemplateInput input)
    {
        return new SysTemplate
        {
            Id = existing.Id,
            TenantId = existing.TenantId,
            Name = input.Name,
            Code = input.Code,
            GroupName = input.GroupName,
            Content = input.Content,
            Type = input.Type,
            OrderNo = input.OrderNo,
            Remark = input.Remark
        };
    }

    public static IUpdateable<SysTemplate> UpdateQuery(IUpdateable<SysTemplate> update, long id, long? tenantId)
    {
        ValidateId(id);
        // 仅修改模板业务字段和由既有审计 AOP 赋值的更新字段；null 备注也可清空。
        return update.UpdateColumns(template => new
        {
            template.Name,
            template.Code,
            template.GroupName,
            template.Content,
            template.Type,
            template.OrderNo,
            template.Remark,
            template.UpdateTime,
            template.UpdateUserId,
            template.UpdateUserName
        }).Where(template => template.Id == id && template.TenantId == tenantId);
    }

    public static async Task ExecuteMutationAsync(Func<Task> mutation)
    {
        try
        {
            await mutation();
        }
        catch (AppFriendlyException)
        {
            throw;
        }
        catch (Exception exception) when (exception is not OperationCanceledException)
        {
            throw Oops.Oh("模板保存失败，请稍后重试");
        }
    }

    private static void ValidateType(TemplateTypeEnum type)
    {
        if (!Enum.IsDefined(type)) throw Oops.Oh("模板类型无效");
    }

    private static void ValidateRequired(string value, string name)
    {
        if (string.IsNullOrWhiteSpace(value)) throw Oops.Oh($"{name}不能为空");
    }

    private static void ValidateLength(string value, int maxLength, string name)
    {
        if (value?.Length > maxLength) throw Oops.Oh($"{name}长度不能超过{maxLength}个字符");
    }
}
