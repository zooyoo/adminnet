/** 运行时地址表示 API 挂载根目录，业务端点自行携带 /api。 */
export function normalizeApiUrl(value: string): string {
	const base = value.trim();
	if (!base || base === '/') return '';
	if (/[\\\s]/u.test(base)) throw new Error('API 地址格式无效');
	if (/^https?:\/\//iu.test(base) || base.startsWith('//')) {
		const url = new URL(base.startsWith('//') ? `https:${base}` : base);
		if (url.username || url.password || url.search || url.hash) throw new Error('API 地址只能包含服务地址和挂载路径');
		const path = url.pathname.replace(/\/+$/u, '');
		return base.startsWith('//') ? `//${url.host}${path}` : `${url.origin}${path}`;
	}
	if (/^[a-z][a-z\d+.-]*:/iu.test(base) || /[?#]/u.test(base)) throw new Error('API 地址格式无效');
	return `/${base.replace(/^\/+|\/+$/gu, '')}`;
}
