// Admin.NET 项目的版权、商标、专利和其他相关权利均受相应法律法规的保护。使用本项目应遵守相关法律法规和许可证的要求。
//
// 本项目主要遵循 MIT 许可证和 Apache 许可证（版本 2.0）进行分发和使用。许可证位于源代码树根目录中的 LICENSE-MIT 和 LICENSE-APACHE 文件。
//
// 不得利用本项目从事危害国家安全、扰乱社会秩序、侵犯他人合法权益等法律法规禁止的活动！任何基于本项目二次开发而产生的一切法律纠纷和责任，我们不承担任何责任！

namespace Admin.NET.Core.Service;

/// <summary>
/// 系统角色服务 🧩
/// </summary>
[ApiDescriptionSettings(Order = 480)]
public class SysRoleService : IDynamicApiController, ITransient
{
    private readonly UserManager _userManager;
    private readonly SqlSugarRepository<SysRole> _sysRoleRep;
    private readonly SysRoleMenuService _sysRoleMenuService;
    private readonly SysUserRoleService _sysUserRoleService;
    private readonly SysRoleOrgService _sysRoleOrgService;
    private readonly SysMenuService _sysMenuService;
    private readonly SysOrgService _sysOrgService;
    private readonly SysCacheService _sysCacheService;

    public SysRoleService(UserManager userManager,
        SysOrgService sysOrgService,
        SysMenuService sysMenuService,
        SysRoleOrgService sysRoleOrgService,
        SqlSugarRepository<SysRole> sysRoleRep,
        SysRoleMenuService sysRoleMenuService,
        SysUserRoleService sysUserRoleService,
        SysCacheService sysCacheService)
    {
        _userManager = userManager;
        _sysRoleRep = sysRoleRep;
        _sysOrgService = sysOrgService;
        _sysMenuService = sysMenuService;
        _sysRoleOrgService = sysRoleOrgService;
        _sysRoleMenuService = sysRoleMenuService;
        _sysUserRoleService = sysUserRoleService;
        _sysCacheService = sysCacheService;
    }

    /// <summary>
    /// 获取角色分页列表 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("获取角色分页列表")]
    public async Task<SqlSugarPagedList<SysRole>> Page(PageRoleInput input)
    {
        // 当前用户已拥有的角色集合
        var roleIdList = _userManager.SuperAdmin ? new List<long>() : await _sysUserRoleService.GetUserRoleIdList(_userManager.UserId);
        return await _sysRoleRep.AsQueryable()
            .WhereIF(_userManager.SuperAdmin && input.TenantId > 0, u => u.TenantId == input.TenantId)
            .WhereIF(!_userManager.SuperAdmin, u => u.TenantId == _userManager.TenantId) // 若非超管，则只能操作本租户的角色
            .WhereIF(!_userManager.SuperAdmin && !_userManager.SysAdmin, u => u.CreateUserId == _userManager.UserId || roleIdList.Contains(u.Id)) // 若非超管且非系统管理员，则只能操作自己创建的角色|自己拥有的角色
            .WhereIF(!string.IsNullOrWhiteSpace(input.Name), u => u.Name.Contains(input.Name))
            .WhereIF(!string.IsNullOrWhiteSpace(input.Code), u => u.Code.Contains(input.Code))
            .OrderBy(u => new { u.OrderNo, u.Id })
            .ToPagedListAsync(input.Page, input.PageSize);
    }

    /// <summary>
    /// 获取角色列表 🔖
    /// </summary>
    /// <returns></returns>
    [DisplayName("获取角色列表")]
    public async Task<List<RoleOutput>> GetList()
    {
        // 当前用户已拥有的角色集合
        var roleIdList = _userManager.SuperAdmin ? new List<long>() : await _sysUserRoleService.GetUserRoleIdList(_userManager.UserId);

        return await _sysRoleRep.AsQueryable()
            .WhereIF(!_userManager.SuperAdmin, u => u.TenantId == _userManager.TenantId) // 若非超管，则只能操作本租户的角色
            .WhereIF(!_userManager.SuperAdmin && !_userManager.SysAdmin, u => u.CreateUserId == _userManager.UserId || roleIdList.Contains(u.Id)) // 若非超管且非系统管理员，则只显示自己创建和已拥有的角色
            .Where(u => u.Status != StatusEnum.Disable) // 非禁用的
            .OrderBy(u => new { u.OrderNo, u.Id }).Select<RoleOutput>().ToListAsync();
    }

    /// <summary>
    /// 增加角色 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Add"), HttpPost]
    [DisplayName("增加角色")]
    [UnitOfWork]
    public async Task AddRole(AddRoleInput input)
    {
        if (await _sysRoleRep.IsAnyAsync(u => u.Name == input.Name && u.Code == input.Code))
            throw Oops.Oh(ErrorCodeEnum.D1006);

        var role = input.Adapt<SysRole>();
        role.TenantId = _userManager.SuperAdmin && input.TenantId > 0 ? input.TenantId : _userManager.TenantId;
        role.CreateUserId = _userManager.UserId;
        role.CreateUserName = _userManager.RealName;
        // 数据范围通过专用授权接口设置，新增正文不得绕过该接口的限制。
        role.DataScope = DataScopeEnum.Self;
        if (input.MenuIdList != null)
            await ValidateMenuIds(role.TenantId.Value, input.MenuIdList);
        var newRole = await _sysRoleRep.AsInsertable(role).ExecuteReturnEntityAsync();
        input.Id = newRole.Id;
        await UpdateRoleMenu(input);
    }

    /// <summary>
    /// 更新角色菜单权限
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    private async Task UpdateRoleMenu(AddRoleInput input)
    {
        if (input.MenuIdList == null) return;
        await GrantMenu(new RoleMenuInput()
        {
            Id = input.Id,
            MenuIdList = input.MenuIdList.ToList()
        });
    }

    /// <summary>
    /// 更新角色 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [ApiDescriptionSettings(Name = "Update"), HttpPost]
    [DisplayName("更新角色")]
    [UnitOfWork]
    public async Task UpdateRole(UpdateRoleInput input)
    {
        if (await _sysRoleRep.IsAnyAsync(u => u.Name == input.Name && u.Code == input.Code && u.Id != input.Id))
            throw Oops.Oh(ErrorCodeEnum.D1006);

        var role = await GetManageableRole(input.Id);
        if (input.MenuIdList != null)
            await ValidateMenuIds(role.TenantId ?? _userManager.TenantId, input.MenuIdList);
        var changed = await _sysRoleRep.AsUpdateable(input.Adapt<SysRole>())
            .IgnoreColumns(true)
            .IgnoreColumns(u => new { u.DataScope, u.TenantId, u.CreateUserId, u.CreateUserName })
            .Where(u => u.Id == input.Id && u.TenantId == role.TenantId)
            .ExecuteCommandAsync();
        if (changed == 0) throw Oops.Oh(ErrorCodeEnum.D1016);

        await UpdateRoleMenu(input);
    }

    /// <summary>
    /// 删除角色 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [UnitOfWork]
    [ApiDescriptionSettings(Name = "Delete"), HttpPost]
    [DisplayName("删除角色")]
    public async Task DeleteRole(DeleteRoleInput input)
    {
        var manageableRole = await GetManageableRole(input.Id);
        // 若角色有用户则禁止删除
        var userIds = await _sysUserRoleService.GetUserIdList(input.Id);
        if (userIds != null && userIds.Count > 0) throw Oops.Oh(ErrorCodeEnum.D1025);

        // 若有绑定注册方案则禁止删除
        var hasUserRegWay = await _sysRoleRep.Context.Queryable<SysUserRegWay>().AnyAsync(u => u.RoleId == input.Id);
        if (hasUserRegWay) throw Oops.Oh(ErrorCodeEnum.D1033);

        await _sysRoleRep.DeleteAsync(manageableRole);

        // 级联删除角色机构数据
        await _sysRoleOrgService.DeleteRoleOrgByRoleId(manageableRole.Id);

        // 级联删除用户角色数据
        await _sysUserRoleService.DeleteUserRoleByRoleId(manageableRole.Id);

        // 级联删除角色菜单数据
        await _sysRoleMenuService.DeleteRoleMenuByRoleId(manageableRole.Id);
    }

    /// <summary>
    /// 授权角色菜单 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [UnitOfWork]
    [DisplayName("授权角色菜单")]
    public async Task GrantMenu(RoleMenuInput input)
    {
        if (input.MenuIdList == null) return;

        var role = await GetManageableRole(input.Id);
        await ValidateMenuIds(role.TenantId ?? _userManager.TenantId, input.MenuIdList);
        if (input.RoleIdList?.Count > 0)
        {
            foreach (var roleId in input.RoleIdList)
            {
                var target = await GetManageableRole(roleId);
                await ValidateMenuIds(target.TenantId ?? _userManager.TenantId, input.MenuIdList);
            }
        }
        await ClearUserApiCache(input.Id);

        await _sysRoleMenuService.GrantRoleMenu(input);
    }

    /// <summary>
    /// 授权角色数据范围 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [UnitOfWork]
    [DisplayName("授权角色数据范围")]
    public async Task GrantDataScope(RoleOrgInput input)
    {
        var role = await GetManageableRole(input.Id);
        var dataScope = input.DataScope;
        if (!Enum.IsDefined(typeof(DataScopeEnum), dataScope))
            throw Oops.Oh(ErrorCodeEnum.D1016);
        if (dataScope == (int)DataScopeEnum.Define)
        {
            if (input.OrgIdList == null) throw Oops.Oh(ErrorCodeEnum.D1016);
            var requested = input.OrgIdList.Distinct().ToList();
            var available = await _sysRoleRep.Context.Queryable<SysOrg>()
                .Where(u => u.TenantId == role.TenantId && requested.Contains(u.Id)).Select(u => u.Id).ToListAsync();
            if (available.Distinct().Count() != requested.Count) throw Oops.Oh(ErrorCodeEnum.D1016);
        }
        else
        {
            input.OrgIdList = new List<long>();
        }
        if (!_userManager.SuperAdmin)
        {
            switch (dataScope)
            {
                // 非超级管理员没有全部数据范围权限
                case (int)DataScopeEnum.All: throw Oops.Oh(ErrorCodeEnum.D1016);
                // 若数据范围自定义，则判断授权数据范围是否有权限
                case (int)DataScopeEnum.Define:
                    {
                        var grantOrgIdList = input.OrgIdList;
                        if (grantOrgIdList.Count > 0)
                        {
                            var orgIdList = await _sysOrgService.GetUserOrgIdList();
                            if (orgIdList.Count < 1)
                                throw Oops.Oh(ErrorCodeEnum.D1016);
                            if (!grantOrgIdList.All(u => orgIdList.Any(c => c == u)))
                                throw Oops.Oh(ErrorCodeEnum.D1016);
                        }

                        break;
                    }
            }
        }
        role.DataScope = (DataScopeEnum)dataScope;
        await _sysRoleRep.AsUpdateable(role).UpdateColumns(u => new { u.DataScope }).ExecuteCommandAsync();
        await _sysRoleOrgService.GrantRoleOrg(input);
        // 验证和写入成功后才失效相关用户缓存。
        var userIdList = await _sysUserRoleService.GetUserIdList(input.Id);
        foreach (var userId in userIdList)
            SqlSugarFilter.DeleteUserOrgCache(userId, _sysRoleRep.Context.CurrentConnectionConfig.ConfigId.ToString());
    }

    /// <summary>
    /// 根据角色Id获取菜单Id集合 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("根据角色Id获取菜单Id集合")]
    public async Task<List<long>> GetOwnMenuList([FromQuery] RoleInput input)
    {
        await GetManageableRole(input.Id);
        var menuIds = await _sysRoleMenuService.GetRoleMenuIdList(new List<long> { input.Id });
        return await _sysMenuService.ExcludeParentMenuOfFullySelected(menuIds);
    }

    /// <summary>
    /// 根据角色Id获取机构Id集合 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("根据角色Id获取机构Id集合")]
    public async Task<List<long>> GetOwnOrgList([FromQuery] RoleInput input)
    {
        await GetManageableRole(input.Id);
        return await _sysRoleOrgService.GetRoleOrgIdList(new List<long> { input.Id });
    }

    /// <summary>
    /// 设置角色状态 🔖
    /// </summary>
    /// <param name="input"></param>
    /// <returns></returns>
    [DisplayName("设置角色状态")]
    public async Task<int> SetStatus(RoleInput input)
    {
        if (!Enum.IsDefined(typeof(StatusEnum), input.Status)) throw Oops.Oh(ErrorCodeEnum.D3005);

        var role = await GetManageableRole(input.Id);
        return await _sysRoleRep.AsUpdateable()
            .SetColumns(u => u.Status == input.Status)
            .Where(u => u.Id == role.Id && u.TenantId == role.TenantId)
            .ExecuteCommandAsync();
    }

    /// <summary>
    /// 删除与该角色相关的用户接口缓存
    /// </summary>
    /// <param name="roleId"></param>
    /// <returns></returns>
    [NonAction]
    public async Task ClearUserApiCache(long roleId)
    {
        var userIdList = await _sysUserRoleService.GetUserIdList(roleId);
        foreach (var userId in userIdList)
        {
            _sysCacheService.Remove($"{CacheConst.KeyUserButton}{userId}");
        }
    }

    private async Task<SysRole> GetManageableRole(long roleId)
    {
        var role = await _sysRoleRep.GetFirstAsync(u => u.Id == roleId);
        if (role == null) throw Oops.Oh(ErrorCodeEnum.D1002);
        if (_userManager.SuperAdmin) return role;
        if (role.TenantId != _userManager.TenantId) throw Oops.Oh(ErrorCodeEnum.D1016);
        if (_userManager.SysAdmin) return role;

        var roleIdList = await _sysUserRoleService.GetUserRoleIdList(_userManager.UserId);
        if (role.CreateUserId != _userManager.UserId && !roleIdList.Contains(role.Id))
            throw Oops.Oh(ErrorCodeEnum.D1016);
        return role;
    }

    private async Task ValidateMenuIds(long tenantId, List<long> menuIds)
    {
        if (menuIds.Count == 0) return;
        var (query, _) = _sysMenuService.GetSugarQueryableAndTenantId(tenantId);
        var available = await query.Where(u => menuIds.Contains(u.Id)).Select(u => u.Id).ToListAsync();
        if (available.Distinct().Count() != menuIds.Distinct().Count())
            throw Oops.Oh(ErrorCodeEnum.D1016);
        if (!_userManager.SuperAdmin && !_userManager.SysAdmin)
        {
            var ownMenuIds = await _sysMenuService.GetMenuIdList();
            if (menuIds.Any(id => !ownMenuIds.Contains(id))) throw Oops.Oh(ErrorCodeEnum.D1016);
        }
    }
}
