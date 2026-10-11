// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Microsoft.AspNetCore.Routing;
using Microsoft.AspNetCore.Routing.Patterns;

namespace Admin.NET.Core;

public static class RoutePermissionUtil
{
    /// <summary>
    /// 翻译文件、批量写入与付费服务不能因旧菜单未登记按钮而默认放行。
    /// </summary>
    public static bool RequiresExplicitGrant(string permission)
    {
        return string.Equals(permission, "sysCommon:stressTest", StringComparison.OrdinalIgnoreCase) ||
            permission?.StartsWith("sysJob:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysServer:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysUpdate:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysVislog:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysOplog:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysExlog:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysDifflog:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysLog", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysOpenAccess:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysTemplate:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.StartsWith("sysPlugin:", StringComparison.OrdinalIgnoreCase) == true ||
            permission?.ToLowerInvariant() is "sysregion:page" or "sysregion:add" or "sysregion:update" or "sysregion:delete" or "sysregion:sync" ||
            permission?.StartsWith("sysDatabase:", StringComparison.OrdinalIgnoreCase) == true || permission?.ToLowerInvariant() is "syslangtext:export" or "syslangtext:import" or
            "syslangtext:batchdelete" or "syslangtext:batchsave" or "syslangtext:aitranslatetext" or "sysconfig:savesysinfo" or
            "sysfile:page" or "sysfile:uploadfile" or "sysfile:downloadfile" or "sysfile:update" or "sysfile:delete";
    }

    /// <summary>
    /// 候选与密钥生成复用新增或更新按钮，仅对指定的开放接口操作生效
    /// </summary>
    public static bool HasPermission(string permission, IEnumerable<string> ownGrants)
    {
        if (string.IsNullOrWhiteSpace(permission) || ownGrants == null) return false;
        var grants = ownGrants.ToArray();
        if (grants.Any(grant => string.Equals(permission, grant, StringComparison.CurrentCultureIgnoreCase))) return true;
        var needsWriteGrant = permission.ToLowerInvariant() is "sysopenaccess:secret" or
            "sysopenaccess:tenantlist" or "sysopenaccess:userlist";
        return needsWriteGrant && grants.Any(grant =>
            string.Equals(grant, "sysOpenAccess:add", StringComparison.CurrentCultureIgnoreCase) ||
            string.Equals(grant, "sysOpenAccess:update", StringComparison.CurrentCultureIgnoreCase));
    }

    public static string GetPermissionName(HttpContext context)
    {
        // 使用已匹配的路由模板，防止路径参数被误认为权限名的一部分。
        string path = context.GetEndpoint() is RouteEndpoint endpoint
            ? "/" + string.Join("/", endpoint.RoutePattern.PathSegments
                .Where(segment => segment.Parts.All(part => part is RoutePatternLiteralPart))
                .Select(segment => string.Concat(segment.Parts.Cast<RoutePatternLiteralPart>().Select(part => part.Content))))
            : context.Request.Path.Value ?? "/";
        string permission = (path.StartsWith("/api/", StringComparison.OrdinalIgnoreCase) ? path[5..] : path.TrimStart('/'))
            .TrimEnd('/').Replace("/", ":");

        // 缓存值和前缀操作复用现有查询、删除权限，不新增 API 或菜单权限。
        return permission.ToLowerInvariant() switch
        {
            "sysopenaccess:generatesignature" => "sysOpenAccess:page",
            "systemplate:grouplist" or "systemplate:template" => "sysTemplate:page",
            "systemplate:render" or "systemplate:proview" => "sysTemplate:preview",
            "syscommon:stresstest" or "syscommon:stresstesttargets" => "sysCommon:stressTest",
            "sysupdate:status" => "sysUpdate:list",
            "sysserver:hardwareinfo" or "sysserver:runtimeinfo" or "sysserver:nugetpackageinfo" => "sysServer:page",
            "syslogvis:page" or "syslogvis:list" => "sysVislog:page",
            "syslogvis:clear" => "sysVislog:clear",
            "syslogop:page" or "syslogop:detail" => "sysOplog:page",
            "syslogop:clear" => "sysOplog:clear",
            "syslogop:export" => "sysOplog:export",
            "syslogex:page" or "syslogex:detail" => "sysExlog:page",
            "syslogex:clear" => "sysExlog:clear",
            "syslogex:export" => "sysExlog:export",
            "syslogdiff:page" or "syslogdiff:detail" => "sysDifflog:page",
            "sysdatabase:previewentity" => "sysDatabase:createEntity",
            "sysdatabase:previewseeddata" => "sysDatabase:createSeedData",
            "sysdatabase:generationoptions" => "sysDatabase:list",
            "sysjob:cronpreview" or "sysjob:listjobgroup" or "sysjob:jobtriggerlist" => "sysJob:pageJobDetail",
            "syscache:value" or "syscache:keysbyprefixkey" => "sysCache:keyList",
            "syscache:deletebyprekey" => "sysCache:delete",
            "sysldap:syncdept" => "sysLdap:syncOrg",
            "sysfile:preview" or "sysfile:downloadfilebase64" => "sysFile:downloadFile",
            "sysfile:file" or "sysfile:filebyids" or "sysfile:folder" => "sysFile:page",
            "sysfile:uploadfiles" or "sysfile:uploadfilefrombase64" => "sysFile:uploadFile",
            _ => permission
        };
    }
}
