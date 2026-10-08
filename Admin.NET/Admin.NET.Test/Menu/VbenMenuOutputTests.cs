// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

using Admin.NET.Core.Service;
using Xunit;

namespace Admin.NET.Test.Menu;

public class VbenMenuOutputTests
{
    [Fact]
    public void FromMenu_WithNestedDirectory_PreservesPathsAndMetadata()
    {
        // Arrange
        var menu = new MenuOutput
        {
            Id = 1, Name = "system", Path = "/system", Component = "layout/routerView/parent",
            Meta = new SysMenuMeta { Title = "系统管理", Icon = "ele-Setting" },
            Children = new List<MenuOutput>
            {
                new()
                {
                    Id = 2, Name = "sysUser", Path = "/system/user", Component = "/system/user/index",
                    OrderNo = 30, Meta = new SysMenuMeta { Title = "用户", IsHide = true, IsKeepAlive = true, IsAffix = true }
                }
            }
        };

        // Act
        var result = VbenMenuOutput.FromMenu(menu);

        // Assert
        Assert.Null(result.Component);
        var child = Assert.Single(result.Children);
        Assert.Equal("/system/user", child.Path);
        Assert.Equal("/system/user/index", child.Component);
        Assert.True(child.Meta.HideInMenu);
        Assert.True(child.Meta.KeepAlive);
        Assert.True(child.Meta.AffixTab);
        Assert.Equal(30, child.Meta.Order);
        Assert.Equal("layout/routerView/parent", menu.Component);
    }

    [Theory]
    [InlineData(true)]
    [InlineData(false)]
    public void FromMenu_WithExternalLink_SeparatesFrameAndLink(bool isFrame)
    {
        // Arrange
        var menu = new MenuOutput { Id = 1, Path = "/docs", Meta = new SysMenuMeta { IsIframe = isFrame, IsLink = "https://example.test/docs" } };

        // Act
        var result = VbenMenuOutput.FromMenu(menu);

        // Assert
        Assert.Equal("menu_1", result.Name);
        Assert.Equal("IFrameView", result.Component);
        Assert.Equal(isFrame ? "https://example.test/docs" : null, result.Meta.IframeSrc);
        Assert.Equal(isFrame ? null : "https://example.test/docs", result.Meta.Link);
    }

    [Theory]
    [InlineData("/src/views/system/user/index.vue", "/system/user/index")]
    [InlineData("system\\role\\index.vue", "/system/role/index")]
    public void FromMenu_WithLegacyComponent_NormalizesWithoutChangingInput(string component, string expected)
    {
        var menu = new MenuOutput { Component = component };
        var result = VbenMenuOutput.FromMenu(menu);
        Assert.Equal(expected, result.Component);
        Assert.Equal(component, menu.Component);
    }
}
