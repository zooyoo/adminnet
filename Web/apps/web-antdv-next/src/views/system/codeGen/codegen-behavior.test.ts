import type { TableUniqueConfigItem } from '#/api-services/models/table-unique-config-item';

import { describe, expect, it } from 'vitest';

import { changeCodeGenParent, createCodeGenDraft, fillCodeGenUniqueMessage, validateCodeGenDraft } from './codegen-model';

const columns = [
	{ propertyName: 'Code', columnComment: '业务编码' },
	{ propertyName: 'Name', columnComment: '业务名称' },
];
function validDraft() {
	return { ...createCodeGenDraft(), configId: 'test-db', tableName: 'Order', busName: '订单', nameSpace: 'App' };
}

describe('代码生成旧表单行为', () => {
	it('切换上级菜单用菜单名称覆盖目录，并保留其他配置与源选项', () => {
		const draft = validDraft();
		draft.pagePath = '手填旧目录';
		draft.menuIcon = 'ant-design:appstore-outlined';
		const menus = Object.freeze([{ id: 9, name: 'orders', title: '订单管理', path: '/business/orders' }]);
		changeCodeGenParent(draft, '9', menus);
		expect(draft).toMatchObject({ menuPid: 9, pagePath: 'orders', menuIcon: 'ant-design:appstore-outlined', tableName: 'Order' });
		expect(menus[0]).toMatchObject({ name: 'orders', path: '/business/orders' });
		expect(validateCodeGenDraft(draft)).toBe('');
	});
	it('顶级或无名称菜单不沿用上一个目录，要求补填后再保存', () => {
		const draft = validDraft();
		changeCodeGenParent(draft, 0, [{ id: 9, name: 'orders' }]);
		expect(draft.pagePath).toBe('');
		expect(validateCodeGenDraft(draft)).toContain('菜单页面目录');
		draft.pagePath = '手填目录';
		changeCodeGenParent(draft, 9, [{ id: 9, name: null }]);
		expect(draft.pagePath).toBe('');
	});
	it('选单字段以字段说明补全空提示，使草稿通过真实保存前校验', () => {
		const draft = validDraft();
		const constraint: TableUniqueConfigItem = { columns: ['Code'], message: '' };
		draft.tableUniqueList.push(constraint);
		expect(validateCodeGenDraft(draft)).toContain('校验提示');
		fillCodeGenUniqueMessage(constraint, constraint.columns, columns);
		expect(constraint.message).toBe('业务编码');
		expect(validateCodeGenDraft(draft)).toBe('');
		constraint.columns = ['Name'];
		constraint.message = '名称已经存在，请使用其他名称';
		fillCodeGenUniqueMessage(constraint, constraint.columns, columns);
		expect(constraint.message).toBe('名称已经存在，请使用其他名称');
	});
	it('复合、清空、未知字段和缺失说明均不凭空生成提示', () => {
		for (const selected of [['Code', 'Name'], [], ['Unknown']]) {
			const constraint: TableUniqueConfigItem = { columns: selected, message: '' };
			fillCodeGenUniqueMessage(constraint, selected, columns);
			expect(constraint.message).toBe('');
		}
		const constraint: TableUniqueConfigItem = { columns: ['Code'], message: '' };
		fillCodeGenUniqueMessage(constraint, ['Code'], [{ propertyName: 'Code', columnComment: null }]);
		expect(constraint.message).toBe('');
	});
});
