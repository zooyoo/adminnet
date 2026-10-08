<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { TranslationRecord } from '#/api/system/lang-text';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';

import { Button, Dropdown, Form, FormItem, Input, InputNumber, message, Modal, Popconfirm, Tooltip } from 'antdv-next';

import { decodeFileResponse, downloadFile } from '#/api/file-response';
import { sessionBoundary } from '#/api/session';
import { exportTranslations, importTranslations, removeTranslation, removeTranslations, translationImportTemplate, translationPage } from '#/api/system/lang-text';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import ImportDialog from '#/components/admin/import-dialog.vue';

import TranslationEditor from './component/translation-editor.vue';

defineOptions({ name: 'SysLangText' });
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysLangText:${action}`]);
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const Filter = createIconifyIcon('lucide:list-filter');
const Download = createIconifyIcon('lucide:download');
const Upload = createIconifyIcon('lucide:upload');
const filters = reactive({ keyword: '', entityName: '', entityId: undefined as number | undefined, fieldName: '', langCode: '', content: '' });
const table = useAdminTable<TranslationRecord, typeof filters>({ query: { ...filters }, load: translationPage });
const advanced = ref(false);
const exporting = ref(false);
const editor = ref<InstanceType<typeof TranslationEditor>>();
const importer = ref<InstanceType<typeof ImportDialog>>();
const columns: NonNullable<TableProps<TranslationRecord>['columns']> = [
	{ title: '所属实体名', key: 'entityName', dataIndex: 'entityName', width: 150 },
	{ title: '所属实体 ID', key: 'entityId', dataIndex: 'entityId', width: 150 },
	{ title: '字段名', key: 'fieldName', dataIndex: 'fieldName', width: 120 },
	{ title: '语言代码', key: 'langCode', dataIndex: 'langCode', width: 120 },
	{ title: '翻译内容', key: 'content', dataIndex: 'content', width: 220 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 85 },
];
function reset() {
	Object.assign(filters, { keyword: '', entityName: '', entityId: undefined, fieldName: '', langCode: '', content: '' });
	void table.search({ ...filters });
}
async function remove(record: TranslationRecord) {
	if (!record.id) return;
	await removeTranslation(record.id);
	table.setSelectedKeys(table.selectedKeys.value.filter((key) => key !== record.id));
	await table.reload();
}
function batchRemove() {
	if (!table.selectedKeys.value.length) return;
	const ids = table.selectedKeys.value.map(Number);
	Modal.confirm({
		title: `确定删除选中的 ${ids.length} 条翻译？`,
		okButtonProps: { danger: true },
		onOk: async () => {
			await removeTranslations(ids);
			table.setSelectedKeys([]);
			await table.search({ ...filters });
		},
	});
}
async function exportData(mode: string) {
	if (exporting.value || !can('export')) return;
	if (mode === 'selected' && !table.selectedKeys.value.length) return;
	const version = sessionBoundary.version;
	exporting.value = true;
	try {
		const data = {
			...table.query.value,
			page: mode === 'page' ? table.page.value : 1,
			pageSize: mode === 'page' ? table.pageSize.value : 99_999_999,
			selectKeyList: mode === 'selected' ? table.selectedKeys.value.map(Number) : undefined,
		};
		const response = await decodeFileResponse(await exportTranslations(data), '翻译表.xlsx');
		if (version !== sessionBoundary.version) return;
		if (response.kind === 'file') downloadFile(response.file);
		else message.info(response.message);
	} catch (cause) {
		message.error(cause instanceof Error ? cause.message : '导出失败');
	} finally {
		exporting.value = false;
	}
}
onMounted(table.reload);
</script>

<template>
	<div class="translation-page">
		<Form name="translation-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem name="keyword" label="关键字"><Input v-model:value="filters.keyword" allow-clear /></FormItem>
			<template v-if="advanced">
				<FormItem name="entityName" label="所属实体名"><Input v-model:value="filters.entityName" allow-clear /></FormItem>
				<FormItem name="entityId" label="所属实体 ID"><InputNumber v-model:value="filters.entityId" :precision="0" /></FormItem>
				<FormItem name="fieldName" label="字段名"><Input v-model:value="filters.fieldName" allow-clear /></FormItem>
				<FormItem name="langCode" label="语言代码"><Input v-model:value="filters.langCode" allow-clear /></FormItem>
				<FormItem name="content" label="翻译内容"><Input v-model:value="filters.content" allow-clear /></FormItem>
			</template>
			<div class="actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button
				><Button :aria-expanded="advanced" @click="advanced = !advanced"><Filter :size="16" />高级查询</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns" :selection="can('batchDelete') || can('export')">
			<template #toolbar>
				<Button v-if="can('add')" type="primary" @click="editor?.show()"><Plus :size="16" />新增翻译</Button>
				<Button v-if="can('batchDelete')" danger :disabled="!table.selectedKeys.value.length" @click="batchRemove"><Trash :size="16" />批量删除</Button>
				<Dropdown
					v-if="can('export')"
					:trigger="['click']"
					:menu="{
						items: [
							{ key: 'selected', label: '导出选中数据', disabled: !table.selectedKeys.value.length },
							{ key: 'page', label: '导出本页数据' },
							{ key: 'all', label: '导出全部数据' },
						],
					}"
					@menu-click="({ key }) => exportData(String(key))"
					><Button :loading="exporting"><Download :size="16" />导出翻译</Button></Dropdown
				>
				<Button v-if="can('import')" @click="importer?.show()"><Upload :size="16" />导入翻译</Button>
			</template>
			<template #bodyCell="{ column, record }">
				<AuditRecord v-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑翻译" @click="editor?.show(record.id)"><Pencil :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除翻译“${record.content}”？`" @confirm="remove(record)"
						><Button type="text" size="small" danger title="删除" aria-label="删除翻译"><Trash :size="16" /></Button
					></Popconfirm>
				</div>
			</template>
		</AdminTable>
		<TranslationEditor ref="editor" @saved="table.reload" />
		<ImportDialog ref="importer" title="导入翻译" template-name="翻译表导入模板.xlsx" :download-template="translationImportTemplate" :import-file="importTranslations" @imported="table.reload" />
	</div>
</template>

<style scoped>
.translation-page {
	padding: 16px;
	min-width: 0;
}
.query-form {
	gap: 12px 0;
}
.actions {
	display: flex;
	align-items: center;
	gap: 6px;
}
@media (max-width: 640px) {
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
}
</style>
