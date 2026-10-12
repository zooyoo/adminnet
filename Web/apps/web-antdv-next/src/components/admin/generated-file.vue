<script setup lang="ts">
import { onActivated, onDeactivated, onMounted, onScopeDispose, ref, watch } from 'vue';

import { Alert, Button, Image } from 'antdv-next';

import { downloadFile } from '#/api/file-response';
import { readFile } from '#/api/system/file';

import { createGeneratedSession, generatedCancelled } from './generated';

const props = withDefaults(defineProps<{ url: string; image?: boolean }>(), { image: false });
const session = createGeneratedSession();
const preview = ref('');
const busy = ref(false);
const error = ref('');
let generation = 0;
let active = false;
function clear() {
	generation += 1;
	active = false;
	session.clear();
	if (preview.value) URL.revokeObjectURL(preview.value);
	preview.value = '';
	busy.value = false;
	error.value = '';
}
async function load(download = false) {
	if (!active || busy.value) return;
	const current = generation;
	busy.value = true;
	error.value = '';
	try {
		const file = await session.run((signal) => readFile({ url: props.url }, signal));
		if (!active || current !== generation) return;
		if (download) downloadFile(file);
		else preview.value = URL.createObjectURL(file.blob);
	} catch (cause) {
		if (active && current === generation && !generatedCancelled(cause)) error.value = '文件加载失败，请重试';
	} finally {
		if (current === generation) busy.value = false;
	}
}
function activate() {
	if (active) return;
	active = true;
	if (props.image) void load();
}
watch(() => props.url, () => { const visible = active; clear(); if (visible) activate(); });
onMounted(activate);
onActivated(activate);
onDeactivated(clear);
onScopeDispose(clear);
</script>

<template>
	<div>
		<Image v-if="image && preview" :src="preview" :width="50" :height="50" />
		<Button v-else :loading="busy" size="small" @click="load(!image)">{{ image ? '加载图片' : '下载文件' }}</Button>
		<Alert v-if="error" :title="error" type="error" role="alert" class="mt-2" />
	</div>
</template>
