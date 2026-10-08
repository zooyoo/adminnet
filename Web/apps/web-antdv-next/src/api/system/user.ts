import type { PageUserInput, UpdateUserInput, UserOutput } from '#/api-services/models';

import { SysPosApi } from '#/api-services/apis/sys-pos-api';
import { SysRoleApi } from '#/api-services/apis/sys-role-api';
import { SysUserApi } from '#/api-services/apis/sys-user-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

import { orgTree } from './access-admin';

export type UserRecord = Record<string, unknown> & UserOutput;
export type UserDraft = Omit<UpdateUserInput, 'birthday' | 'joinDate'> & { birthday?: null | string; joinDate?: null | string };
export interface LanguageOption {
	code: string;
	value: string;
	label: string;
}

export async function userPage(query: PageUserInput, signal?: AbortSignal) {
	const data = (await getAPI(SysUserApi).apiSysUserPagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as UserRecord[], total: data?.total ?? 0 };
}

export async function userEditorOptions(tenantId?: number) {
	const [orgs, positions, roles, languages] = await Promise.all([
		orgTree(tenantId),
		getAPI(SysPosApi).apiSysPosListGet(undefined, undefined, tenantId),
		getAPI(SysRoleApi).apiSysRoleListGet(),
		requestClient.post<LanguageOption[]>('/api/sysLang/dropdownData'),
	]);
	return {
		orgs,
		positions: (positions.data.result ?? []).filter((item) => !tenantId || item.tenantId === tenantId),
		roles: (roles.data.result ?? []).filter((item) => !tenantId || item.tenantId === tenantId),
		languages,
	};
}

export async function userAssignments(id: number) {
	const [roles, orgs] = await Promise.all([getAPI(SysUserApi).apiSysUserOwnRoleListUserIdGet(id), getAPI(SysUserApi).apiSysUserOwnExtOrgListUserIdGet(id)]);
	return { roleIdList: roles.data.result ?? [], extOrgIdList: orgs.data.result ?? [] };
}

export function saveUser(draft: UserDraft) {
	// 仅在 SDK 边界把日期恢复为其生成的 Date 类型，不把日期控件对象传给 API。
	const input: UpdateUserInput = {
		...draft,
		birthday: draft.birthday ? new Date(`${draft.birthday}T00:00:00Z`) : null,
		joinDate: draft.joinDate ? new Date(`${draft.joinDate}T00:00:00Z`) : null,
	};
	return input.id ? getAPI(SysUserApi).apiSysUserUpdatePost(input) : getAPI(SysUserApi).apiSysUserAddPost(input);
}

export const removeUser = (id: number) => getAPI(SysUserApi).apiSysUserDeletePost({ id });
export const setUserStatus = (id: number, status: 1 | 2) => getAPI(SysUserApi).apiSysUserSetStatusPost({ id, status });
export const resetUserPassword = async (id: number) => (await getAPI(SysUserApi).apiSysUserResetPwdPost({ id })).data.result ?? '';
export const unlockUser = (id: number) => getAPI(SysUserApi).apiSysUserUnlockLoginPost({ id });
