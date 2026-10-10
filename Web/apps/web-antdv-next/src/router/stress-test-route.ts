import type { RouteRecordStringComponent } from '@vben/types';

export const STRESS_TEST_ROUTE = '/system/stressTest';
export const STRESS_TEST_LEGACY_ROUTES = ['/platform/stressTest', '/develop/stressTest'] as const;

// 后端菜单继续使用旧页面组件名，只在本模块补齐稳定入口与旧链接。
export function normalizeStressTestMenu(route: RouteRecordStringComponent): RouteRecordStringComponent {
	const component = typeof route.component === 'string' ? route.component.replace(/^\//, '').replace(/\.vue$/, '') : '';
	if (!['platform/stressTest/index', 'system/stressTest/index'].includes(component)) return route;
	const originalAliases = Array.isArray(route.alias) ? route.alias : route.alias ? [route.alias] : [];
	return {
		...route,
		path: STRESS_TEST_ROUTE,
		component: '/system/stressTest/index',
		alias: [...new Set([...originalAliases, ...STRESS_TEST_LEGACY_ROUTES, route.path])].filter((alias) => alias !== STRESS_TEST_ROUTE),
	};
}
