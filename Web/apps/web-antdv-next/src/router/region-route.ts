import type { RouteRecordStringComponent } from '@vben/types';

export const REGION_PATH = '/system/region';
export const REGION_ALIAS = '/platform/region';

export function normalizeRegionMenu(route: RouteRecordStringComponent): RouteRecordStringComponent {
	const component = String(route.component ?? '')
		.replace(/^\/+/, '')
		.replace(/\.vue$/, '');
	if (!['platform/region/index', 'system/region/index'].includes(component) && ![REGION_ALIAS, REGION_PATH].includes(route.path)) return route;
	const aliases = Array.isArray(route.alias) ? route.alias : route.alias ? [route.alias] : [];
	return { ...route, path: REGION_PATH, alias: [...new Set([REGION_ALIAS, route.path, ...aliases])].filter((path) => path !== REGION_PATH), component: '/system/region/index' };
}
