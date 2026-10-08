import type { AxiosInstance } from 'axios';

import { Configuration } from '#/api-services/configuration';

import { requestClient } from './request';

export function getAPI<T>(apiType: new (configuration?: Configuration, basePath?: string, instance?: AxiosInstance) => T): T {
	// API 地址仅由共享 Axios 实例管理，SDK 再拼接会产生重复代理前缀。
	return new apiType(new Configuration({ basePath: '' }), '', requestClient.instance);
}
