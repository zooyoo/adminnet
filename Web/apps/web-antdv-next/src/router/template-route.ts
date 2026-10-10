import type { RouteRecordStringComponent } from '@vben/types';

export const TEMPLATE_PATH = '/system/template';
export const TEMPLATE_ALIAS = '/platform/template';

export function normalizeTemplateMenu(route: RouteRecordStringComponent): RouteRecordStringComponent {
	const component = String(route.component ?? '')
		.replace(/^\/+/, '')
		.replace(/\.vue$/, '');
	if (!['platform/template/index', 'system/template/index'].includes(component) && ![TEMPLATE_ALIAS, TEMPLATE_PATH].includes(route.path)) return route;
	const aliases = Array.isArray(route.alias) ? route.alias : route.alias ? [route.alias] : [];
	return {
		...route,
		path: TEMPLATE_PATH,
		alias: [...new Set([route.path, TEMPLATE_ALIAS, ...aliases])].filter((path) => path !== TEMPLATE_PATH),
		component: route.component ?? '/system/template/index',
	};
}
