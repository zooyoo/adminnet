<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { FileQuery, FileRecord } from '#/api/system/file';

import { onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { useUserStore } from '@vben/stores';

import { Alert, Button, DatePicker, Form, FormItem, Input, InputNumber, message, Modal, Select, Switch, Tag, Upload } from 'antdv-next';

import { downloadFile } from '#/api/file-response';
import { sessionBoundary } from '#/api/session';
import { filePage, readFile, removeFile, saveFile, uploadFile } from '#/api/system/file';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import TenantSelect from '#/components/admin/tenant-select.vue';
import { uploadError } from '#/components/file-preview/file-kind';
import FilePreview from '#/components/file-preview/index.vue';

defineOptions({ name: 'SysFile' });
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysFile:${action}`]);
const filters = reactive<FileQuery>({ fileName: '', tenantId: user.userInfo?.accountType === 999 ? Number(user.userInfo.currentTenantId) : undefined });
const table = useAdminTable<FileRecord, FileQuery>({ query: { ...filters }, load: filePage });
const columns: NonNullable<TableProps<FileRecord>['columns']> = [
	{ title: '文件名称', dataIndex: 'fileName', key: 'fileName', width: 200 },
	{ title: '后缀', dataIndex: 'suffix', key: 'suffix', width: 80 },
	{ title: '大小 KB', dataIndex: 'sizeKb', key: 'sizeKb', width: 95 },
	{ title: '文件类别', dataIndex: 'fileType', key: 'fileType', width: 120 },
	{ title: '公开', key: 'public', width: 75 },
	{ title: '存储位置', dataIndex: 'bucketName', key: 'bucketName', width: 100 },
	{ title: '文件别名', dataIndex: 'fileAlias', key: 'fileAlias', width: 140 },
	{ title: '业务数据 ID', dataIndex: 'dataId', key: 'dataId', width: 150 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 250 },
];
const categories = [
	{ label: '相关文件', value: '相关文件' },
	{ label: '归档文件', value: '归档文件' },
];
const preview = ref<InstanceType<typeof FilePreview>>();
const open = ref(false);
const editing = ref(false);
const busy = ref(false);
const error = ref('');
const value = ref<FileRecord>({});
const selected = shallowRef<File>();
let generation = 0;
let editorSession = 0;
let controller: AbortController | undefined;
let alive = true;
let visible = true;
let viewGeneration = 0;
let viewRequest = new AbortController();
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
lifetime.signal.addEventListener('abort', () => {
	close();
	preview.value?.close();
});
function close() {
	generation++;
	controller?.abort();
	open.value = false;
	busy.value = false;
	selected.value = undefined;
}
function show(record?: FileRecord) {
	close();
	editorSession = sessionBoundary.version;
	editing.value = !!record;
	value.value = record ? { ...record } : { fileType: '相关文件', isPublic: false };
	error.value = '';
	open.value = true;
}
function select(file: File) {
	error.value = uploadError(file);
	selected.value = error.value ? undefined : file;
	return false;
}
async function save() {
	if (busy.value || editorSession !== sessionBoundary.version) return;
	if (editing.value ? !value.value.fileName?.trim() : !selected.value) {
		error.value = editing.value ? '请输入文件名称' : '请选择有效文件';
		return;
	}
	busy.value = true;
	error.value = '';
	const current = generation;
	controller = new AbortController();
	try {
		if (editing.value) await saveFile(value.value, controller.signal);
		else await uploadFile(selected.value!, value.value.fileType ?? '', value.value.isPublic, controller.signal);
		if (!alive || current !== generation || editorSession !== sessionBoundary.version) return;
		close();
		message.success(editing.value ? '保存成功' : '上传成功');
		await table.reload();
	} catch {
		// 请求层统一提示；失败保留文件选择及元数据。
	} finally {
		if (current === generation) busy.value = false;
	}
}
async function download(record: FileRecord) {
	const version = sessionBoundary.version;
	const currentView = viewGeneration;
	const signal = AbortSignal.any([lifetime.signal, viewRequest.signal]);
	try {
		const result = await readFile(record, signal);
		if (alive && visible && currentView === viewGeneration && version === sessionBoundary.version) downloadFile(result);
	} catch {
		/* 二进制错误由请求层统一处理。 */
	}
}
function remove(record: FileRecord) {
	const version = sessionBoundary.version;
	const currentView = viewGeneration;
	Modal.confirm({
		title: `确定删除文件“${record.fileName}”？`,
		async onOk() {
			if (!alive || !visible || currentView !== viewGeneration || version !== sessionBoundary.version || !record.id) return;
			await removeFile(record.id, AbortSignal.any([lifetime.signal, viewRequest.signal]));
			if (alive && visible && currentView === viewGeneration && version === sessionBoundary.version) {
				message.success('删除成功');
				await table.reload();
			}
		},
	});
}
function reset() {
	Object.assign(filters, { fileName: '', startTime: undefined, endTime: undefined });
	void table.search({ ...filters });
}
const fileViewRouter = useRouter();
const fileViewPath = fileViewRouter.currentRoute.value.path;
watch(() => fileViewRouter.currentRoute.value.path === fileViewPath, (active, previous) => {
	if (!active) {
		visible = false;
		viewGeneration++;
		viewRequest.abort();
		close();
		preview.value?.close();
	} else {
		visible = true;
		if (viewRequest.signal.aborted) viewRequest = new AbortController();
		if (!previous && can('page')) void table.reload();
	}
}, { flush: 'sync' });
onMounted(table.reload);
let previouslyActivated = false;
onActivated(() => {
	visible = true;
	if (viewRequest.signal.aborted) viewRequest = new AbortController();
	if (previouslyActivated && can('page')) void table.reload();
	previouslyActivated = true;
});
onDeactivated(() => {
	visible = false;
	viewGeneration++;
	viewRequest.abort();
	close();
	preview.value?.close();
});
onScopeDispose(() => {
	alive = false;
	visible = false;
	viewGeneration++;
	viewRequest.abort();
	close();
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<section class="file-page">
		<h1>文件管理</h1>
		<Form name="file-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="user.userInfo?.accountType === 999" label="租户" name="tenantId"><TenantSelect v-model="filters.tenantId" allow-clear /></FormItem>
			<FormItem label="文件名称" name="fileName"><Input v-model:value="filters.fileName" allow-clear /></FormItem>
			<FormItem label="开始时间" name="startTime"><DatePicker v-model:value="filters.startTime" show-time value-format="YYYY-MM-DD HH:mm:ss" /></FormItem>
			<FormItem label="结束时间" name="endTime"><DatePicker v-model:value="filters.endTime" show-time value-format="YYYY-MM-DD HH:mm:ss" /></FormItem>
			<Button v-if="can('page')" type="primary" html-type="submit">查询</Button><Button @click="reset">重置</Button>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar><Button v-if="can('uploadFile')" type="primary" @click="show()">上传文件</Button></template>
			<template #bodyCell="{ column, record }">
				<Tag v-if="column.key === 'public'" :color="record.isPublic ? 'green' : 'default'">{{ record.isPublic ? '是' : '否' }}</Tag>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Button v-if="can('downloadFile')" type="link" size="small" @click="preview?.show(record)">预览</Button>
					<Button v-if="can('downloadFile')" type="link" size="small" @click="download(record)">下载</Button>
					<Button v-if="can('update')" type="link" size="small" @click="show(record)">编辑</Button>
					<Button v-if="can('delete')" type="link" danger size="small" @click="remove(record)">删除</Button>
				</div>
			</template>
		</AdminTable>
		<Modal :open="open" :title="editing ? '编辑文件' : '上传文件'" :ok-button-props="{ loading: busy }" :mask-closable="false" destroy-on-hidden @cancel="close" @ok="save">
			<Alert v-if="error" :message="error" type="error" show-icon class="mb-4" />
			<Form name="file-editor" :model="value" layout="vertical" :disabled="busy">
				<FormItem v-if="editing" label="文件名称" name="fileName" required><Input v-model:value="value.fileName" :maxlength="128" /></FormItem>
				<FormItem label="文件类别" name="fileType"><Select v-model:value="value.fileType" :options="categories" allow-clear /></FormItem>
				<FormItem label="公开文件" name="isPublic"><Switch v-model:checked="value.isPublic" /><span class="public-hint">公开后可通过资源地址访问</span></FormItem>
				<template v-if="editing">
					<FormItem label="文件别名" name="fileAlias"><Input v-model:value="value.fileAlias" :maxlength="128" /></FormItem>
					<FormItem label="业务数据 ID" name="dataId"><InputNumber v-model:value="value.dataId" :min="1" :precision="0" /></FormItem>
				</template>
				<FormItem v-else label="选择文件">
					<Upload :show-upload-list="false" :before-upload="select" :disabled="busy" accept=".jpg,.jpeg,.png,.bmp,.gif,.webp,.txt,.xml,.pdf,.xlsx,.xls,.docx,.mp4,.webm,.ogg,.mp3,.wav,.m4a"
						><Button :disabled="busy">选择文件</Button></Upload
					>
					<p>{{ selected?.name ?? '尚未选择文件' }}</p>
					<p class="public-hint">最大 10 MB，支持图片、Office、PDF、文本及常见音视频。</p>
				</FormItem>
			</Form>
		</Modal>
		<FilePreview ref="preview" />
	</section>
</template>

<style scoped>
.file-page {
	padding: 16px;
	min-width: 0;
}
h1 {
	font-size: 20px;
	margin-bottom: 16px;
}
.query-form {
	gap: 12px 6px;
	margin-bottom: 12px;
}
.actions {
	display: flex;
	gap: 2px;
}
.public-hint {
	margin-left: 8px;
	color: var(--ant-color-text-secondary);
}
</style>
