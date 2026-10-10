import type { RouteRecordStringComponent } from '@vben/types';

export const OPEN_ACCESS_PATH = '/system/openAccess';
export const OPEN_ACCESS_ALIAS = '/platform/openAccess';

export function normalizeOpenAccessMenu(route: RouteRecordStringComponent): RouteRecordStringComponent {
	const component = String(route.component ?? '').replace(/^\//, '');
	if (!['platform/openAccess/index', 'system/openAccess/index'].includes(component)) return route;
	const existing = Array.isArray(route.alias) ? route.alias : route.alias ? [route.alias] : [];
	const paths = [route.path, OPEN_ACCESS_ALIAS, ...existing];
	const alias = [...new Set(paths)].filter((path) => path && path !== OPEN_ACCESS_PATH);
	return { ...route, path: OPEN_ACCESS_PATH, alias, component: '/system/openAccess/index' };
}
