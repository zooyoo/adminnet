// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using System.Text.Json.Serialization;

namespace Admin.NET.Core.Service;

/// <summary>
/// Vben 登录菜单。复用现有授权结果，不更改数据库中的菜单路径。
/// </summary>
public class VbenMenuOutput
{
    public string Name { get; set; }
    public string Path { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string Component { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string Redirect { get; set; }

    public VbenMenuMeta Meta { get; set; }
    public List<VbenMenuOutput> Children { get; set; } = new();

    public static VbenMenuOutput FromMenu(MenuOutput menu)
    {
        var meta = menu.Meta ?? new SysMenuMeta();
        var component = menu.Component?.Trim().Replace('\\', '/');
        var isFrame = meta.IsIframe && !string.IsNullOrWhiteSpace(meta.IsLink);
        var isLink = !meta.IsIframe && !string.IsNullOrWhiteSpace(meta.IsLink);
        if (isFrame || isLink)
            component = "IFrameView";
        else if (string.IsNullOrEmpty(component) || component.TrimStart('/').StartsWith("layout/routerView/", StringComparison.Ordinal))
            component = null;
        else
        {
            if (component.StartsWith("/src/views/", StringComparison.Ordinal)) component = component[10..];
            component = "/" + component.TrimStart('/');
            if (component.EndsWith(".vue", StringComparison.Ordinal)) component = component[..^4];
        }

        return new VbenMenuOutput
        {
            Name = string.IsNullOrWhiteSpace(menu.Name) ? $"menu_{menu.Id}" : menu.Name,
            Path = menu.Path ?? "",
            Component = component,
            Redirect = string.IsNullOrWhiteSpace(menu.Redirect) ? null : menu.Redirect,
            Meta = new VbenMenuMeta
            {
                Title = meta.Title ?? menu.Name ?? "",
                Icon = meta.Icon ?? "",
                HideInMenu = meta.IsHide,
                KeepAlive = meta.IsKeepAlive,
                AffixTab = meta.IsAffix,
                Order = menu.OrderNo,
                IframeSrc = isFrame ? meta.IsLink : null,
                Link = isLink ? meta.IsLink : null
            },
            Children = menu.Children?.Select(FromMenu).ToList() ?? new()
        };
    }
}

public class VbenMenuMeta
{
    public string Title { get; set; }
    public string Icon { get; set; }
    public bool HideInMenu { get; set; }
    public bool KeepAlive { get; set; }
    public bool AffixTab { get; set; }
    public int Order { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string IframeSrc { get; set; }

    [JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    public string Link { get; set; }
}
