/* eslint-disable vue/one-component-per-file -- 单文件内集中声明测试用组件替身。 */
import type { PropType, VNode } from 'vue';

import type { CodeGenRow } from '#/api/system/codegen';

import { createApp, h, nextTick, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import CodeGenPreview from './codegen-preview.vue';
import CodeGenIndex from './index.vue';

const mocks = vi.hoisted(() => ({ preview: vi.fn(), inspect: vi.fn(), generate: vi.fn(), zip: vi.fn(), add: vi.fn(), copy: vi.fn(), success: vi.fn() }));
vi.mock('@vben/stores', async () => {
	const { reactive } = await import('vue');
	const user = reactive({ userInfo: { userId: 1, tenantId: 10, currentTenantId: 10 } });
	const access = reactive({ accessCodes: ['sysMenu:list'] });
	return { useUserStore: () => user, useAccessStore: () => access };
});
vi.mock('@vueuse/core', async (importOriginal) => ({ ...(await importOriginal<typeof import('@vueuse/core')>()), useClipboard: () => ({ copy: mocks.copy }) }));
vi.mock('#/api/system/codegen', () => ({
	codegenApi: {
		preview: mocks.preview,
		inspectDirect: mocks.inspect,
		runDirect: mocks.generate,
		zip: mocks.zip,
		add: mocks.add,
		databases: async () => [{ configId: 'unit-db', dbType: 0, dbNickName: '测试库', connectionString: '' }],
		namespaces: async () => ['App'],
		menus: async () => [{ id: 9, name: 'orders', title: '订单管理' }],
		dictionaries: async () => [],
		constants: async () => [],
		options: async () => [],
		tables: async () => [{ tableName: 'unit_order', entityName: 'Order', tableComment: '订单' }],
		columns: async () => [{ propertyName: 'Code', columnComment: '业务编码' }],
	},
}));
vi.mock('#/api/system/print', () => ({ listPrintTemplates: async () => ({ items: [], total: 0 }) }));
vi.mock('#/components/admin-table/index.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		default: defineComponent({
			setup:
				(_, { slots }) =>
				() =>
					h('div', slots.toolbar?.()),
		}),
	};
});
vi.mock('#/components/admin-table/use-admin-table', async () => {
	const { ref } = await import('vue');
	return {
		useAdminTable: (options: { query: object }) => ({ query: ref(options.query), rows: ref([]), total: ref(0), selectedKeys: ref([]), reload: vi.fn(async () => {}), reset: vi.fn(), search: vi.fn() }),
	};
});
vi.mock('@vben/common-ui', async () => {
	const { cloneVNode, defineComponent, h } = await import('vue');
	return {
		IconPicker: defineComponent({
			props: { modelValue: { type: String, default: '' }, inputComponent: { type: Object as PropType<VNode>, required: true } },
			emits: ['update:modelValue'],
			setup:
				(props, { emit }) =>
				() =>
					h('div', [
						cloneVNode(props.inputComponent, { value: props.modelValue }),
						h('button', { type: 'button', onClick: () => emit('update:modelValue', 'ant-design:appstore-outlined') }, '选择测试图标'),
					]),
		}),
	};
});
vi.mock('#/api/request', () => ({ requestClient: { instance: { get: vi.fn() } } }));
vi.mock('#/api/file-response', () => ({ decodeFileResponse: vi.fn(), downloadFile: vi.fn() }));
vi.mock('#/api/session', () => ({ sessionBoundary: { version: 0, track: vi.fn(), release: vi.fn() } }));
vi.mock('../plugin/code-editor.vue', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		default: defineComponent({
			props: { value: { type: String, required: true }, disabled: Boolean },
			emits: ['update:value'],
			setup:
				(props, { emit }) =>
				() =>
					h('textarea', {
						value: props.value,
						disabled: props.disabled,
						'aria-label': '本地预览编辑器',
						onInput: (event: Event) => {
							if (event.target instanceof HTMLTextAreaElement) emit('update:value', event.target.value);
						},
					}),
		}),
	};
});
vi.mock('antdv-next', async () => {
	const { defineComponent, h } = await import('vue');
	return {
		message: { success: mocks.success },
		Form: defineComponent({
			emits: ['finish'],
			setup:
				(_, { emit, slots }) =>
				() =>
					h(
						'form',
						{
							onSubmit: (event: Event) => {
								event.preventDefault();
								emit('finish');
							},
						},
						slots.default?.()
					),
		}),
		FormItem: defineComponent({
			props: { label: { type: String, default: '' } },
			setup:
				(props, { slots }) =>
				() =>
					h('label', [props.label, slots.default?.()]),
		}),
		Input: defineComponent({
			props: { value: { type: String, default: '' }, disabled: Boolean },
			emits: ['update:value'],
			setup:
				(props, { emit }) =>
				() =>
					h('input', {
						value: props.value,
						disabled: props.disabled,
						onInput: (event: Event) => {
							if (event.target instanceof HTMLInputElement) emit('update:value', event.target.value);
						},
					}),
		}),
		InputNumber: defineComponent({ setup: () => () => null }),
		Switch: defineComponent({
			props: { checked: Boolean, disabled: Boolean },
			emits: ['update:checked'],
			setup:
				(props, { emit }) =>
				() =>
					h('input', {
						type: 'checkbox',
						checked: props.checked,
						disabled: props.disabled,
						onChange: (event: Event) => {
							if (event.target instanceof HTMLInputElement) emit('update:checked', event.target.checked);
						},
					}),
		}),
		Alert: defineComponent({ props: { title: { type: String, default: '' } }, setup: (props) => () => h('p', { role: 'alert' }, props.title) }),
		Modal: defineComponent({
			props: { open: Boolean },
			setup:
				(props, { slots }) =>
				() =>
					props.open ? h('div', [slots.default?.(), slots.footer?.()]) : null,
		}),
		Button: defineComponent({
			props: { disabled: Boolean, loading: Boolean },
			setup:
				(props, { slots }) =>
				() =>
					h('button', { disabled: props.disabled || props.loading }, slots.default?.()),
		}),
		Checkbox: defineComponent({
			props: { checked: Boolean, disabled: Boolean },
			emits: ['update:checked'],
			setup:
				(props, { emit, slots }) =>
				() =>
					h('label', [
						h('input', {
							type: 'checkbox',
							checked: props.checked,
							disabled: props.disabled,
							onChange: (event: Event) => {
								if (event.target instanceof HTMLInputElement) emit('update:checked', event.target.checked);
							},
						}),
						slots.default?.(),
					]),
		}),
		Select: defineComponent({
			props: {
				value: { type: [String, Number, Array], default: undefined },
				mode: { type: String, default: '' },
				disabled: Boolean,
				options: { type: Array as PropType<{ label: string; value: number | string }[]>, default: () => [] },
			},
			emits: ['update:value', 'change'],
			setup:
				(props, { emit }) =>
				() =>
					h(
						'select',
						{
							value: props.value,
							multiple: props.mode === 'multiple',
							disabled: props.disabled,
							onChange: (event: Event) => {
								if (event.target instanceof HTMLSelectElement) {
									const value = props.mode === 'multiple' ? [...event.target.selectedOptions].map((item) => item.value) : event.target.value;
									emit('update:value', value);
									emit('change', value);
								}
							},
						},
						props.options.map((option) => h('option', { value: option.value }, option.label))
					),
		}),
	};
});

const files = Object.freeze({
	'Service.cs': '服务器原文\n中文内容',
	'index.vue': '服务器原文\n中文内容',
	'Api.ts': 'api',
	'edit.vue': 'edit',
	'schema.ts': 'schema',
	'import.vue': 'import',
	'print.vue': 'print',
});
const record = (id = 1): CodeGenRow => ({ id, busName: '测试生成', generateType: '200', tableName: 'Order' });
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}
let host: HTMLDivElement;
let app: ReturnType<typeof createApp>;
const preview = ref<InstanceType<typeof CodeGenPreview>>();
function button(text: string) {
	const result = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
	if (!result) throw new Error('缺少按钮：' + text);
	return result;
}
function editor() {
	const result = host.querySelector('textarea');
	if (!result) throw new Error('缺少预览编辑器');
	return result;
}
async function edit(value: string) {
	editor().value = value;
	editor().dispatchEvent(new Event('input', { bubbles: true }));
	await nextTick();
}
async function select(value: string) {
	const control = host.querySelector('select');
	if (!control) throw new Error('缺少生成文件选择器');
	control.value = value;
	control.dispatchEvent(new Event('change', { bubbles: true }));
	await nextTick();
}
beforeEach(() => {
	vi.clearAllMocks();
	mocks.preview.mockReset().mockResolvedValue(files);
	mocks.copy.mockReset().mockResolvedValue(undefined);
	mocks.add.mockReset().mockRejectedValue(new Error('保存失败'));
	mocks.inspect.mockReset();
	mocks.generate.mockReset().mockResolvedValue(undefined);
	const user = useUserStore();
	if (user.userInfo) user.userInfo.currentTenantId = 10;
	host = document.createElement('div');
	document.body.append(host);
	app = createApp({ setup: () => () => h(CodeGenPreview, { ref: preview }) });
	app.mount(host);
});
afterEach(() => {
	app.unmount();
	host.remove();
});

describe('代码生成表单事件接线', () => {
	it('菜单联动、单字段补全和可视图标选择写入保存草稿，失败后保留值且关闭生成菜单时禁用选择', async () => {
		app.unmount();
		app = createApp(CodeGenIndex);
		app.mount(host);
		await nextTick();
		await vi.waitFor(() => expect(button('新增生成配置').disabled).toBe(false));
		button('新增生成配置').click();
		await nextTick();
		const database = host.querySelector<HTMLSelectElement>('#codegen-database')!;
		database.value = 'unit-db';
		database.dispatchEvent(new Event('change', { bubbles: true }));
		await vi.waitFor(() => expect(host.querySelectorAll('#codegen-entity option')).toHaveLength(1));
		const entity = host.querySelector<HTMLSelectElement>('#codegen-entity')!;
		entity.value = 'Order';
		entity.dispatchEvent(new Event('change', { bubbles: true }));
		button('添加唯一约束').click();
		await nextTick();
		await vi.waitFor(() => expect(host.querySelectorAll('#codegen-unique-0 option')).toHaveLength(1));
		const unique = host.querySelector<HTMLSelectElement>('#codegen-unique-0')!;
		unique.options[0]!.selected = true;
		unique.dispatchEvent(new Event('change', { bubbles: true }));
		const menu = host.querySelector<HTMLSelectElement>('#codegen-parent')!;
		menu.value = '9';
		menu.dispatchEvent(new Event('change', { bubbles: true }));
		button('选择测试图标').click();
		await nextTick();
		expect(host.querySelector<HTMLInputElement>('[aria-label="唯一约束 1 提示"]')!.value).toBe('业务编码');
		expect(host.querySelector<HTMLInputElement>('[aria-label="菜单页面目录"]')!.value).toBe('orders');
		expect(host.querySelector<HTMLInputElement>('#codegen-menu-icon')!.value).toBe('ant-design:appstore-outlined');
		const generateMenu = host.querySelector<HTMLInputElement>('[aria-label="生成菜单"]')!;
		generateMenu.checked = false;
		generateMenu.dispatchEvent(new Event('change', { bubbles: true }));
		await nextTick();
		expect(host.querySelector<HTMLInputElement>('#codegen-menu-icon')!.disabled).toBe(true);
		expect([...host.querySelectorAll('button')].some((item) => item.textContent === '选择测试图标')).toBe(false);
		generateMenu.checked = true;
		generateMenu.dispatchEvent(new Event('change', { bubbles: true }));
		await nextTick();
		host.querySelector('form.codegen-editor')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
		await vi.waitFor(() => expect(mocks.add).toHaveBeenCalled());
		expect(mocks.add.mock.calls[0]![0]).toMatchObject({ menuPid: 9, pagePath: 'orders', menuIcon: 'ant-design:appstore-outlined', tableUniqueList: [{ columns: ['Code'], message: '业务编码' }] });
		await vi.waitFor(() => expect(host.textContent).toContain('草稿已保留'));
		expect(host.querySelector<HTMLInputElement>('#codegen-menu-icon')!.value).toBe('ant-design:appstore-outlined');
	});
});

describe('代码预览组件行为', () => {
	it('七个文件可切换；局部编辑后仍复制原文，切文件恢复原文而不改 API 回包', async () => {
		await preview.value!.show(record());
		await nextTick();
		expect(host.querySelectorAll('option')).toHaveLength(7);
		await edit('局部更改，不提交');
		button('复制原文').click();
		await vi.waitFor(() => expect(mocks.copy).toHaveBeenCalledWith(files['Service.cs']));
		expect(editor().value).toBe('局部更改，不提交');
		await select('index.vue');
		expect(editor().value).toBe(files['index.vue']);
		await select('Service.cs');
		expect(editor().value).toBe(files['Service.cs']);
		expect(mocks.preview).toHaveBeenCalledTimes(1);
		expect(mocks.generate).not.toHaveBeenCalled();
		expect(mocks.zip).not.toHaveBeenCalled();
	});
	it('复制失败保留局部编辑并允许重试，空文件也能复制', async () => {
		mocks.preview.mockResolvedValue({ 'Empty.cs': '' });
		mocks.copy.mockRejectedValueOnce(new Error('权限拒绝'));
		await preview.value!.show(record());
		await nextTick();
		await edit('暂存修改');
		button('复制原文').click();
		await vi.waitFor(() => expect(host.textContent).toContain('复制失败'));
		expect(editor().value).toBe('暂存修改');
		button('复制原文').click();
		await vi.waitFor(() => expect(mocks.success).toHaveBeenCalledWith('已复制生成原文'));
		expect(mocks.copy).toHaveBeenNthCalledWith(2, '');
	});
	it('身份切换关闭预览、中止旧请求，迟到回包不污染新会话', async () => {
		const pending = deferred<Record<string, string>>();
		mocks.preview.mockReturnValueOnce(pending.promise);
		const loading = preview.value!.show(record());
		await nextTick();
		expect(button('复制原文').disabled).toBe(true);
		const signal: AbortSignal = mocks.preview.mock.calls[0]![1];
		const user = useUserStore();
		if (user.userInfo) user.userInfo.currentTenantId = 20;
		await nextTick();
		expect(signal.aborted).toBe(true);
		expect(host.textContent).toBe('');
		await preview.value!.show(record(2));
		await nextTick();
		await edit('新会话编辑');
		pending.resolve({ 'Old.cs': '旧身份内容' });
		await loading;
		await nextTick();
		expect(editor().value).toBe('新会话编辑');
		expect(host.textContent).not.toContain('Old.cs');
	});
	it.each(['resolve', 'reject'] as const)('关闭后旧复制 %s 不向新会话提示结果', async (outcome) => {
		const pending = deferred<void>();
		mocks.copy.mockReturnValueOnce(pending.promise);
		await preview.value!.show(record());
		await nextTick();
		button('复制原文').click();
		await preview.value!.show(record(2));
		await nextTick();
		await edit('新的局部编辑');
		if (outcome === 'resolve') pending.resolve();
		else pending.reject(new Error('旧复制失败'));
		await new Promise<void>((done) => queueMicrotask(done));
		await nextTick();
		expect(mocks.success).not.toHaveBeenCalled();
		expect(host.textContent).not.toContain('复制失败');
		expect(editor().value).toBe('新的局部编辑');
	});
	it('局部编辑不绕过覆盖确认，直接生成只提交原有 ID、fingerprint 和确认标记', async () => {
		mocks.inspect.mockResolvedValue({ fingerprint: 'reviewed-sha256', files: [{ template: 'Service', path: 'OrderService.cs', sha256: 'new-sha', existingSha256: 'old-sha' }] });
		await preview.value!.show(record());
		await nextTick();
		await edit('不能写入生成接口的本地编辑');
		expect(button('直接生成').disabled).toBe(true);
		button('核对生成清单').click();
		await vi.waitFor(() => expect(host.querySelector('input[type="checkbox"]')).not.toBeNull());
		expect(button('直接生成').disabled).toBe(true);
		const checkbox = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
		checkbox.checked = true;
		checkbox.dispatchEvent(new Event('change', { bubbles: true }));
		await nextTick();
		button('直接生成').click();
		await vi.waitFor(() => expect(mocks.generate).toHaveBeenCalledWith(1, 'reviewed-sha256', true, expect.any(AbortSignal)));
		expect(mocks.generate.mock.calls[0]).toHaveLength(4);
	});
});
