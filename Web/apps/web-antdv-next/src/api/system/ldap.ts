import type { SysLdap, SysLdapInput } from '#/api-services/models';

import { SysLdapApi } from '#/api-services/apis/sys-ldap-api';
import { getAPI } from '#/api/sdk';

export type LdapRecord = Record<string, unknown> & SysLdap;
export type LdapDraft = SysLdap;
export async function ldapPage(query: SysLdapInput, signal?: AbortSignal) {
	const data = (await getAPI(SysLdapApi).apiSysLdapPagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as LdapRecord[], total: data?.total ?? 0 };
}
export async function ldapDetail(id: number) {
	return (await getAPI(SysLdapApi).apiSysLdapDetailGet(id)).data.result;
}
export const saveLdap = (value: LdapDraft) => (value.id ? getAPI(SysLdapApi).apiSysLdapUpdatePost(value) : getAPI(SysLdapApi).apiSysLdapAddPost(value));
export const removeLdap = (id: number) => getAPI(SysLdapApi).apiSysLdapDeletePost({ id });
export const syncLdapUsers = (id: number) => getAPI(SysLdapApi).apiSysLdapSyncUserPost({ id });
export const syncLdapOrgs = (id: number) => getAPI(SysLdapApi).apiSysLdapSyncDeptPost({ id });
export function ldapDraft(value?: SysLdap, tenantId?: number): LdapDraft {
	return {
		id: value?.id,
		tenantId: value?.tenantId ?? tenantId,
		host: value?.host ?? '',
		port: value?.port ?? 389,
		baseDn: value?.baseDn ?? '',
		bindDn: value?.bindDn ?? '',
		bindPass: '',
		authFilter: value?.authFilter ?? '(sAMAccountName=%s)',
		version: value?.version ?? 3,
		bindAttrAccount: value?.bindAttrAccount ?? 'sAMAccountName',
		bindAttrEmployeeId: value?.bindAttrEmployeeId ?? 'EmployeeId',
		bindAttrCode: value?.bindAttrCode ?? 'objectGUID',
		status: value?.status ?? 1,
	};
}
export const ldapTextFields = [
	{ key: 'host', label: '主机', max: 128 },
	{ key: 'baseDn', label: '搜索基准', max: 128 },
	{ key: 'bindDn', label: '绑定 DN', max: 128 },
	{ key: 'authFilter', label: '过滤规则', max: 128 },
	{ key: 'bindAttrAccount', label: '账号字段', max: 32 },
	{ key: 'bindAttrEmployeeId', label: '员工编号字段', max: 32 },
	{ key: 'bindAttrCode', label: '组织编码字段', max: 64 },
] as const;
