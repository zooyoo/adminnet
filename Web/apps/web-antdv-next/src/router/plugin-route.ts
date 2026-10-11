import type { RouteRecordStringComponent } from '@vben/types';

export function normalizePluginMenu(route: RouteRecordStringComponent): RouteRecordStringComponent {
	const component = String(route.component ?? '')
		.replace(/^\/+/, '')
		.replace(/\.vue$/, '');
	if (!['platform/plugin/index', 'system/plugin/index'].includes(component) && !['/platform/plugin', '/system/plugin'].includes(route.path)) return route;
	const aliases = Array.isArray(route.alias) ? route.alias : route.alias ? [route.alias] : [];
	return {
		...route,
		path: '/system/plugin',
		alias: [...new Set(['/platform/plugin', route.path, ...aliases])].filter((value) => value !== '/system/plugin'),
		component: !route.component || component === 'platform/plugin/index' ? '/system/plugin/index' : route.component,
	};
}
