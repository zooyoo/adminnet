import { safeRedirect } from './redirect';

let incoming: null | string = null;

export function stageLegacyToken(query: Record<string, unknown>) {
	incoming = typeof query.token === 'string' && query.token.length <= 16_384 ? query.token : '';
	let target = safeRedirect(query.redirect);
	if (typeof query.params === 'string') {
		try {
			const params = JSON.parse(query.params) as unknown;
			if (params && typeof params === 'object' && !Array.isArray(params)) {
				const url = new URL(target, 'https://local.invalid');
				for (const [key, value] of Object.entries(params)) {
					if (['accessToken', 'refreshToken', 'token'].includes(key)) continue;
					if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') url.searchParams.set(key, String(value));
				}
				target = `${url.pathname}${url.search}${url.hash}`;
			}
		} catch {
			// 无效的旧参数不影响安全回跳。
		}
	}
	const url = new URL(target, 'https://local.invalid');
	for (const key of ['token', 'accessToken', 'refreshToken']) url.searchParams.delete(key);
	if (safeRedirect(url.pathname) !== url.pathname) return '/home';
	return `${url.pathname}${url.search}${url.hash}`;
}

export function takeLegacyToken() {
	const token = incoming;
	incoming = null;
	return token;
}
