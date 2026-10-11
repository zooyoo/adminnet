// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>微信管理资料及归属约束，不修改认证凭据。</summary>
public static class WechatUserContracts
{
    public static void Validate(WechatUserProfileInput input)
    {
        if (input == null) throw Oops.Oh("微信用户资料不能为空");
        Validator.ValidateObject(input, new ValidationContext(input), true);
        if (!Enum.IsDefined(input.PlatformType)) throw Oops.Oh("平台类型无效");
        if (string.IsNullOrWhiteSpace(input.OpenId)) throw Oops.Oh("OpenId 不能为空");
        if (!string.IsNullOrEmpty(input.Avatar) &&
            !(input.Avatar.StartsWith('/') && !input.Avatar.StartsWith("//") && !input.Avatar.Contains('\\')) &&
            !(Uri.TryCreate(input.Avatar, UriKind.Absolute, out var uri) &&
                (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps)))
            throw Oops.Oh("头像必须为 HTTP、HTTPS 或站内绝对路径");
    }

    public static void RequireAccessible(bool superAdmin, long currentTenantId, long? ownerTenantId)
    {
        if (!superAdmin && (currentTenantId <= 0 || ownerTenantId != currentTenantId))
            throw Oops.Oh("微信用户不存在或无权访问");
    }

    /// <summary>更新仅包含资料列，并在同一 SQL 中限定旧归属与目标归属。</summary>
    public static IUpdateable<SysWechatUser> UpdateQuery(IUpdateable<SysWechatUser> query, long id, long originalUserId, long targetUserId, bool superAdmin, long tenantId)
    {
        if (id <= 0 || targetUserId < 0 || !superAdmin && (tenantId <= 0 || targetUserId == 0)) throw Oops.Oh("微信用户归属无效");
        query = query.UpdateColumns(row => new { row.UserId, row.PlatformType, row.OpenId, row.UnionId, row.NickName, row.Avatar, row.Mobile, row.Sex, row.Language, row.City, row.Province, row.Country, row.UpdateTime, row.UpdateUserId, row.UpdateUserName })
            .Where(row => row.Id == id && row.UserId == originalUserId);
        if (!superAdmin)
            query = query.Where(row => SqlFunc.Subqueryable<SysUser>().Where(user => user.Id == row.UserId && user.TenantId == tenantId).Any());
        if (targetUserId > 0)
            query = query.Where(row => SqlFunc.Subqueryable<SysUser>().Where(user => user.Id == targetUserId && (superAdmin || user.TenantId == tenantId)).Any());
        return query;
    }

    /// <summary>仅拷贝管理字段，已有凭据和审计字段原样保留。</summary>
    public static void Apply(WechatUserProfileInput input, SysWechatUser entity)
    {
        Validate(input);
        entity.UserId = input.UserId;
        entity.PlatformType = input.PlatformType;
        entity.OpenId = input.OpenId;
        entity.UnionId = input.UnionId;
        entity.NickName = input.NickName;
        entity.Avatar = input.Avatar;
        entity.Mobile = input.Mobile;
        entity.Sex = input.Sex;
        entity.Language = input.Language;
        entity.City = input.City;
        entity.Province = input.Province;
        entity.Country = input.Country;
    }
}
