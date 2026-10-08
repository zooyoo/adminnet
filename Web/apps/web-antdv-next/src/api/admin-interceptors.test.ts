import type { AxiosAdapter, AxiosRequestConfig, AxiosResponse } from 'axios';

import type { SessionTokens } from './session';

import axios, { AxiosError, AxiosHeaders } from 'axios';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SysPosApi } from '../api-services/apis/sys-pos-api';
import { installAdminInterceptors } from './admin-interceptors';
import { isTokenExpired, SessionBoundary } from './session';

const jwt = (exp: number) => `header.${btoa(JSON.stringify({ exp }))}.signature`;

describe('Admin.NET request contract', () => {
	let boundary: SessionBoundary;
	let session: { accessToken: null | string; refreshToken: null | string };
	let onExpired: ReturnType<typeof vi.fn<() => void>>;
	let onError: ReturnType<typeof vi.fn<(message: string) => void>>;
	let setTokens: ReturnType<typeof vi.fn<(tokens: SessionTokens) => void>>;

	beforeEach(() => {
		boundary = new SessionBoundary();
		session = { accessToken: jwt(Date.now() / 1000 + 600), refreshToken: 'refresh' };
		onExpired = vi.fn();
		onError = vi.fn();
		setTokens = vi.fn((tokens) => {
			session = tokens;
		});
	});

	function client(adapter?: AxiosAdapter) {
		const instance = axios.create({
			adapter:
				adapter ??
				(async (config) => ({
					config,
					status: 200,
					statusText: 'OK',
					headers: new AxiosHeaders(),
					data: { code: 200, result: { id: 1 } },
				})),
		});
		installAdminInterceptors(instance, { boundary, getSession: () => session, locale: () => 'zh-CN', onExpired, onError, setTokens });
		return instance;
	}

	it('preserves raw SDK responses and unwraps application responses', async () => {
		const instance = client();
		const raw = await instance.get('/api/user');
		expect(raw.data.result).toEqual({ id: 1 });
		const config: AxiosRequestConfig & { responseReturn: string } = { responseReturn: 'data' };
		expect(await instance.get('/api/user', config)).toEqual({ id: 1 });
	});

	it('preserves the actual generated SDK response and URL contract', async () => {
		const instance = client();
		const sdk = new SysPosApi(undefined, '/prod-api', instance);
		const result = await sdk.apiSysPosListGet('engineer');
		const url = new URL(result.config.url!, 'http://localhost');
		expect(url.pathname).toBe('/prod-api/api/sysPos/list');
		expect(url.searchParams.get('Name')).toBe('engineer');
		expect(result.data.result).toEqual({ id: 1 });
		expect(result.config.headers.get('Authorization')).toBe(`Bearer ${session.accessToken}`);
	});

	it('attaches the refresh header only when the access token expires', async () => {
		const instance = client();
		const valid = await instance.get('/api/user');
		expect(valid.config.headers.get('X-Authorization')).toBeUndefined();
		session.accessToken = jwt(1);
		const expired = await instance.get('/api/user');
		expect(expired.config.headers.get('X-Authorization')).toBe('Bearer refresh');
		expect(expired.config.headers.get('Accept-Language')).toBe('zh-CN');
	});

	it('does not attach credentials or adopt tokens from anonymous responses', async () => {
		const instance = client(async (config) => ({
			config,
			status: 200,
			statusText: 'OK',
			headers: { 'access-token': 'next', 'x-access-token': 'next-refresh' },
			data: { code: 200, result: {} },
		}));
		const result = await instance.post('/api/login', {}, { adminAnonymous: true });
		expect(result.config.headers.get('Authorization')).toBeUndefined();
		expect(setTokens).not.toHaveBeenCalled();
	});

	it('rejects business errors in SDK raw mode and reports them once', async () => {
		const instance = client(async (config) => ({
			config,
			status: 200,
			statusText: 'OK',
			headers: {},
			data: { code: 500, message: '业务错误' },
		}));
		await expect(instance.get('/api/user')).rejects.toThrow('业务错误');
		expect(onError).toHaveBeenCalledExactlyOnceWith('业务错误');
	});

	it('invalidates on HTTP 401 without duplicating error notifications', async () => {
		const instance = client(async (config) => {
			throw new AxiosError('Unauthorized', 'ERR_BAD_REQUEST', config, undefined, { config, data: {}, status: 401, statusText: 'Unauthorized', headers: {} });
		});
		await expect(instance.get('/api/user')).rejects.toThrow();
		expect(onExpired).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
	});

	it('treats invalid_token response headers as an expired session', async () => {
		const instance = client(async (config) => ({ config, status: 200, statusText: 'OK', headers: { 'access-token': 'invalid_token' }, data: {} }));
		await expect(instance.get('/api/user')).rejects.toThrow();
		expect(onExpired).toHaveBeenCalledOnce();
	});

	it('rejects late responses after tenant switching without updating tokens', async () => {
		let resolve!: (response: AxiosResponse) => void;
		let config!: AxiosResponse['config'];
		const ready = Promise.withResolvers<void>();
		const instance = client((requestConfig) => {
			config = requestConfig;
			ready.resolve();
			return new Promise((done) => {
				resolve = done;
			});
		});
		const pending = instance.get('/api/user');
		await ready.promise;
		boundary.invalidate();
		resolve({ config, status: 200, statusText: 'OK', headers: { 'access-token': 'old', 'x-access-token': 'old-refresh' }, data: {} });
		await expect(pending).rejects.toSatisfy(axios.isCancel);
		expect(setTokens).not.toHaveBeenCalled();
		expect(onError).not.toHaveBeenCalled();
		expect(onExpired).not.toHaveBeenCalled();
	});

	it('does not overwrite a newer token with an older concurrent response', async () => {
		const instance = client(async (config) => {
			session.accessToken = 'newer';
			return { config, status: 200, statusText: 'OK', headers: { 'access-token': 'older', 'x-access-token': 'older-refresh' }, data: {} };
		});
		await instance.get('/api/user');
		expect(setTokens).not.toHaveBeenCalled();
		expect(session.accessToken).toBe('newer');
	});

	it('preserves binary response bodies', async () => {
		const file = new Blob(['test'], { type: 'text/plain' });
		const instance = client(async (config) => ({ config, status: 200, statusText: 'OK', headers: {}, data: file }));
		const result = await instance.get('/download', { responseType: 'blob' });
		expect(result.data).toBe(file);
	});

	it('treats JSON authentication errors from a binary download as an expired session', async () => {
		const instance = client(async (config) => ({
			config,
			status: 200,
			statusText: 'OK',
			headers: { 'content-type': 'application/json' },
			data: new TextEncoder().encode('{"code":401,"message":"expired"}').buffer,
		}));
		await expect(instance.get('/export', { responseType: 'arraybuffer' })).rejects.toThrow('登录已失效');
		expect(onExpired).toHaveBeenCalledOnce();
		expect(onError).not.toHaveBeenCalled();
	});

	it('reports binary JSON business errors while preserving successful import response bytes', async () => {
		const instance = client(async (config) => ({
			config,
			status: 200,
			statusText: 'OK',
			headers: { 'content-type': 'application/json' },
			data: new Blob(['{"code":400,"message":"导入格式错误"}'], { type: 'application/json' }),
		}));
		await expect(instance.get('/import', { responseType: 'blob' })).rejects.toThrow('导入格式错误');
		expect(onError).toHaveBeenCalledExactlyOnceWith('导入格式错误');
		const bytes = new TextEncoder().encode('{"code":200,"message":"导入成功"}').buffer;
		const successful = client(async (config) => ({ config, status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' }, data: bytes }));
		expect((await successful.post('/import', {}, { responseType: 'arraybuffer' })).data).toBe(bytes);
	});

	it('retains caller cancellation and treats malformed JWTs as expired', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(client().get('/api/user', { signal: controller.signal })).rejects.toSatisfy(axios.isCancel);
		expect(isTokenExpired('broken')).toBe(true);
		expect(isTokenExpired(jwt(1))).toBe(true);
		expect(isTokenExpired(jwt(Date.now() / 1000 + 600))).toBe(false);
	});
});
