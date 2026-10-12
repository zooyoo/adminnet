import type { AdminColumn } from './column-settings';

import { describe, expect, it } from 'vitest';

import { canMoveColumnSetting, columnSettings, configuredColumns, moveColumnSetting } from './column-settings';

const columns: AdminColumn[] = [
	{ key: 'property', title: '属性', fixed: 'start' },
	{ key: 'metadata', title: '字段信息', children: [{ key: 'description', title: '描述' }, { key: 'type', title: '类型' }] },
	{ key: 'query', title: '查询', children: [{ key: 'enabled', title: '启用' }, { key: 'operator', title: '方式' }] },
	{ key: 'order', title: '排序', fixed: 'end' },
];

describe('公共表格分组列设置', () => {
	it('设置项只包含叶子列且保留归属与固定位置', () => {
		const settings = columnSettings(columns);
		expect(settings.map((item) => item.key)).toEqual(['property', 'description', 'type', 'enabled', 'operator', 'order']);
		expect(settings[1]?.parent).toBe('metadata');
		expect(settings[0]?.fixed).toBe('start');
		expect(settings.at(-1)?.fixed).toBe('end');
	});
	it('隐藏全部子列后移除空表头，其他分组继续保留', () => {
		const visible = configuredColumns(columns, ['description', 'type'], [], {});
		expect(visible.map((item) => item.key)).toEqual(['property', 'query', 'order']);
		expect(columns).toHaveLength(4);
	});
	it('允许同组移动叶子列并保持多级表头', () => {
		const settings = columnSettings(columns);
		const order = moveColumnSetting(settings, 'type', -1);
		const visible = configuredColumns(columns, [], order, {});
		const group = visible[1];
		expect(group && 'children' in group ? group.children?.map((item) => item.key) : []).toEqual(['type', 'description']);
	});
	it('阻止跨组移动以避免拆散表头', () => {
		const settings = columnSettings(columns);
		expect(canMoveColumnSetting(settings, 3, -1)).toBe(false);
		expect(moveColumnSetting(settings, 'enabled', -1)).toEqual(settings.map((item) => item.key));
	});
	it('叶子固定位置可覆盖且不修改传入的列定义', () => {
		const visible = configuredColumns(columns, [], [], { order: false, property: 'end' });
		expect(visible[0]?.fixed).toBe('end');
		expect(visible.at(-1)?.fixed).toBe(false);
		expect(columns[0]?.fixed).toBe('start');
	});
	it('兼容旧左右固定值及分组继承', () => {
		const settings = columnSettings([{ key: 'group', fixed: 'left', children: [{ key: 'one' }] }, { key: 'two', fixed: 'right' }]);
		expect(settings.map((item) => item.fixed)).toEqual(['start', 'end']);
	});
});
