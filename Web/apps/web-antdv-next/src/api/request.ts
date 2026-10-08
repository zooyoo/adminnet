import type { RequestClientConfig } from '@vben/request';

import { useAppConfig } from '@vben/hooks';
import { preferences } from '@vben/preferences';
import { RequestClient } from '@vben/request';
import { useAccessStore } from '@vben/stores';

import { message } from 'antdv-next';

import { useAuthStore } from '#/store';

import { installAdminInterceptors } from './admin-interceptors';
import { sessionBoundary } from './session';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

class AdminRequestClient extends RequestClient {
	override request<T>(url: string, config: RequestClientConfig): Promise<T> {
		return super.request<T>(url, { responseReturn: 'data', ...config });
	}
}

export const requestClient = new AdminRequestClient({
	baseURL: apiURL,
	timeout: 50_000,
	// SDK 直接使用 instance 时保留 AxiosResponse，业务调用通过 request() 解包。
	responseReturn: 'raw',
});

installAdminInterceptors(requestClient.instance, {
	boundary: sessionBoundary,
	getSession: () => useAccessStore(),
	locale: () => preferences.app.locale,
	onExpired: () => useAuthStore().expireSession(),
	onError: (text) => message.error(text),
	setTokens: ({ accessToken, refreshToken }) => {
		const store = useAccessStore();
		store.setAccessToken(accessToken);
		store.setRefreshToken(refreshToken);
	},
});

export const baseRequestClient = requestClient;
