import { beforeEach, describe, expect, it } from 'vitest';

import { stageLegacyToken, takeLegacyToken } from './legacy-token';

describe('旧令牌入口', () => {
	beforeEach(() => takeLegacyToken());

	it('令牌只可消费一次，回跳保留旧业务参数', () => {
		expect(stageLegacyToken({ token: 'candidate', redirect: '/system/user', params: '{"page":2,"enabled":true,"name":"中文"}' })).toBe('/system/user?page=2&enabled=true&name=%E4%B8%AD%E6%96%87');
		expect(takeLegacyToken()).toBe('candidate');
		expect(takeLegacyToken()).toBeNull();
	});

	it.each([['a', 'b'], 'x'.repeat(16_385), null])('拒绝无效令牌并覆盖上一候选', (token) => {
		stageLegacyToken({ token: 'previous' });
		stageLegacyToken({ token });
		expect(takeLegacyToken()).toBe('');
	});

	it('回跳及旧参数均不携带认证令牌', () => {
		expect(stageLegacyToken({
			token: 'candidate',
			redirect: '/system/user?token=secret&accessToken=secret&refreshToken=secret&page=1',
			params: '{"token":"secret","accessToken":"secret","refreshToken":"secret","nested":{}}',
		})).toBe('/system/user?page=1');
	});

	it.each(['https://example.test', '//example.test', '/a/../auth/login'])('拒绝外部或递归回跳 %s', (redirect) => {
		expect(stageLegacyToken({ token: 'candidate', redirect })).toBe('/home');
	});

	it('旧参数损坏时仍保留可用的本地回跳', () => {
		expect(stageLegacyToken({ token: 'candidate', redirect: '/system/user', params: '{bad' })).toBe('/system/user');
	});

	it('业务参数中的分隔符仍是一个完整查询值', () => {
		const target = stageLegacyToken({ token: 'candidate', redirect: '/system/user', params: '{"name":"a&b#c%"}' });
		expect(new URL(target, 'https://local.invalid').searchParams.get('name')).toBe('a&b#c%');
	});
});
