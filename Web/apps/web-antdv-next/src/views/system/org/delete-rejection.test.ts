/* eslint-disable vue/one-component-per-file -- 测试在同一文件提供独立组件替身。 */
import type { Mock } from 'vitest';

import type { PropType, Ref } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';

import { Button, message, Popconfirm } from 'antdv-next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import PositionPage from '../pos/index.vue';
import OrgPage from './index.vue';

interface MockRow {
	id: number;
	name: string;
	code: string;
	status: number;
	tenantId: number;
}
interface MockTable {
	items: Ref<MockRow[]>;
	query: Ref<{ page: number; pageSize: number }>;
	page: Ref<number>;
	pageSize: Ref<number>;
	total: Ref<number>;
	loading: Ref<boolean>;
	error: Ref<string>;
	search: Mock<() => Promise<void>>;
	reload: Mock<() => Promise<void>>;
}

const mocks = vi.hoisted(() => ({
	removeOrg: vi.fn(),
	deletePosition: vi.fn(),
	boundary: { version: 1 },
	tables: [] as MockTable[],
	row: { id: 101, name: '保留记录', code: 'retained', status: 1, tenantId: 1 },
}));

vi.mock('antdv-next', async () => {
	const [{ default: RealButton }, { default: RealPopconfirm }, { default: RealAlert }, { defineComponent, h }] = await Promise.all([
		import('antdv-next/dist/button/index'),
		import('antdv-next/dist/popconfirm/index'),
		import('antdv-next/dist/alert/index'),
		import('vue'),
	]);
	const passive = defineComponent({
		setup:
			(_, { slots }) =>
			() =>
				h('div', slots.default?.()),
	});
	return {
		...Object.fromEntries(
			[
				'Form',
				'FormItem',
				'Input',
				'InputNumber',
				'Select',
				'Splitter',
				'SplitterPanel',
				'Tooltip',
				'Tree',
				'Tag',
				'Modal',
				'Popover',
				'Descriptions',
				'DescriptionsItem',
				'RadioGroup',
				'Table',
				'TextArea',
			].map((name) => [name, passive])
		),
		Button: RealButton,
		Popconfirm: RealPopconfirm,
		Alert: RealAlert,
		message: { success: vi.fn() },
	};
});
vi.mock('@vben/access', () => ({ useAccess: () => ({ hasAccessByCodes: () => true }) }));
vi.mock('@vben/stores', () => ({ useUserStore: () => ({ userInfo: { accountType: 777 } }) }));
vi.mock('@vben/icons', () => ({ Copy: 'span', Plus: 'span', Search: 'span', createIconifyIcon: () => 'span' }));
vi.mock('@vueuse/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@vueuse/core')>()), useMediaQuery: () => false }));
vi.mock('#/api', () => ({ getTenantOptionsApi: vi.fn().mockResolvedValue([]) }));
vi.mock('#/api/session', () => ({ sessionBoundary: mocks.boundary }));
vi.mock('#/api/system/access-admin', () => ({
	orgList: vi.fn().mockResolvedValue([mocks.row]),
	orgTree: vi.fn().mockResolvedValue([mocks.row]),
	removeOrg: mocks.removeOrg,
}));
vi.mock('#/api/system/pos', () => ({ deletePosition: mocks.deletePosition, listPositions: vi.fn().mockResolvedValue([mocks.row]), savePosition: vi.fn() }));
vi.mock('#/store/reference', () => ({ useReferenceStore: () => ({ load: vi.fn().mockResolvedValue(undefined), options: () => [], label: () => '' }) }));
vi.mock('#/components/admin/audit-record.vue', () => ({ default: { template: '<span />' } }));
vi.mock('#/components/admin/tenant-select.vue', () => ({ default: { template: '<span />' } }));
vi.mock('./component/org-editor.vue', () => ({ default: { template: '<span />' } }));
vi.mock('#/components/admin-table/use-admin-table', async () => {
	const { ref } = await import('vue');
	return {
		useAdminTable: () => {
			const table = {
				items: ref([mocks.row]),
				query: ref({ page: 1, pageSize: 10 }),
				page: ref(1),
				pageSize: ref(10),
				total: ref(1),
				loading: ref(false),
				error: ref(''),
				search: vi.fn().mockResolvedValue(undefined),
				reload: vi.fn().mockResolvedValue(undefined),
			};
			mocks.tables.push(table);
			return table;
		},
	};
});
vi.mock('#/components/admin-table/index.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		default: defineComponent({
			props: { controller: { type: Object as PropType<MockTable>, required: true } },
			setup(props, { slots }) {
				return () =>
					h(
						'section',
						props.controller.items.value.map((record: typeof mocks.row) => h('div', { 'data-row-id': record.id }, [record.name, slots.bodyCell?.({ column: { key: 'actions' }, record, index: 0 })]))
					);
			},
		}),
	};
});

const wrappers: ReturnType<typeof mount>[] = [];
const escaped: unknown[] = [];
const captureRejection = (error: unknown) => escaped.push(error);
const passthrough = { template: '<div><slot /></div>' };
const stubs = Object.fromEntries(
	[
		'Form',
		'FormItem',
		'Input',
		'InputNumber',
		'Select',
		'Splitter',
		'SplitterPanel',
		'Tooltip',
		'Tree',
		'Tag',
		'Modal',
		'Popover',
		'Descriptions',
		'DescriptionsItem',
		'RadioGroup',
		'Table',
		'TextArea',
	].map((name) => [name, passthrough])
);

function deferred() {
	let resolve!: () => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<void>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

async function settle() {
	await flushPromises();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
	await flushPromises();
}

async function openPage(page: typeof OrgPage | typeof PositionPage) {
	const wrapper = mount(page, { attachTo: document.body, global: { stubs, config: { errorHandler: captureRejection } } });
	wrappers.push(wrapper);
	await settle();
	const table = mocks.tables.at(-1)!;
	table.reload.mockClear();
	table.search.mockClear();
	await wrapper.find('[aria-label^="删除"]').trigger('click');
	await settle();
	return { wrapper, table };
}

function popup() {
	const element = document.querySelector<HTMLElement>('.ant-popconfirm:not(.ant-popover-hidden)');
	expect(element, '真实 Popconfirm 应保持可见').not.toBeNull();
	return element!;
}

function confirm() {
	const button = popup().querySelector<HTMLButtonElement>('.ant-popconfirm-buttons .ant-btn-primary');
	expect(button).not.toBeNull();
	button!.click();
}

beforeEach(() => {
	mocks.removeOrg.mockReset();
	mocks.deletePosition.mockReset();
	mocks.tables.length = 0;
	mocks.boundary.version = 1;
	escaped.length = 0;
	vi.mocked(message.success).mockReset();
	process.on('unhandledRejection', captureRejection);
});
afterEach(() => {
	for (const wrapper of wrappers.splice(0)) wrapper.unmount();
	document.body.innerHTML = '';
	process.off('unhandledRejection', captureRejection);
	vi.restoreAllMocks();
});

// API 与列表是 Mock 契约；生产 SFC、Popconfirm、ActionButton 和 Button 使用真实实现。此测试不声称 PostgreSQL 验收。
describe('删除拒绝的真实 Popconfirm 与生产 callback 边界（Mock API 契约）', () => {
	it.each([
		{ name: '机构直属用户', page: OrgPage, api: mocks.removeOrg, error: '[D2004] 该机构下有用户禁止删除' },
		{ name: '机构附属用户', page: OrgPage, api: mocks.removeOrg, error: '[D2005] 附属机构下有用户禁止删除' },
		{ name: '机构下级用户', page: OrgPage, api: mocks.removeOrg, error: '[D2007] 下级机构下有用户禁止删除' },
		{ name: '职位在职用户', page: PositionPage, api: mocks.deletePosition, error: '[D6001] 该职位下有用户禁止删除' },
	])('$name 拒绝没有外溢，保留行与同一确认框并可重试、取消', async ({ page, api, error }) => {
		const pending = deferred();
		api.mockReturnValueOnce(pending.promise).mockRejectedValue(new Error(error));
		const { wrapper, table } = await openPage(page);
		const originalRows = table.items.value;
		confirm();
		confirm();
		await settle();
		expect(api).toHaveBeenCalledTimes(1);
		expect(popup().querySelector('.ant-btn-primary')?.classList.contains('ant-btn-loading')).toBe(true);
		const pendingCancel = [...popup().querySelectorAll<HTMLButtonElement>('button')].find((button) => !button.classList.contains('ant-btn-primary'))!;
		expect(pendingCancel.disabled).toBe(true);
		pendingCancel.click();
		expect(wrapper.findComponent(Popconfirm).props('open')).toBe(true);
		pending.reject(new Error(error));
		await settle();
		expect(
			escaped.map((cause) => (cause instanceof Error ? cause.message : String(cause))),
			'业务拒绝不得进入 Vue/window/未处理 Promise'
		).toEqual([]);
		expect(table.items.value).toBe(originalRows);
		expect(wrapper.find('[data-row-id="101"]').text()).toContain('保留记录');
		expect(table.reload).not.toHaveBeenCalled();
		expect(table.search).not.toHaveBeenCalled();
		expect(message.success).not.toHaveBeenCalled();
		expect(popup().textContent).toContain(error);
		expect(popup().querySelector('.ant-btn-primary')?.classList.contains('ant-btn-loading')).toBe(false);
		confirm();
		await settle();
		expect(api).toHaveBeenCalledTimes(2);
		expect(escaped).toEqual([]);
		expect(popup().textContent).toContain(error);
		const cancel = [...popup().querySelectorAll<HTMLButtonElement>('button')].find((button) => !button.classList.contains('ant-btn-primary'));
		expect(cancel!.disabled).toBe(false);
		cancel!.click();
		await settle();
		expect(api).toHaveBeenCalledTimes(2);
		expect(wrapper.findComponent(Popconfirm).props('open')).toBe(false);
		expect(wrapper.findComponent(Button).exists()).toBe(true);
	});

	it.each([
		{ name: '机构', page: OrgPage, api: mocks.removeOrg },
		{ name: '职位', page: PositionPage, api: mocks.deletePosition },
	])('$name 拒绝后成功重试会关闭确认框并恢复原有刷新流程', async ({ page, api }) => {
		api.mockRejectedValueOnce(new Error('首次拒绝')).mockResolvedValueOnce(undefined);
		const { wrapper, table } = await openPage(page);
		confirm();
		await settle();
		expect(popup().textContent).toContain('首次拒绝');
		confirm();
		await settle();
		expect(api).toHaveBeenCalledTimes(2);
		expect(escaped).toEqual([]);
		expect(wrapper.findComponent(Popconfirm).props('open')).toBe(false);
		if (page === OrgPage) expect(table.search).toHaveBeenCalledOnce();
		else expect(table.reload).toHaveBeenCalledOnce();
	});

	it.each([
		{ name: '机构', page: OrgPage, api: mocks.removeOrg },
		{ name: '职位', page: PositionPage, api: mocks.deletePosition },
	])('$name 确认前取消不发删除请求', async ({ page, api }) => {
		const { wrapper } = await openPage(page);
		const cancel = [...popup().querySelectorAll<HTMLButtonElement>('button')].find((button) => !button.classList.contains('ant-btn-primary'));
		cancel!.click();
		await settle();
		expect(api).not.toHaveBeenCalled();
		expect(wrapper.findComponent(Popconfirm).props('open')).toBe(false);
	});

	it.each([
		{ name: '机构', page: OrgPage, api: mocks.removeOrg },
		{ name: '职位', page: PositionPage, api: mocks.deletePosition },
	])('$name 身份切换后的迟到拒绝没有错误提示、刷新或成功通知', async ({ page, api }) => {
		const pending = deferred();
		api.mockReturnValue(pending.promise);
		const { wrapper, table } = await openPage(page);
		confirm();
		await settle();
		mocks.boundary.version += 1;
		pending.reject(new Error('旧身份删除拒绝'));
		await settle();
		expect(escaped).toEqual([]);
		expect(table.reload).not.toHaveBeenCalled();
		expect(table.search).not.toHaveBeenCalled();
		expect(message.success).not.toHaveBeenCalled();
		expect(wrapper.findComponent(Popconfirm).props('open')).toBe(false);
		expect(wrapper.findComponent(Popconfirm).props('description')).toBe('');
	});

	it.each([
		{ name: '机构', page: OrgPage, api: mocks.removeOrg },
		{ name: '职位', page: PositionPage, api: mocks.deletePosition },
	])('$name 非 Error 拒绝仍有可靠提示并恢复按钮', async ({ name, page, api }) => {
		api.mockRejectedValue({ code: 'ERR_ADMIN_RESULT' });
		await openPage(page);
		confirm();
		await settle();
		expect(escaped).toEqual([]);
		expect(popup().textContent).toContain(`${name}删除失败，请重试`);
		expect(popup().querySelector('.ant-btn-primary')?.classList.contains('ant-btn-loading')).toBe(false);
	});

	it('职位删除成功仍按原有末页逻辑回退并重新加载', async () => {
		mocks.deletePosition.mockResolvedValue(undefined);
		const { wrapper, table } = await openPage(PositionPage);
		table.page.value = 2;
		table.total.value = 11;
		table.reload.mockImplementationOnce(async () => {
			table.total.value = 10;
		});
		confirm();
		await settle();
		expect(escaped).toEqual([]);
		expect(table.page.value).toBe(1);
		expect(table.reload).toHaveBeenCalledTimes(2);
		expect(message.success).toHaveBeenCalledWith('删除成功');
		expect(wrapper.findComponent(Popconfirm).props('open')).toBe(false);
	});
});
