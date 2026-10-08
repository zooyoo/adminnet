export function safeRedirect(value: unknown, fallback = '/home'): string {
	if (typeof value !== 'string') return fallback;
	try {
		const path = decodeURIComponent(value);
		if (!path.startsWith('/') || path.startsWith('//') || /[\\\u0000-\u001F]/.test(path)) return fallback;
		const pathname = path.split(/[?#]/, 1)[0];
		if (pathname === '/login' || pathname === '/auth' || pathname?.startsWith('/auth/')) return fallback;
		return path;
	} catch {
		return fallback;
	}
}
