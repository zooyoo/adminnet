<script setup lang="ts">
import type { editor, IDisposable } from 'monaco-editor';

import { onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';

import { usePreferences } from '@vben/preferences';

import { Alert, Button, Input } from 'antdv-next';

const props = withDefaults(defineProps<{ value: string; disabled?: boolean }>(), { disabled: false });
const emit = defineEmits<{ 'update:value': [value: string] }>();
const { isDark } = usePreferences();
const container = shallowRef<HTMLElement>();
const loading = shallowRef(true);
const failed = shallowRef(false);
let instance: editor.IStandaloneCodeEditor | undefined;
let model: editor.ITextModel | undefined;
let listener: IDisposable | undefined;
let engine: typeof import('monaco-editor/esm/vs/editor/editor.api.js') | undefined;
let alive = true;
let attempt = 0;
let applying = false;

function dispose() {
	listener?.dispose();
	instance?.dispose();
	model?.dispose();
	listener = undefined;
	instance = undefined;
	model = undefined;
}
async function initialize() {
	const current = ++attempt;
	loading.value = true;
	failed.value = false;
	dispose();
	try {
		const [monaco, workerModule] = await Promise.all([
			import('monaco-editor/esm/vs/editor/editor.api.js'),
			import('monaco-editor/esm/vs/editor/editor.worker.js?worker'),
			import('monaco-editor/esm/vs/basic-languages/csharp/csharp.contribution.js'),
		]);
		if (!alive || current !== attempt || !container.value) return;
		engine = monaco;
		// C# 使用基本语言高亮与 editor worker，不启用其他语言服务。
		globalThis.MonacoEnvironment ??= { getWorker: () => new workerModule.default() };
		model = monaco.editor.createModel(props.value, 'csharp');
		instance = monaco.editor.create(container.value, {
			model,
			theme: isDark.value ? 'vs-dark' : 'vs',
			readOnly: props.disabled,
			automaticLayout: true,
			minimap: { enabled: false },
			wordWrap: 'on',
			scrollBeyondLastLine: false,
			ariaLabel: 'C# 代码',
			tabIndex: 0,
		});
		listener = model.onDidChangeContent(() => {
			if (!alive || applying || props.disabled || !model) return;
			emit('update:value', model.getValue());
		});
	} catch {
		if (alive && current === attempt) {
			dispose();
			failed.value = true;
		}
	} finally {
		if (alive && current === attempt) loading.value = false;
	}
}
watch(
	() => props.value,
	(value) => {
		if (!model || model.getValue() === value) return;
		applying = true;
		try {
			model.setValue(value);
		} finally {
			applying = false;
		}
	}
);
watch(
	() => props.disabled,
	(readOnly) => instance?.updateOptions({ readOnly })
);
watch(isDark, (dark) => engine?.editor.setTheme(dark ? 'vs-dark' : 'vs'));
onMounted(initialize);
onBeforeUnmount(() => {
	alive = false;
	attempt += 1;
	dispose();
});
</script>

<template>
	<div class="plugin-code-editor">
		<p v-if="loading" role="status">正在加载代码编辑器…</p>
		<Alert v-if="failed" type="warning" title="代码编辑器加载失败，原文已保留，可继续使用文本编辑或重试。" show-icon>
			<template #action><Button :auto-insert-space="false" @click="initialize">重试编辑器</Button></template>
		</Alert>
		<Input.TextArea v-if="failed" :value="value" :readonly="disabled" :rows="14" aria-label="C# 代码" @update:value="emit('update:value', String($event ?? ''))" />
		<div v-show="!failed" ref="container" class="plugin-monaco" :aria-busy="loading" />
	</div>
</template>

<style scoped>
.plugin-monaco {
	height: 360px;
	min-width: 0;
}
</style>
