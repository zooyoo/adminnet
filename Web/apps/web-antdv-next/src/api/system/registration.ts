import type { AddUserRegWayInput, PageUserRegWayInput, UserRegWayOutput } from '#/api-services/models';

import { SysPosApi } from '#/api-services/apis/sys-pos-api';
import { SysRoleApi } from '#/api-services/apis/sys-role-api';
import { SysUserRegWayApi } from '#/api-services/apis/sys-user-reg-way-api';
import { getAPI } from '#/api/sdk';

import { orgTree } from './access-admin';

export type RegistrationRecord = Record<string, unknown> & UserRegWayOutput;
export type RegistrationDraft = Omit<AddUserRegWayInput, 'orgId' | 'posId' | 'roleId'> & { roleId?: number; orgId?: number; posId?: number };
export async function registrations(query: PageUserRegWayInput, signal?: AbortSignal) {
	const items = (await getAPI(SysUserRegWayApi).apiSysUserRegWayListPost(query, { signal })).data.result ?? [];
	return { items: items as RegistrationRecord[], total: items.length };
}
export async function registrationOptions(tenantId?: number) {
	const [orgs, roles, positions] = await Promise.all([orgTree(tenantId), getAPI(SysRoleApi).apiSysRoleListGet(), getAPI(SysPosApi).apiSysPosListGet(undefined, undefined, tenantId)]);
	return {
		orgs,
		roles: (roles.data.result ?? []).filter((item) => !tenantId || item.tenantId === tenantId),
		positions: (positions.data.result ?? []).filter((item) => !tenantId || item.tenantId === tenantId),
	};
}
export function saveRegistration(value: RegistrationDraft) {
	if (!value.roleId || !value.orgId || !value.posId) throw new Error('请完整选择角色、机构和职位');
	if (value.accountType === 888 || value.accountType === 999) throw new Error('注册方案不能授予管理员账号类型');
	const input: AddUserRegWayInput = { ...value, roleId: value.roleId, orgId: value.orgId, posId: value.posId };
	return value.id ? getAPI(SysUserRegWayApi).apiSysUserRegWayUpdatePost({ ...input, id: value.id }) : getAPI(SysUserRegWayApi).apiSysUserRegWayAddPost(input);
}
export const removeRegistration = (id: number) => getAPI(SysUserRegWayApi).apiSysUserRegWayDeletePost({ id });
