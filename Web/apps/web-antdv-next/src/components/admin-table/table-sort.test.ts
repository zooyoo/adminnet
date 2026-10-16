import { flushPromises, mount } from '@vue/test-utils';
import { defineComponent, h, nextTick, ref } from 'vue';

import { Table } from 'antdv-next';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import AdminTable from './index.vue';
import { controlledSortColumns, sorterState } from './table-sort';
import { useAdminTable } from './use-admin-table';
vi.mock('@vben/icons', async () => {
	const { h } = await import('vue');
	const icon = () => h('svg');
	return { ArrowDown: icon, ArrowUp: icon, RotateCw: icon, Settings: icon, createIconifyIcon: () => icon };
});
vi.mock('#/api/session', () => ({ sessionBoundary: { version: 0, track: () => undefined, release: () => undefined } }));
vi.mock('./table-output', () => ({ exportTablePdf: vi.fn(), exportWorkbook: vi.fn(), printTable: vi.fn(), tableMatrix: vi.fn() }));
const mounted: Array<ReturnType<typeof mount>> = [];
afterEach(() => {
	for (const wrapper of mounted.splice(0)) wrapper.unmount();
	document.body.innerHTML = '';
});
beforeAll(() => {
	window.matchMedia = vi
		.fn()
		.mockImplementation(() => ({ matches: false, media: '', addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn() }));
});
async function settle() {
	await flushPromises();
	await nextTick();
}
function fixture() {
	const calls: Array<Record<string, unknown>> = [];
	const columns = ref([
		{
			title: '分组',
			key: 'group',
			fixed: 'left' as const,
			children: [
				{ title: '线程', dataIndex: 'ThreadId', sorter: true },
				{ title: '账号', dataIndex: 'account' },
			],
		},
	]);
	let controller: ReturnType<typeof useAdminTable<Record<string, unknown>, { account: string }>>;
	const App = defineComponent({
		setup() {
			controller = useAdminTable<Record<string, unknown>, { account: string }>({
				query: { account: 'owned' },
				load: async (query) => {
					calls.push({ ...query });
					return { total: 80, items: [{ id: 1, ThreadId: 5, account: 'owned' }] };
				},
			});
			void controller.reload();
			return () => h('div', [h('button', { class: 'reset-test', onClick: () => controller.reset() }, '重置'), h(AdminTable, { controller, columns: columns.value, rowKey: 'id', selection: true })]);
		},
	});
	const wrapper = mount(App, { attachTo: document.body });
	mounted.push(wrapper);
	return { wrapper, calls, columns, controller: () => controller! };
}
describe('真实 Table 1.5.2 的受控排序', () => {
	it('表头排序后重置，再点击下一页发送第 2 页且不恢复旧排序', async () => {
		const f = fixture();
		await settle();
		const header = f.wrapper.findAll('th').find((node) => node.text().includes('线程') && node.find('.ant-table-column-sorters').exists())!;
		await header.find('.ant-table-column-sorters').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ page: 1, field: 'ThreadId', order: 'ascending', account: 'owned' });
		await f.wrapper.find('.reset-test').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ page: 1, field: undefined, order: undefined, account: 'owned' });
		expect(f.wrapper.findAll('.ant-table-column-sorter-up.active')).toHaveLength(0);
		await f.wrapper.find('.ant-pagination-next button').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ page: 2, field: undefined, order: undefined, account: 'owned' });
		expect(f.controller().selectedKeys.value).toEqual([]);
	});
	it('保持 Asc/Desc/无排序、字段大小写和排序状态下的第 2 页', async () => {
		const f = fixture();
		await settle();
		const header = f.wrapper.findAll('th').find((node) => node.text().includes('线程') && node.find('.ant-table-column-sorters').exists())!;
		await header.find('.ant-table-column-sorters').trigger('click');
		await settle();
		await header.find('.ant-table-column-sorters').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ field: 'ThreadId', order: 'descending', page: 1 });
		await f.wrapper.find('.ant-pagination-next button').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ field: 'ThreadId', order: 'descending', page: 2 });
		await header.find('.ant-table-column-sorters').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ field: undefined, order: undefined, page: 1 });
		await f.wrapper.find('.ant-pagination-next button').trigger('click');
		await settle();
		expect(f.calls.at(-1)).toMatchObject({ field: undefined, order: undefined, page: 2 });
	});
	it('父 columns 响应式更新、多层表头和固定列保持，空列没有排序', async () => {
		const f = fixture();
		await settle();
		const before = f.columns.value;
		f.columns.value = [
			{
				title: '新分组',
				key: 'new',
				fixed: 'left',
				children: [
					{ title: '线程新标题', dataIndex: 'ThreadId', sorter: true },
					{ title: '新账号', dataIndex: 'account' },
				],
			},
		];
		await settle();
		expect(f.wrapper.text()).toContain('线程新标题');
		expect(f.wrapper.findComponent(Table).props('columns')?.[0]?.fixed).toBe('left');
		expect(before[0]!.children[0]!).not.toHaveProperty('sortOrder');
		f.columns.value = [];
		await settle();
		expect(f.wrapper.findComponent(Table).props('columns')).toEqual([]);
		expect(sorterState({})).toEqual({ field: undefined, order: null });
	});
});
describe('排序输入合同', () => {
	it('array dataIndex 明确按点连接，columnKey 后备，无排序不保 field', () => {
		expect(sorterState({ field: ['Nested', 'ThreadId'], columnKey: 'override', order: 'ascend' })).toEqual({ field: 'Nested.ThreadId', order: 'ascend' });
		expect(sorterState({ columnKey: 'ExplicitKey', order: 'descend' })).toEqual({ field: 'ExplicitKey', order: 'descend' });
		expect(sorterState([])).toEqual({ field: undefined, order: null });
		expect(sorterState({ field: 'ThreadId', order: null })).toEqual({ field: undefined, order: null });
	});
	it('单排序合同只对一个可排序叶子设 order，保留多级/标题/selection 所用属性', () => {
		const original = [
			{
				title: '父',
				fixed: 'left' as const,
				children: [
					{ title: '子', key: 'alias', dataIndex: ['Nested', 'ThreadId'], sorter: true },
					{ title: '同字段', dataIndex: ['Nested', 'ThreadId'], sorter: true },
					{ title: '普通', dataIndex: 'x' },
				],
			},
		];
		const columns = controlledSortColumns<Record<string, unknown>>(original, 'Nested.ThreadId', 'descending');
		const group = columns[0];
		if (!group || !('children' in group) || !group.children) throw Error('group expected');
		expect(group.children.map((column) => ('sortOrder' in column ? column.sortOrder : undefined))).toEqual(['descend', null, undefined]);
		expect(columns[0]!.fixed).toBe('left');
		expect(original[0]!.children[0]).not.toHaveProperty('sortOrder');
		expect(controlledSortColumns([], undefined, undefined)).toEqual([]);
	});
});
