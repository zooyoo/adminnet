export function safeRedirect(value: unknown, fallback = '/home'): string {
	if (typeof value !== 'string') return fallback;
	try {
		const path = decodeURIComponent(value);
		if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001F]/.test(path)) return fallback;
		const pathname = path.split(/[?#]/, 1)[0];
		if (pathname === '/login' || pathname === '/auth' || pathname?.startsWith('/auth/')) return fallback;
		// 已是本地路径时保留查询值的编码，避免把值中的 %26、%23 变成分隔符。
		return value.startsWith('/') ? value : path;
	} catch {
		return fallback;
	}
}
