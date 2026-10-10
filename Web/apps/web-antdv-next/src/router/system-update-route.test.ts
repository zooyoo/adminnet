import type { RouteRecordStringComponent } from '@vben/types';

import { describe, expect, it } from 'vitest';

import { normalizeStressTestMenu } from './stress-test-route';
import { normalizeSystemUpdateMenu } from './system-update-route';

function route(patch: Partial<RouteRecordStringComponent> = {}): RouteRecordStringComponent {
	return { name: 'SystemUpdate', path: '/system/update', component: '/system/update/index', meta: { title: '系统更新', keepAlive: true }, ...patch };
}

describe('系统更新菜单映射', () => {
	it('保留 canonical 和原动态菜单 Component，并提供平台别名', () => {
		const actual = normalizeSystemUpdateMenu(route());
		expect(actual.path).toBe('/system/update');
		expect(actual.component).toBe('/system/update/index');
		expect(actual.alias).toEqual(['/platform/update']);
		expect(actual.meta).toEqual({ title: '系统更新', keepAlive: true });
	});
	it('平台菜单映射到独立页面并保留旧路径', () => {
		expect(normalizeSystemUpdateMenu(route({ path: '/platform/update', component: 'platform/update/index' }))).toMatchObject({ path: '/system/update', component: '/system/update/index', alias: ['/platform/update'] });
	});
	it('保留额外 alias 并去重', () => {
		const actual = normalizeSystemUpdateMenu(route({ alias: ['/platform/update', '/legacy/update', '/system/update', '/legacy/update'] }));
		expect(actual.alias).toEqual(['/platform/update', '/legacy/update']);
	});
	it('支持字符串 alias 和不带前导斜线的系统 Component', () => {
		const actual = normalizeSystemUpdateMenu(route({ component: 'system/update/index', path: '/operations/update', alias: '/legacy/update' }));
		expect(actual.alias).toHaveLength(3);
		expect(actual.alias).toEqual(expect.arrayContaining(['/platform/update', '/operations/update', '/legacy/update']));
	});
	it('其他模块和已有 stress-test 归一化保持兼容', () => {
		const unrelated = route({ path: '/system/user', component: '/system/user/index' });
		expect(normalizeSystemUpdateMenu(unrelated)).toBe(unrelated);
		const stress = route({ path: '/platform/stressTest', component: '/system/stressTest/index' });
		const actual = normalizeSystemUpdateMenu(normalizeStressTestMenu(stress));
		expect(actual.path).toBe('/system/stressTest');
		expect(actual.component).toBe('/system/stressTest/index');
		expect(actual.alias).toContain('/platform/stressTest');
	});
	it('重复归一化结果稳定', () => {
		const once = normalizeSystemUpdateMenu(route());
		expect(normalizeSystemUpdateMenu(once)).toEqual(once);
	});
});
