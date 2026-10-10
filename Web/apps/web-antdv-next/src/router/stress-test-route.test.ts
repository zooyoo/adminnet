import type { RouteRecordStringComponent } from '@vben/types';

import { describe, expect, it } from 'vitest';

import { normalizeStressTestMenu, STRESS_TEST_ROUTE } from './stress-test-route';

function menu(component: string, path = '/develop/stressTest'): RouteRecordStringComponent {
	return { name: 'SysStressTest', path, component, meta: { title: '接口压测' } };
}

describe('压测菜单入口兼容', () => {
	it.each(['/system/stressTest/index', 'system/stressTest/index.vue', '/platform/stressTest/index'])('旧组件 %s 解析到新页面', (component) => {
		const route = normalizeStressTestMenu(menu(component));
		expect(route.path).toBe(STRESS_TEST_ROUTE);
		expect(route.component).toBe('/system/stressTest/index');
		expect(route.alias).toEqual(['/platform/stressTest', '/develop/stressTest']);
		expect(route.name).toBe('SysStressTest');
		expect(route.meta?.title).toBe('接口压测');
	});

	it('保留既有 alias 和自定义旧路径，规范化可重复执行', () => {
		const original = { ...menu('/system/stressTest/index', '/custom/stress'), alias: '/previous/stress' };
		const route = normalizeStressTestMenu(original);
		expect(route.alias).toEqual(['/previous/stress', '/platform/stressTest', '/develop/stressTest', '/custom/stress']);
		expect(normalizeStressTestMenu(route)).toEqual(route);
		expect(original.path).toBe('/custom/stress');
	});

	it('其他菜单保持原对象及路径，不扩大兼容范围', () => {
		const original = menu('/system/server/index', '/platform/server');
		expect(normalizeStressTestMenu(original)).toBe(original);
	});
});
