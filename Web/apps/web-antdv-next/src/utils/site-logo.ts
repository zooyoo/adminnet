import { useAppConfig } from '@vben/hooks';

import { noticeResourceUrl } from '#/components/notice-editor/resource-url';

export function siteLogoUrl(value?: string) {
	const fallback = `${import.meta.env.BASE_URL}logo.png`;
	if (!value || value === '/logo.png') return fallback;
	try {
		const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
		return noticeResourceUrl(value, apiURL, window.location.origin);
	} catch {
		return fallback;
	}
}
