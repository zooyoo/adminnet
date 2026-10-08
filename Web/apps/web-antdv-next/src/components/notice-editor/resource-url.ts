export function noticeResourceUrl(value: string, apiUrl: string, origin: string) {
	const source = value.trim();
	if (!source || source.includes('\\')) throw new Error('图片地址无效');
	if (/^https?:\/\//i.test(source) || source.startsWith('//')) {
		const url = new URL(source, origin);
		if (!['http:', 'https:'].includes(url.protocol)) throw new Error('图片地址无效');
		return url.href;
	}
	if (/^[a-z][a-z\d+.-]*:/i.test(source)) throw new Error('图片地址无效');
	const base = new URL(`${apiUrl.replace(/\/+$/, '')}/`, origin);
	if (!['http:', 'https:'].includes(base.protocol)) throw new Error('图片地址无效');
	const prefix = base.pathname.replace(/\/+$/, '');
	const path = source.startsWith(`${prefix}/`) ? source : `${prefix}/${source.replace(/^\/+/, '')}`;
	return new URL(path, base.origin).href;
}
