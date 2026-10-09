<script setup lang="ts">
import type { FileRecord } from '#/api/system/file';

import { defineAsyncComponent, onDeactivated, onScopeDispose, ref, shallowRef } from 'vue';

import { Alert, Modal, Spin } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { readFile } from '#/api/system/file';

import { fileKind } from './file-kind';

const Docx = defineAsyncComponent(() => import('@vue-office/docx'));
const Excel = defineAsyncComponent(() => import('@vue-office/excel'));
const Pdf = defineAsyncComponent(() => import('@vue-office/pdf'));
const open = ref(false);
const title = ref('');
const kind = ref<ReturnType<typeof fileKind>>('unsupported');
const source = shallowRef<ArrayBuffer>();
const url = ref('');
const busy = ref(false);
const error = ref('');
const generation = ref(0);
const handlers = shallowRef({ rendered: () => {}, failed: () => {} });
let controller: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
function release() {
	generation.value++;
	controller?.abort();
	if (controller) sessionBoundary.release(controller);
	clearTimeout(timer);
	if (url.value) URL.revokeObjectURL(url.value);
	url.value = '';
	source.value = undefined;
	busy.value = false;
}
function close() {
	open.value = false;
	release();
}
function failed() {
	clearTimeout(timer);
	busy.value = false;
	error.value = '文件加载失败，请检查文件内容后重试';
}
function rendered() {
	clearTimeout(timer);
	busy.value = false;
}
async function show(file: FileRecord) {
	release();
	title.value = `${file.fileName ?? ''}${file.suffix ?? ''}`;
	kind.value = fileKind(file.suffix);
	error.value = '';
	open.value = true;
	if (kind.value === 'unsupported') {
		error.value = '此文件格式不支持预览，请下载后查看';
		return;
	}
	busy.value = true;
	const current = generation.value;
	const version = sessionBoundary.version;
	handlers.value = {
		rendered: () => {
			if (current === generation.value && version === sessionBoundary.version) rendered();
		},
		failed: () => {
			if (current === generation.value && version === sessionBoundary.version) failed();
		},
	};
	controller = new AbortController();
	sessionBoundary.track(controller);
	controller.signal.addEventListener(
		'abort',
		() => {
			if (current === generation.value) close();
		},
		{ once: true }
	);
	try {
		const result = await readFile(file, controller.signal);
		if (current !== generation.value || version !== sessionBoundary.version) return;
		if (kind.value === 'docx') await import('@vue-office/docx/lib/index.css');
		if (kind.value === 'excel') await import('@vue-office/excel/lib/index.css');
		const bytes = await result.blob.arrayBuffer();
		if (current !== generation.value || version !== sessionBoundary.version) return;
		source.value = bytes;
		url.value = URL.createObjectURL(result.blob);
		timer = setTimeout(failed, 30_000);
	} catch {
		if (current === generation.value && version === sessionBoundary.version) failed();
	}
}
onScopeDispose(release);
onDeactivated(close);
defineExpose({ show, close });
</script>

<template>
	<Modal :open="open" :title="title" :footer="null" :width="1100" destroy-on-hidden @cancel="close">
		<div class="preview-content" :key="generation">
			<Alert v-if="error" :message="error" type="error" show-icon />
			<Spin v-if="busy" tip="正在加载文件" class="preview-loading" />
			<template v-if="source && !error">
				<Docx v-if="kind === 'docx'" :src="source" @rendered="handlers.rendered" @error="handlers.failed" />
				<Excel v-else-if="kind === 'excel'" :src="source" style="height: 65vh" @rendered="handlers.rendered" @error="handlers.failed" />
				<Pdf v-else-if="kind === 'pdf'" :src="source" @rendered="handlers.rendered" @error="handlers.failed" />
				<img v-else-if="kind === 'image'" :src="url" :alt="title" @load="handlers.rendered" @error="handlers.failed" />
				<video v-else-if="kind === 'video'" :src="url" controls preload="metadata" @loadedmetadata="handlers.rendered" @error="handlers.failed" />
				<audio v-else-if="kind === 'audio'" :src="url" controls preload="metadata" @loadedmetadata="handlers.rendered" @error="handlers.failed" />
			</template>
		</div>
	</Modal>
</template>

<style scoped>
.preview-content {
	min-height: 160px;
	max-height: 72vh;
	overflow: auto;
}
.preview-loading {
	display: block;
	margin: 24px;
}
img,
video {
	display: block;
	max-width: 100%;
	max-height: 65vh;
	margin: auto;
}
audio {
	width: 100%;
	margin-top: 24px;
}
</style>
