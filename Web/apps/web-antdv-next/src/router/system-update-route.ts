import type { RouteRecordStringComponent } from '@vben/types';

export const SYSTEM_UPDATE_PATH = '/system/update';
export const SYSTEM_UPDATE_ALIAS = '/platform/update';

export function normalizeSystemUpdateMenu(route: RouteRecordStringComponent): RouteRecordStringComponent {
	const component = typeof route.component === 'string' ? route.component.replace(/^\/+/, '') : '';
	if (component !== 'system/update/index' && component !== 'platform/update/index') return route;
	const existing = typeof route.alias === 'string' ? [route.alias] : (route.alias ?? []);
	const alias = [...new Set([route.path, SYSTEM_UPDATE_ALIAS, ...existing])].filter((path) => path && path !== SYSTEM_UPDATE_PATH);
	return { ...route, path: SYSTEM_UPDATE_PATH, alias, component: '/system/update/index' };
}
