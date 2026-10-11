import { expect, it } from 'vitest';

import { normalizePluginMenu } from './plugin-route';

it('转换旧插件地址和组件并保留自定义别名', () => {
	const route = normalizePluginMenu({ name: 'plugin', path: '/platform/plugin', component: '/platform/plugin/index.vue', alias: '/custom/plugins' });
	expect(route).toMatchObject({ path: '/system/plugin', component: '/system/plugin/index', alias: ['/platform/plugin', '/custom/plugins'] });
	expect(normalizePluginMenu(route)).toEqual(route);
});
it('按旧组件定位时保留原路径与元数据', () => {
	const route = normalizePluginMenu({ name: 'plugin', path: '/legacy/plugin', component: '/system/plugin/index', meta: { title: '插件', keepAlive: true } });
	expect(route.alias).toContain('/legacy/plugin');
	expect(route.meta).toEqual({ title: '插件', keepAlive: true });
});
it('其他菜单保持原对象', () => {
	const route = { name: 'other', path: '/other', component: '/other/index' };
	expect(normalizePluginMenu(route)).toBe(route);
});
