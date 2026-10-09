<script setup lang="ts">
import type { IDomEditor, Toolbar } from '@wangeditor-next/editor';

import { onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue';

import { useAppConfig } from '@vben/hooks';

import { Alert, Button, Spin } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { uploadFile } from '#/api/system/file';
import { sanitizeNoticeHtml } from '#/components/notice-content/notice-html';

import { noticeResourceUrl } from './resource-url';

const props = defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ busy: [value: boolean] }>();
const model = defineModel<string>({ required: true });
const container = ref<HTMLDivElement>();
const toolbarContainer = ref<HTMLDivElement>();
const editor = shallowRef<IDomEditor>();
const error = ref('');
const loading = ref(true);
const uploads = new Set<AbortController>();
let toolbar: Toolbar | undefined;
let disposed = false;
const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);

async function initialize() {
	loading.value = true;
	error.value = '';
	try {
		const engine = await import('@wangeditor-next/editor');
		await import('@wangeditor-next/editor/dist/css/style.css');
		if (disposed || !container.value || !toolbarContainer.value) return;
		editor.value = engine.createEditor({
			selector: container.value,
			html: sanitizeNoticeHtml(model.value),
			config: {
				placeholder: '请输入通知内容',
				autoFocus: false,
				readOnly: props.disabled ?? false,
				sanitizeHtml: sanitizeNoticeHtml,
				onChange: (instance) => {
					model.value = instance.getHtml();
				},
				customAlert: (info) => {
					error.value = info;
				},
				MENU_CONF: {
					uploadImage: {
						async customUpload(file, insert) {
							if (props.disabled || disposed) return;
							const version = sessionBoundary.version;
							const controller = new AbortController();
							uploads.add(controller);
							emit('busy', true);
							error.value = '';
							try {
								const result = await uploadFile(file, '通知图片', true, controller.signal);
								if (disposed || controller.signal.aborted || version !== sessionBoundary.version) return;
								if (!result?.url) throw new Error('上传响应缺少图片地址');
								const url = noticeResourceUrl(result.url, apiURL, window.location.origin);
								insert(url, result.fileName ?? file.name, url);
							} catch (cause) {
								if (!disposed && !controller.signal.aborted && version === sessionBoundary.version) error.value = cause instanceof Error ? cause.message : '图片上传失败';
							} finally {
								uploads.delete(controller);
								if (!disposed) emit('busy', uploads.size > 0);
							}
						},
					},
					insertImage: {
						checkImage(src) {
							return /^https?:\/\//i.test(src) || '图片网址必须以 http/https 开头';
						},
					},
				},
			},
		});
		toolbar = engine.createToolbar({ editor: editor.value, selector: toolbarContainer.value });
		const input = container.value.querySelector('[contenteditable]');
		input?.setAttribute('role', 'textbox');
		input?.setAttribute('aria-label', '通知内容');
		input?.setAttribute('aria-multiline', 'true');
	} catch (cause) {
		if (!disposed) {
			toolbar?.destroy();
			editor.value?.destroy();
			editor.value = undefined;
			error.value = cause instanceof Error ? cause.message : '编辑器加载失败';
		}
	} finally {
		if (!disposed) loading.value = false;
	}
}
watch(
	() => props.disabled,
	(disabled) => {
		if (disabled) editor.value?.disable();
		else editor.value?.enable();
	}
);
watch(model, (value) => {
	if (editor.value && editor.value.getHtml() !== value) editor.value.setHtml(sanitizeNoticeHtml(value));
});
onMounted(initialize);
onBeforeUnmount(() => {
	disposed = true;
	for (const controller of uploads) controller.abort();
	toolbar?.destroy();
	editor.value?.destroy();
});
</script>

<template>
	<div class="notice-editor">
		<Alert v-if="error" :message="error" type="error" show-icon>
			<template v-if="!editor" #action><Button size="small" :loading="loading" @click="initialize">重试</Button></template>
		</Alert>
		<Spin :spinning="loading">
			<div ref="toolbarContainer" class="notice-editor-toolbar"></div>
			<div ref="container" class="notice-editor-body"></div>
		</Spin>
	</div>
</template>

<style scoped>
.notice-editor {
	min-width: 0;
	border: 1px solid var(--ant-color-border);
	--w-e-textarea-bg-color: var(--ant-color-bg-container);
	--w-e-textarea-color: var(--ant-color-text);
	--w-e-toolbar-bg-color: var(--ant-color-bg-container);
	--w-e-toolbar-color: var(--ant-color-text);
	--w-e-toolbar-active-bg-color: var(--ant-color-fill-secondary);
	--w-e-toolbar-active-color: var(--ant-color-primary);
	--w-e-toolbar-border-color: var(--ant-color-border);
	--w-e-modal-button-bg-color: var(--ant-color-bg-container);
	--w-e-modal-button-border-color: var(--ant-color-border);
}
.notice-editor-body {
	height: 300px;
}
.notice-editor-toolbar {
	border-bottom: 1px solid var(--ant-color-border);
}
.notice-editor :deep(.w-e-bar) {
	flex-wrap: wrap;
}
.notice-editor :deep(.w-e-text-container) {
	z-index: 0;
}
.notice-editor :deep(.w-e-toolbar) {
	z-index: 2;
}
.notice-editor :deep(.w-e-textarea-video-container iframe) {
	pointer-events: none;
}
</style>
