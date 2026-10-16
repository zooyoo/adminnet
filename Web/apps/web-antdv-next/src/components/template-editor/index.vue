<script setup lang="ts">
import type { IDomEditor, Toolbar } from '@wangeditor-next/editor';

import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import { Alert, Button, Input, Spin } from 'antdv-next';

import { canEditTemplateVisually, templateDisplayHtml } from './template-display';

const props = withDefaults(defineProps<{ value: string; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ 'update:value': [value: string] }>();
const container = shallowRef<HTMLElement>();
const toolbarContainer = shallowRef<HTMLElement>();
const editor = shallowRef<IDomEditor>();
const toolbar = shallowRef<Toolbar>();
const loading = shallowRef(false);
const error = shallowRef('');
const source = shallowRef(!canEditTemplateVisually(props.value));
const visualAllowed = computed(() => canEditTemplateVisually(props.value));
let alive = true;
let attempt = 0;
let userEditing = false;
let applying = false;
let failedModuleUrl: string | undefined;

async function loadEditorEngine(): Promise<typeof import('@wangeditor-next/editor')> {
	if (!failedModuleUrl) return import('@wangeditor-next/editor');
	// 浏览器会缓存失败的模块请求；显式重试同源原生产资源以避开失败缓存。
	const url = new URL(failedModuleUrl);
	url.searchParams.set('editorRetry', String(attempt));
	return import(/* @vite-ignore */ url.href);
}

function destroy() {
	attempt++;
	toolbar.value?.destroy();
	editor.value?.destroy();
	toolbar.value = undefined;
	editor.value = undefined;
	loading.value = false;
	userEditing = false;
}

function markUserEdit() {
	if (!props.disabled && !applying) userEditing = true;
}

function syncEditableAccessibility() {
	const outer = editor.value?.getEditableContainer();
	const editable = outer?.querySelector<HTMLElement>('[data-slate-editor]');
	if (!outer || !editable) return;
	// WangEditor 返回外层容器，字段语义绑定到实际 Slate 输入节点。
	for (const attribute of ['role', 'aria-label', 'aria-multiline', 'aria-readonly']) outer.removeAttribute(attribute);
	editable.setAttribute('role', 'textbox');
	editable.setAttribute('aria-label', '模板内容');
	editable.setAttribute('aria-multiline', 'true');
	editable.setAttribute('aria-readonly', String(props.disabled));
}

async function initialize() {
	destroy();
	if (source.value || !alive || !visualAllowed.value) return;
	const current = ++attempt;
	loading.value = true;
	error.value = '';
	try {
		const [engine] = await Promise.all([loadEditorEngine(), import('@wangeditor-next/editor/dist/css/style.css')]);
		await nextTick();
		if (!alive || current !== attempt || source.value || !container.value || !toolbarContainer.value) return;
		applying = true;
		const instance = engine.createEditor({
			selector: container.value,
			html: templateDisplayHtml(props.value),
			config: {
				autoFocus: false,
				readOnly: props.disabled,
				placeholder: '输入模板内容，支持 @(参数名)',
				sanitizeHtml: templateDisplayHtml,
				onChange: (changed) => {
					if (!alive || current !== attempt || applying || !userEditing || props.disabled || source.value) return;
					const html = changed.getHtml();
					if (html !== props.value) emit('update:value', html);
				},
				customAlert: (text) => {
					error.value = text;
				},
				customPaste: (changed, event) => {
					event.preventDefault();
					markUserEdit();
					changed.insertText(event.clipboardData?.getData('text/plain') ?? '');
					return false;
				},
			},
		});
		if (!alive || current !== attempt) {
			instance.destroy();
			return;
		}
		editor.value = instance;
		toolbar.value = engine.createToolbar({
			editor: instance,
			selector: toolbarContainer.value,
			config: {
				toolbarKeys: [
					'headerSelect',
					'bold',
					'italic',
					'underline',
					'through',
					'|',
					'color',
					'bgColor',
					'fontSize',
					'|',
					'bulletedList',
					'numberedList',
					'justifyLeft',
					'justifyCenter',
					'justifyRight',
					'|',
					'undo',
					'redo',
				],
			},
		});
		syncEditableAccessibility();
	} catch (cause) {
		const match = cause instanceof Error ? /https?:\/\/[^\s]+\.js(?:\?[^\s]*)?/u.exec(cause.message) : undefined;
		if (match) {
			try {
				const url = new URL(match[0]);
				if (url.origin === window.location.origin && !url.username && !url.password && !url.hash && url.pathname.endsWith('.js')) failedModuleUrl = url.href;
			} catch {
				// 无法定位同源模块时，保留源码模式和原文。
			}
		}
		if (alive && current === attempt) {
			destroy();
			error.value = '富文本编辑器加载失败，可重试或切换到源码编辑。原文已保留。';
		}
	} finally {
		applying = false;
		if (current === attempt) loading.value = false;
	}
}

function toggleSource() {
	source.value = !source.value;
	if (source.value) destroy();
	else void initialize();
}

function insertParameter(key: string) {
	if (props.disabled) return;
	const token = '@(' + key + ')';
	if (source.value || !editor.value) emit('update:value', props.value + token);
	else {
		markUserEdit();
		editor.value.restoreSelection();
		editor.value.insertText(token);
	}
}

function updateSource(value: number | string | undefined) {
	emit('update:value', String(value ?? ''));
}

defineExpose({ insertParameter });
watch(
	() => props.value,
	(value) => {
		const current = editor.value;
		// 本地逐字编辑的父组件回传不打断尚未完成的占位符；外来复杂原文仍走源码模式。
		if (current && userEditing && current.getHtml() === value) return;
		if (!canEditTemplateVisually(value)) {
			source.value = true;
			destroy();
			return;
		}
		const instance = editor.value;
		if (!instance || source.value || instance.getHtml() === value) return;
		applying = true;
		userEditing = false;
		try {
			instance.setHtml(templateDisplayHtml(value));
		} finally {
			applying = false;
		}
	}
);
watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) editor.value?.disable();
		else editor.value?.enable();
		syncEditableAccessibility();
	}
);
onMounted(() => {
	void initialize();
});
onBeforeUnmount(() => {
	alive = false;
	destroy();
});
</script>

<template>
	<div class="template-rich-editor">
		<div class="editor-switch">
			<span>可视编辑会在实际修改后更新 HTML；源码编辑保留完整模板标记。</span>
			<Button :auto-insert-space="false" :disabled="source && !visualAllowed" @click="toggleSource">{{ source ? '切换到可视编辑' : '切换到源码编辑' }}</Button>
		</div>
		<Alert v-if="!visualAllowed" type="info" show-icon aria-label="模板编辑器提示" title="此模板含复杂标记，请通过源码编辑保持完整原文。" />
		<Alert v-if="error" type="warning" show-icon aria-label="模板编辑器提示" :title="error">
			<template #action><Button :auto-insert-space="false" :disabled="source" @click="initialize">重试编辑器</Button></template>
		</Alert>
		<Input.TextArea v-if="source" :value="value" :readonly="disabled" :auto-size="{ minRows: 10, maxRows: 24 }" aria-label="模板内容" @update:value="updateSource" />
		<Spin v-else :spinning="loading" description="正在加载编辑器">
			<div class="visual-editor" @beforeinput.capture="markUserEdit" @cut.capture="markUserEdit" @paste.capture="markUserEdit">
				<div ref="toolbarContainer" class="template-rich-toolbar" @pointerdown.capture="markUserEdit" />
				<div ref="container" class="template-rich-body" />
			</div>
		</Spin>
	</div>
</template>

<style scoped>
.template-rich-editor {
	min-width: 0;
}
.editor-switch {
	display: flex;
	justify-content: space-between;
	align-items: center;
	gap: 12px;
	margin-bottom: 12px;
}
.editor-switch > span {
	color: hsl(var(--muted-foreground));
	font-size: 12px;
}
.template-rich-editor :deep(.ant-alert) {
	margin-bottom: 12px;
}
.visual-editor {
	border: 1px solid var(--w-e-textarea-border-color, #d9d9d9);
	border-radius: 6px;
	overflow: hidden;
}
.template-rich-body {
	height: 280px;
}
.template-rich-editor :deep(.w-e-text-container) {
	--w-e-textarea-bg-color: hsl(var(--background));
	--w-e-textarea-color: hsl(var(--foreground));
}
.template-rich-editor :deep(.w-e-bar) {
	--w-e-toolbar-bg-color: hsl(var(--background));
	--w-e-toolbar-color: hsl(var(--foreground));
	--w-e-toolbar-active-color: hsl(var(--primary));
	--w-e-toolbar-active-bg-color: hsl(var(--accent));
}
.template-rich-editor :deep(.w-e-text-placeholder) {
	top: 10px;
}
</style>
