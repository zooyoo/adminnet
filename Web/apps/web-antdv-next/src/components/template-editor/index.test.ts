/* eslint-disable vue/one-component-per-file -- 用同一夹具模拟 Antdv 组件与挂载容器。 */
import type { App } from 'vue';

import { createApp, defineComponent, h, nextTick, shallowRef } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import TemplateEditor from './index.vue';

const engine = vi.hoisted(() => {
	let html = '';
	let editable: HTMLElement;
	let textContainer: HTMLElement;
	let changed: ((editor: unknown) => void) | undefined;
	const editor = {
		getHtml: vi.fn(() => html),
		setHtml: vi.fn((value: string) => {
			html = value;
			changed?.(editor);
			queueMicrotask(() => changed?.(editor));
		}),
		getEditableContainer: vi.fn(() => textContainer),
		destroy: vi.fn(),
		disable: vi.fn(() => editable.setAttribute('contenteditable', 'false')),
		enable: vi.fn(() => editable.setAttribute('contenteditable', 'true')),
		restoreSelection: vi.fn(),
		insertText: vi.fn(),
	};
	const createEditor = vi.fn((options: { selector: HTMLElement; html: string; config: { onChange?: (editor: unknown) => void; readOnly?: boolean } }) => {
		html = '<p>编辑器归一化的显示副本</p>';
		textContainer = document.createElement('div');
		textContainer.className = 'w-e-text-container';
		editable = document.createElement('div');
		editable.setAttribute('data-slate-editor', 'true');
		editable.setAttribute('contenteditable', String(!options.config.readOnly));
		textContainer.append(editable);
		options.selector.append(textContainer);
		changed = options.config.onChange;
		changed?.(editor);
		queueMicrotask(() => changed?.(editor));
		return editor;
	});
	const toolbar = { destroy: vi.fn() };
	return {
		createEditor,
		createToolbar: vi.fn(() => toolbar),
		editor,
		toolbar,
		edit: (value: string) => {
			html = value;
			changed?.(editor);
		},
	};
});
vi.mock('@wangeditor-next/editor', () => engine);
vi.mock('@wangeditor-next/editor/dist/css/style.css', () => ({}));
vi.mock('antdv-next', () => {
	const wrapper = defineComponent({
		setup:
			(_, { slots }) =>
			() =>
				h('div', [slots.default?.(), slots.action?.()]),
	});
	return {
		Alert: defineComponent({
			props: { title: { type: String, default: '' } },
			setup:
				(props, { slots }) =>
				() =>
					h('div', [props.title, slots.action?.()]),
		}),
		Button: defineComponent({
			setup:
				(_, { attrs, slots }) =>
				() =>
					h('button', attrs, slots.default?.()),
		}),
		Spin: wrapper,
		Input: {
			TextArea: defineComponent({
				props: { value: { type: String, default: '' } },
				setup:
					(props, { attrs }) =>
					() =>
						h('textarea', { ...attrs, value: props.value }),
			}),
		},
	};
});
const mounted: { app: App; element: HTMLElement }[] = [];
function mount(value: string, initiallyDisabled = false) {
	const model = shallowRef(value);
	const disabled = shallowRef(initiallyDisabled);
	const values: string[] = [];
	const element = document.createElement('div');
	document.body.append(element);
	const app = createApp({
		setup: () => () =>
			h(TemplateEditor, {
				value: model.value,
				disabled: disabled.value,
				'onUpdate:value': (content: string) => {
					values.push(content);
					model.value = content;
				},
			}),
	});
	app.mount(element);
	mounted.push({ app, element });
	return { app, element, model, values, disabled };
}
async function ready(element: HTMLElement) {
	await vi.waitFor(() => expect(element.querySelector('[role="textbox"]')).not.toBeNull());
	await nextTick();
}
function button(element: HTMLElement, label: string): HTMLButtonElement {
	const result = [...element.querySelectorAll('button')].find((entry) => entry.textContent === label);
	if (!result) throw new Error('缺少按钮：' + label);
	return result;
}
beforeEach(() => {
	vi.clearAllMocks();
});
afterEach(() => {
	for (const { app, element } of mounted.splice(0)) {
		app.unmount();
		element.remove();
	}
});

describe('模板编辑器原文边界', () => {
	it.each([false, true])('真实 Slate 输入结构的唯一名称和只读状态正确，初始只读 %s', async (initiallyDisabled) => {
		const raw = '  <h2>@(name)</h2>\r\n<p>中文😀 &amp; 空格</p>  ';
		const env = mount(raw, initiallyDisabled);
		await ready(env.element);
		const outer = env.element.querySelector('.w-e-text-container')!;
		const editable = env.element.querySelector('[data-slate-editor]')!;
		expect(env.element.querySelectorAll('[role="textbox"][aria-label="模板内容"]')).toHaveLength(1);
		expect(env.element.querySelector('[role="textbox"][aria-label="模板内容"]')).toBe(editable);
		for (const attribute of ['role', 'aria-label', 'aria-multiline', 'aria-readonly']) expect(outer.hasAttribute(attribute)).toBe(false);
		expect(editable.getAttribute('contenteditable')).toBe(String(!initiallyDisabled));
		expect(editable.getAttribute('aria-multiline')).toBe('true');
		expect(editable.getAttribute('aria-readonly')).toBe(String(initiallyDisabled));
		env.disabled.value = !initiallyDisabled;
		await nextTick();
		expect(editable.getAttribute('contenteditable')).toBe(String(initiallyDisabled));
		expect(editable.getAttribute('aria-readonly')).toBe(String(!initiallyDisabled));
		env.disabled.value = initiallyDisabled;
		await nextTick();
		expect(editable.getAttribute('contenteditable')).toBe(String(!initiallyDisabled));
		expect(editable.getAttribute('aria-readonly')).toBe(String(initiallyDisabled));
		expect(env.values).toEqual([]);
		expect(env.model.value).toBe(raw);
	});

	it('初始化及编辑器延迟归一化不发更新，CRLF/Unicode/空格原文不变', async () => {
		const raw = '  <h2 data-keep="原文">@(name)</h2>\r\n<p>中文 &amp; 😀</p>\r\n';
		const env = mount(raw);
		await ready(env.element);
		expect(env.values).toEqual([]);
		expect(env.model.value).toBe(raw);
		expect(engine.createEditor).toHaveBeenCalledOnce();
	});
	it('外部 setHtml 和可视/源码切换不改写 model', async () => {
		const env = mount('<p>初始内容</p>');
		await ready(env.element);
		env.model.value = '  <p>外部内容😀</p>\r\n';
		await nextTick();
		await nextTick();
		expect(engine.editor.setHtml).toHaveBeenCalled();
		expect(env.values).toEqual([]);
		button(env.element, '切换到源码编辑').click();
		await nextTick();
		expect(env.element.querySelector('textarea')).not.toBeNull();
		button(env.element, '切换到可视编辑').click();
		await ready(env.element);
		expect(env.values).toEqual([]);
		expect(env.model.value).toBe('  <p>外部内容😀</p>\r\n');
	});
	it('真实用户输入边界后的格式变更才更新 model', async () => {
		const env = mount('<p>初始内容</p>');
		await ready(env.element);
		env.element.querySelector('[role="textbox"]')!.dispatchEvent(new Event('beforeinput', { bubbles: true }));
		engine.edit('<p><strong>用户修改</strong></p>');
		await nextTick();
		expect(env.values).toEqual(['<p><strong>用户修改</strong></p>']);
	});
	it('复杂/危险原文只在源码输入中保留，不交给编辑器解析', async () => {
		const raw = '@{ var x = Model.name; }\r\n<script>parent.location="https://example.com"</script>';
		const env = mount(raw);
		await nextTick();
		await nextTick();
		expect(engine.createEditor).not.toHaveBeenCalled();
		expect(env.element.querySelector('textarea')).not.toBeNull();
		expect(env.values).toEqual([]);
		expect(env.model.value).toBe(raw);
	});
	it('加载失败保留原文，并可重试创建编辑器', async () => {
		engine.createEditor.mockImplementationOnce(() => {
			throw new Error('资源不可用');
		});
		const env = mount('<p>恢复草稿</p>');
		await vi.waitFor(() => expect(env.element.textContent).toContain('加载失败'));
		expect(env.model.value).toBe('<p>恢复草稿</p>');
		button(env.element, '重试编辑器').click();
		await ready(env.element);
		expect(engine.createEditor).toHaveBeenCalledTimes(2);
		expect(env.values).toEqual([]);
	});
	it('只读输入与卸载拒绝变更并销毁实例', async () => {
		const env = mount('<p>保留</p>');
		await ready(env.element);
		env.disabled.value = true;
		await nextTick();
		expect(engine.editor.disable).toHaveBeenCalled();
		env.element.querySelector('[role="textbox"]')!.dispatchEvent(new Event('beforeinput', { bubbles: true }));
		engine.edit('<p>不写入</p>');
		expect(env.values).toEqual([]);
		const entry = mounted.pop()!;
		entry.app.unmount();
		entry.element.remove();
		expect(engine.editor.destroy).toHaveBeenCalled();
		expect(engine.toolbar.destroy).toHaveBeenCalled();
		engine.edit('<p>销毁后的迟到更新</p>');
		expect(env.values).toEqual([]);
	});
});
