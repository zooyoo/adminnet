import { AxiosHeaders } from 'axios';
import { describe, expect, it, vi } from 'vitest';

import { SysOrgApi } from '../api-services/apis/sys-org-api';
import { requestClient } from './request';
import { getAPI } from './sdk';

vi.mock('./request', async () => {
	const { default: axios } = await import('axios');
	return {
		requestClient: {
			instance: axios.create({
				baseURL: '/prod-api',
				adapter: async (config) => ({ config, data: { code: 200, result: [] }, headers: {}, status: 200, statusText: 'OK' }),
			}),
		},
	};
});

describe('generated SDK transport', () => {
	it.each(['/prod-api', 'https://backend.example.test/base', ''])('uses Axios baseURL %s exactly once', async (baseURL) => {
		requestClient.instance.defaults.baseURL = baseURL;
		const response = await getAPI(SysOrgApi).apiSysOrgListGet(0);
		expect(requestClient.instance.getUri(response.config)).toBe(`${baseURL}/api/sysOrg/list?Id=0`);
		expect(response.data.result).toEqual([]);
	});

	it('retains shared headers and serializes only one request body', async () => {
		requestClient.instance.defaults.baseURL = '/prod-api';
		requestClient.instance.defaults.headers.common.Authorization = 'Bearer test';
		const response = await getAPI(SysOrgApi).apiSysOrgDeletePost({ id: 2 });
		expect(requestClient.instance.getUri(response.config)).toBe('/prod-api/api/sysOrg/delete');
		expect(JSON.parse(response.config.data)).toEqual({ id: 2 });
		expect(AxiosHeaders.from(response.config.headers).get('Authorization')).toBe('Bearer test');
	});
});
