import type { AddConfigInput, PageConfigInput, SysConfig, UpdateConfigInput } from '#/api-services/models';

import { SysConfigApi } from '#/api-services/apis/sys-config-api';
import { SysTenantConfigApi } from '#/api-services/apis/sys-tenant-config-api';
import { getAPI } from '#/api/sdk';

export type ConfigRecord = Record<string, unknown> & SysConfig;
export type ConfigScope = 'system' | 'tenant';
export type { UpdateConfigInput };
export function configService(scope: ConfigScope) {
	const system = () => getAPI(SysConfigApi);
	const tenant = () => getAPI(SysTenantConfigApi);
	return {
		prefix: scope === 'tenant' ? 'sysTenantConfig' : 'sysConfig',
		title: scope === 'tenant' ? '租户参数' : '系统参数',
		async page(query: PageConfigInput, signal?: AbortSignal) {
			const response = scope === 'tenant' ? await tenant().apiSysTenantConfigPagePost(query, { signal }) : await system().apiSysConfigPagePost(query, { signal });
			const data = response.data.result;
			return { items: (data?.items ?? []) as ConfigRecord[], total: data?.total ?? 0 };
		},
		async groups() {
			const response = scope === 'tenant' ? await tenant().apiSysTenantConfigGroupListGet() : await system().apiSysConfigGroupListGet();
			return (response.data.result ?? []).filter(Boolean);
		},
		save(value: AddConfigInput | UpdateConfigInput) {
			if (scope === 'tenant') return value.id ? tenant().apiSysTenantConfigUpdatePost(value) : tenant().apiSysTenantConfigAddPost(value);
			return value.id ? system().apiSysConfigUpdatePost(value) : system().apiSysConfigAddPost(value);
		},
		remove(id: number) {
			return scope === 'tenant' ? tenant().apiSysTenantConfigDeletePost({ id }) : system().apiSysConfigDeletePost({ id });
		},
		batchRemove(ids: number[]) {
			return scope === 'tenant' ? tenant().apiSysTenantConfigBatchDeletePost(ids) : system().apiSysConfigBatchDeletePost(ids);
		},
	};
}
