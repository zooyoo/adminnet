import { describe, expect, it } from 'vitest';

import { normalizeTemplateMenu } from './template-route';

describe('模板菜单归一化', () => {
	it('旧路由保持组件、元数据与额外别名，统一到 canonical 路由', () => {
		const result = normalizeTemplateMenu({
			path: '/platform/template',
			name: 'template',
			component: '/system/template/index',
			alias: ['/custom/template', '/system/template'],
			meta: { title: '模板管理', keepAlive: true },
		});
		expect(result.path).toBe('/system/template');
		expect(result.component).toBe('/system/template/index');
		expect(result.alias).toEqual(['/platform/template', '/custom/template']);
		expect(result.meta).toEqual({ title: '模板管理', keepAlive: true });
	});
	it('通过组件发现旧路由并保留原路径别名', () => {
		expect(normalizeTemplateMenu({ path: '/legacy/templates', name: 'templates', component: '/system/template/index.vue', alias: '/custom/template' })).toMatchObject({
			path: '/system/template',
			component: '/system/template/index.vue',
			alias: expect.arrayContaining(['/platform/template', '/legacy/templates', '/custom/template']),
		});
	});
	it('canonical 重复归一化不叠加别名，并保留特殊组件', () => {
		const initial = { path: '/system/template', name: 'templates', component: '/custom/template-editor', alias: ['/platform/template', '/extra', '/extra'] };
		const result = normalizeTemplateMenu(initial);
		expect(normalizeTemplateMenu(result)).toEqual(result);
		expect(result.component).toBe('/custom/template-editor');
		expect(result.alias).toEqual(['/platform/template', '/extra']);
	});
	it('未匹配路由原样返回', () => {
		const other = { path: '/system/region', name: 'regions', component: '/system/region/index' };
		expect(normalizeTemplateMenu(other)).toBe(other);
	});
});
