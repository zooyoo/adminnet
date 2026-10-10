import type { RouteRecordStringComponent } from '@vben/types';

import { describe, expect, it } from 'vitest';

import { normalizeRegionMenu, REGION_ALIAS, REGION_PATH } from './region-route';

const menu = (path: string, component: string, alias?: string | string[]): RouteRecordStringComponent => ({
	path,
	component,
	name: 'sysRegion',
	meta: { title: '区域管理', keepAlive: true },
	...(alias ? { alias } : {}),
});

describe('区域菜单兼容', () => {
	it.each(['/system/region/index', 'system/region/index', '/platform/region/index', 'platform/region/index.vue'])('将组件 %s 归一化并保留旧地址', (component) => {
		expect(normalizeRegionMenu(menu(REGION_ALIAS, component))).toMatchObject({
			path: REGION_PATH,
			component: '/system/region/index',
			alias: [REGION_ALIAS],
			meta: { title: '区域管理', keepAlive: true },
		});
	});
	it('标准地址也注册 platform alias，并对旧地址和已有 aliases 去重', () => {
		expect(normalizeRegionMenu(menu('/legacy-region', '/system/region/index', ['/legacy-region', REGION_ALIAS, REGION_PATH, '/kept']))).toMatchObject({
			path: REGION_PATH,
			alias: [REGION_ALIAS, '/legacy-region', '/kept'],
		});
		expect(normalizeRegionMenu(menu(REGION_PATH, '/system/region/index')).alias).toEqual([REGION_ALIAS]);
	});
	it('保留 string alias，支持只带旧 path 的菜单', () => {
		expect(normalizeRegionMenu(menu(REGION_ALIAS, '', '/kept'))).toMatchObject({ component: '/system/region/index', alias: [REGION_ALIAS, '/kept'] });
	});
	it('不影响其他已迁移模块', () => {
		const unrelated = menu('/platform/openAccess', '/system/openAccess/index');
		expect(normalizeRegionMenu(unrelated)).toBe(unrelated);
	});
});
