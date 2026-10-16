import { shallowRef } from 'vue';

import { updatePreferences } from '@vben/preferences';

import { siteLogoUrl } from './site-logo';

interface SiteBrand {
	title?: string;
	logo?: string;
	viceTitle?: string;
	viceDesc?: string;
	copyright?: string;
	icp?: string;
	icpUrl?: string;
}

export const siteBrand = shallowRef<SiteBrand>({});

export function applySiteBrand(value: SiteBrand = {}) {
	const brand = { ...value };
	try {
		const url = new URL(brand.icpUrl || 'https://beian.miit.gov.cn/');
		brand.icpUrl = ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
	} catch {
		brand.icpUrl = undefined;
	}
	siteBrand.value = brand;
	const logo = siteLogoUrl(brand.logo);
	const favicon = document.querySelector<HTMLLinkElement>('link[rel~="icon"]') ?? document.createElement('link');
	favicon.rel = 'icon';
	favicon.href = brand.logo ? logo : 'data:;base64,=';
	if (!favicon.isConnected) document.head.append(favicon);
	updatePreferences({ app: { name: brand.title || 'Admin.NET' }, logo: { source: logo, sourceDark: logo } });
}
