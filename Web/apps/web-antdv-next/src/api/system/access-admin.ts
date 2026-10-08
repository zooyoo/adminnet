import type { AddMenuInput, AddOrgInput, AddRoleInput, PageRoleInput, RoleOrgInput, SysMenu, SysOrg, SysRole, UpdateMenuInput, UpdateOrgInput, UpdateRoleInput } from '#/api-services/models';

import { SysMenuApi } from '#/api-services/apis/sys-menu-api';
import { SysOrgApi } from '#/api-services/apis/sys-org-api';
import { SysRoleApi } from '#/api-services/apis/sys-role-api';
import { getAPI } from '#/api/sdk';
import { normalizeTableTree } from '#/utils/admin-tree';

export type RoleRecord = Record<string, unknown> & SysRole;
export type MenuRecord = Record<string, unknown> & SysMenu;
export type OrgRecord = Record<string, unknown> & SysOrg;
export type { AddMenuInput, AddOrgInput, AddRoleInput, RoleOrgInput, UpdateMenuInput, UpdateOrgInput, UpdateRoleInput };

export async function rolePage(query: PageRoleInput, signal?: AbortSignal) {
	const data = (await getAPI(SysRoleApi).apiSysRolePagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as RoleRecord[], total: data?.total ?? 0 };
}

export async function menuList(tenantId?: number, title?: string, type?: number, signal?: AbortSignal) {
	const rows = (await getAPI(SysMenuApi).apiSysMenuListGet(title, type, tenantId, { signal })).data.result ?? [];
	return normalizeTableTree(rows) as MenuRecord[];
}

export async function orgList(tenantId?: number, id = 0, name?: string, type?: string, signal?: AbortSignal) {
	const rows = (await getAPI(SysOrgApi).apiSysOrgListGet(id, name, undefined, type, tenantId, { signal })).data.result ?? [];
	return normalizeTableTree(rows) as OrgRecord[];
}

export async function orgTree(tenantId?: number) {
	return (await getAPI(SysOrgApi).apiSysOrgTreeGet(0, undefined, undefined, undefined, tenantId)).data.result ?? [];
}

export async function roleMenuIds(id: number) {
	return (await getAPI(SysRoleApi).apiSysRoleOwnMenuListGet(id)).data.result ?? [];
}

export async function roleOrgIds(id: number) {
	return (await getAPI(SysRoleApi).apiSysRoleOwnOrgListGet(id)).data.result ?? [];
}

export function saveRole(input: AddRoleInput | UpdateRoleInput) {
	return input.id ? getAPI(SysRoleApi).apiSysRoleUpdatePost(input) : getAPI(SysRoleApi).apiSysRoleAddPost(input);
}

export function saveOrg(input: AddOrgInput | UpdateOrgInput) {
	return input.id ? getAPI(SysOrgApi).apiSysOrgUpdatePost(input) : getAPI(SysOrgApi).apiSysOrgAddPost(input);
}

export function saveMenu(input: AddMenuInput | UpdateMenuInput) {
	return input.id ? getAPI(SysMenuApi).apiSysMenuUpdatePost(input) : getAPI(SysMenuApi).apiSysMenuAddPost(input);
}

export const removeRole = (id: number) => getAPI(SysRoleApi).apiSysRoleDeletePost({ id });
export const removeOrg = (id: number) => getAPI(SysOrgApi).apiSysOrgDeletePost({ id });
export const removeMenu = (id: number) => getAPI(SysMenuApi).apiSysMenuDeletePost({ id });
export const setRoleStatus = (id: number, status: 1 | 2) => getAPI(SysRoleApi).apiSysRoleSetStatusPost({ id, status });
export const setMenuStatus = (id: number, status: 1 | 2) => getAPI(SysMenuApi).apiSysMenuSetStatusPost({ id, status });
export const grantDataScope = (input: RoleOrgInput) => getAPI(SysRoleApi).apiSysRoleGrantDataScopePost(input);
