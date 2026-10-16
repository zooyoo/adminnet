import type { AddTenantInput, PageTenantInput, TenantOutput, UpdateTenantInput } from '#/api-services/models';

import { SysTenantApi } from '#/api-services/apis/sys-tenant-api';
import { SysUserRegWayApi } from '#/api-services/apis/sys-user-reg-way-api';
import { getAPI } from '#/api/sdk';

export type TenantRecord = Record<string, unknown> & TenantOutput;
export type { AddTenantInput, UpdateTenantInput };
export async function tenantPage(query: PageTenantInput, signal?: AbortSignal) {
	const data = (await getAPI(SysTenantApi).apiSysTenantPagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as TenantRecord[], total: data?.total ?? 0 };
}
export async function tenantRegistrationOptions(tenantId?: number, signal?: AbortSignal) {
	const records = (await getAPI(SysUserRegWayApi).apiSysUserRegWayListPost({ tenantId }, { signal })).data.result ?? [];
	return records.filter((record) => record.id != null && record.id > 0 && (!tenantId || record.tenantId === tenantId)).map((record) => ({ label: record.name || String(record.id), value: record.id! }));
}
export function saveTenant(input: AddTenantInput | UpdateTenantInput, signal?: AbortSignal) {
	return input.id ? getAPI(SysTenantApi).apiSysTenantUpdatePost(input, { signal }) : getAPI(SysTenantApi).apiSysTenantAddPost(input, { signal });
}
export const createTenantDatabase = (id: number) => getAPI(SysTenantApi).apiSysTenantCreateDbPost({ id }, { timeout: 600_000 });
export const removeTenant = (id: number) => getAPI(SysTenantApi).apiSysTenantDeletePost({ id });
export const setTenantStatus = (id: number, status: 1 | 2) => getAPI(SysTenantApi).apiSysTenantSetStatusPost({ id, status });
export const synchronizeTenantMenus = (id: number) => getAPI(SysTenantApi).apiSysTenantSyncGrantMenuPost({ id });
export const tenantMenuIds = async (id: number) => (await getAPI(SysTenantApi).apiSysTenantTenantMenuListGet(id)).data.result ?? [];
export const grantTenantMenus = (id: number, menuIdList: number[]) => getAPI(SysTenantApi).apiSysTenantGrantMenuPost({ id, menuIdList });
export const resetTenantPassword = async (userId: number) => (await getAPI(SysTenantApi).apiSysTenantResetPwdPost({ userId })).data.result ?? '';

export const databaseTypes = [
	'MySql',
	'SqlServer',
	'Sqlite',
	'Oracle',
	'PostgreSQL',
	'Dm',
	'Kdbndp',
	'Oscar',
	'MySqlConnector',
	'Access',
	'OpenGauss',
	'QuestDB',
	'HG',
	'ClickHouse',
	'GBase',
	'Odbc',
	'OceanBaseForOracle',
	'TDengine',
	'GaussDB',
	'OceanBase',
	'Tidb',
	'Vastbase',
	'PolarDB',
	'Doris',
]
	.map((label, value) => ({ label, value }))
	.concat([{ label: 'Custom', value: 900 }]);
