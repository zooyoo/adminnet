<script setup lang="ts">
import type { AxiosResponse } from 'axios';

import type { FileResponse } from '#/api/file-response';

import { onBeforeUnmount, ref } from 'vue';

import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, message, Modal, Upload } from 'antdv-next';

import { decodeFileResponse, downloadFile } from '#/api/file-response';
import { sessionBoundary } from '#/api/session';

const props = defineProps<{
	title: string;
	templateName: string;
	downloadTemplate: () => Promise<AxiosResponse<ArrayBuffer>>;
	importFile: (file: File) => Promise<AxiosResponse<ArrayBuffer>>;
}>();
const emit = defineEmits<{ imported: [] }>();
const open = ref(false);
const busy = ref(false);
const selected = ref<File>();
const resultFile = ref<FileResponse>();
const feedback = ref('');
const failed = ref(false);
let generation = 0;
const Download = createIconifyIcon('lucide:download');
const UploadIcon = createIconifyIcon('lucide:upload');

function show() {
	generation += 1;
	selected.value = undefined;
	resultFile.value = undefined;
	feedback.value = '';
	failed.value = false;
	open.value = true;
}
function select(file: File) {
	if (!/\.(xlsx|xls)$/i.test(file.name)) {
		feedback.value = '请选择 Excel 文件';
		failed.value = true;
		return false;
	}
	selected.value = file;
	resultFile.value = undefined;
	feedback.value = '';
	failed.value = false;
	return false;
}
async function template() {
	if (busy.value) return;
	busy.value = true;
	const version = sessionBoundary.version;
	const current = generation;
	try {
		const result = await decodeFileResponse(await props.downloadTemplate(), props.templateName);
		if (version !== sessionBoundary.version || current !== generation) return;
		if (result.kind === 'file') downloadFile(result.file);
		else throw new Error('接口未返回模板文件');
	} catch (cause) {
		if (current === generation) {
			feedback.value = cause instanceof Error ? cause.message : '模板下载失败';
			failed.value = true;
		}
	} finally {
		if (current === generation) busy.value = false;
	}
}
async function submit() {
	if (!selected.value || busy.value) return;
	busy.value = true;
	feedback.value = '';
	resultFile.value = undefined;
	const current = generation;
	const version = sessionBoundary.version;
	try {
		const result = await decodeFileResponse(await props.importFile(selected.value), '导入结果.xlsx');
		if (version !== sessionBoundary.version || current !== generation) return;
		if (result.kind === 'file') {
			resultFile.value = result.file;
			feedback.value = '导入完成，部分数据需要修正';
			failed.value = false;
		} else {
			feedback.value = result.message;
			message.success(result.message);
			open.value = false;
		}
		emit('imported');
	} catch (cause) {
		if (current === generation) {
			feedback.value = cause instanceof Error ? cause.message : '导入失败';
			failed.value = true;
		}
	} finally {
		if (current === generation) busy.value = false;
	}
}
onBeforeUnmount(() => {
	generation += 1;
});
defineExpose({ show });
</script>

<template>
	<Modal v-model:open="open" :title="title" :width="560" :closable="!busy" :keyboard="!busy" :mask-closable="false" @cancel="generation++">
		<Alert v-if="feedback" :message="feedback" :type="failed ? 'error' : 'warning'" show-icon class="mb-4" />
		<div class="import-actions">
			<Button :disabled="busy" @click="template"><Download :size="16" />下载模板</Button>
			<Upload accept=".xlsx,.xls" :show-upload-list="false" :before-upload="select" :disabled="busy"
				><Button :disabled="busy"><UploadIcon :size="16" />选择文件</Button></Upload
			>
		</div>
		<p v-if="selected" class="mt-4 break-all">{{ selected.name }}</p>
		<Button v-if="resultFile" class="mt-4" @click="downloadFile(resultFile)"><Download :size="16" />下载错误明细</Button>
		<template #footer>
			<Button
				:disabled="busy"
				@click="
					open = false;
					generation++;
				"
				>关闭</Button
			>
			<Button type="primary" :loading="busy" :disabled="!selected" @click="submit">开始导入</Button>
		</template>
	</Modal>
</template>

<style scoped>
.import-actions {
	display: flex;
	gap: 12px;
	flex-wrap: wrap;
}
</style>
