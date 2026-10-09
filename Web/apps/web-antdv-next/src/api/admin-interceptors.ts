import type { AxiosInstance, AxiosResponse, InternalAxiosRequestConfig } from 'axios';

import type { SessionBoundary, SessionTokens } from './session';

import { AxiosError, CanceledError, isAxiosError, isCancel } from 'axios';

import { isTokenExpired } from './session';

declare module 'axios' {
	export interface AxiosRequestConfig {
		adminAnonymous?: boolean;
		/** 候选身份请求只验证新会话，不替换或注销当前身份。 */
		adminIdentity?: SessionTokens;
		adminManualTokens?: boolean;
		silentError?: boolean;
		adminSession?: {
			controller: AbortController;
			token: null | string;
			version: number;
		};
	}
}

export interface AdminResult<T> {
	code: number;
	result: T;
	message?: unknown;
	errors?: unknown;
}

interface SessionAccess {
	accessToken: null | string;
	refreshToken: null | string;
}

interface InterceptorOptions {
	boundary: SessionBoundary;
	getSession: () => SessionAccess;
	locale: () => string;
	onExpired: () => Promise<void> | void;
	onError: (message: string) => void;
	setTokens: (tokens: SessionTokens) => void;
}

function errorText(value: unknown, fallback: string): string {
	if (typeof value === 'string' && value.trim()) return value;
	if (value && typeof value === 'object') return JSON.stringify(value);
	return fallback;
}

export function installAdminInterceptors(instance: AxiosInstance, options: InterceptorOptions) {
	const { boundary } = options;

	instance.interceptors.request.use((config) => {
		const controller = new AbortController();
		const session = config.adminIdentity ?? options.getSession();
		config.signal = config.signal ? AbortSignal.any([config.signal as AbortSignal, controller.signal]) : controller.signal;
		config.adminSession = { controller, token: session.accessToken, version: boundary.version };
		boundary.track(controller);
		config.headers.set('Accept-Language', options.locale());
		// 匿名请求不携带旧会话，登录返回值由认证 store 原子提交。
		if (config.adminAnonymous) {
			config.headers.delete('Authorization');
			config.headers.delete('X-Authorization');
		} else if (session.accessToken) {
			config.headers.set('Authorization', `Bearer ${session.accessToken}`);
			if (session.refreshToken && isTokenExpired(session.accessToken)) {
				config.headers.set('X-Authorization', `Bearer ${session.refreshToken}`);
			}
		}
		if (config.data instanceof FormData) config.headers.delete('Content-Type');
		return config;
	});

	function release(config?: InternalAxiosRequestConfig) {
		if (config?.adminSession) boundary.release(config.adminSession.controller);
	}

	function ensureCurrent(config?: InternalAxiosRequestConfig) {
		if (config?.adminSession && config.adminSession.version !== boundary.version) {
			throw new CanceledError('Session changed', config);
		}
	}

	instance.interceptors.response.use(async (response) => {
		release(response.config);
		ensureCurrent(response.config);
		const { config, data, headers } = response;
		let result = data as null | Partial<AdminResult<unknown>>;
		const binary = data instanceof Blob || data instanceof ArrayBuffer;
		if (binary && /json/i.test(String(headers['content-type'] ?? ''))) {
			const text = data instanceof Blob ? await data.text() : new TextDecoder().decode(data);
			ensureCurrent(config);
			result = JSON.parse(text) as Partial<AdminResult<unknown>>;
		}
		if (headers['access-token'] === 'invalid_token' || result?.code === 401) {
			throw new AxiosError('登录已失效', 'ERR_AUTH_EXPIRED', config, response.request, { ...response, data: result, status: 401 });
		}
		if (result && typeof result === 'object' && !(result instanceof Blob) && !(result instanceof ArrayBuffer)) {
			if (result.errors || (result.code !== undefined && result.code !== 200)) {
				throw new AxiosError(errorText(result.errors ?? result.message, '请求失败'), 'ERR_ADMIN_RESULT', config, response.request, { ...response, data: result });
			}
		}
		const accessToken = headers['access-token'];
		const refreshToken = headers['x-access-token'];
		// 同一会话并发响应只能换发当前请求所使用的令牌，避免较旧响应覆盖新令牌。
		if (!config.adminAnonymous && !config.adminIdentity && !config.adminManualTokens && accessToken && refreshToken && options.getSession().accessToken === config.adminSession?.token) {
			options.setTokens({ accessToken, refreshToken });
		}
		const mode = (config as InternalAxiosRequestConfig & { responseReturn?: string }).responseReturn;
		if (mode === 'data') return (!binary && result?.code === 200 ? result.result : data) as AxiosResponse;
		if (mode === 'body') return data;
		return response;
	});

	instance.interceptors.response.use(undefined, async (error: unknown) => {
		const config = isAxiosError(error) ? error.config : undefined;
		release(config);
		ensureCurrent(config);
		if (isCancel(error)) throw error;
		if (isAxiosError(error) && error.response?.status === 401 && !config?.adminAnonymous && !config?.adminIdentity) {
			await options.onExpired();
		} else if (!config?.silentError) {
			const response = isAxiosError(error) ? error.response : undefined;
			const data = response?.data;
			const fallback = isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? '') ? '请求超时，请重试' : response ? `请求失败（${response.status}）` : '网络连接失败，请稍后重试';
			const text = errorText(data?.errors ?? data?.message, fallback);
			if (error instanceof Error) error.message = text;
			options.onError(text);
		}
		throw error;
	});
}
