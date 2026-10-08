<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { ConfigRecord, ConfigScope } from '#/api/system/config';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';

import { Alert, Button, Form, FormItem, Input, Modal, Popconfirm, Select, Tag, Tooltip } from 'antdv-next';

import { configService } from '#/api/system/config';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';

import ConfigEditor from './config-editor.vue';

const props = defineProps<{ scope: ConfigScope }>();
const service = configService(props.scope);
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`${service.prefix}:${action}`]);
const filters = reactive({ name: '', code: '', groupCode: undefined as string | undefined });
const groups = ref<string[]>([]);
const groupError = ref('');
const editor = ref<InstanceType<typeof ConfigEditor>>();
const Reset = createIconifyIcon('lucide:rotate-ccw');
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const table = useAdminTable<ConfigRecord, typeof filters>({
	query: { ...filters },
	pageSize: 50,
	load: (query, signal) => service.page({ ...query, field: query.field ?? 'orderNo', order: query.order ?? 'ascending' }, signal),
});
const columns: NonNullable<TableProps<ConfigRecord>['columns']> = [
	{ title: '配置名称', key: 'name', dataIndex: 'name', width: 150, sorter: true },
	{ title: '配置编码', key: 'code', dataIndex: 'code', width: 160, sorter: true },
	{ title: '属性值', key: 'value', dataIndex: 'value', width: 180 },
	{ title: '内置参数', key: 'sysFlag', dataIndex: 'sysFlag', width: 100 },
	{ title: '分组编码', key: 'groupCode', dataIndex: 'groupCode', width: 120, sorter: true },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80, sorter: true },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', width: 85, fixed: 'right' },
];
async function loadGroups() {
	groupError.value = '';
	try {
		groups.value = await service.groups();
	} catch (cause) {
		groupError.value = cause instanceof Error ? cause.message : '分组加载失败';
	}
}
async function refresh() {
	await Promise.all([table.reload(), loadGroups()]);
}
function reset() {
	Object.assign(filters, { name: '', code: '', groupCode: undefined });
	void table.search({ ...filters });
}
async function remove(record: ConfigRecord) {
	if (!record.id || record.sysFlag === 1) return;
	await service.remove(record.id);
	table.setSelectedKeys(table.selectedKeys.value.filter((key) => key !== record.id));
	await refresh();
}
function batchRemove() {
	const ids = table.selectedKeys.value.map(Number);
	if (!ids.length || !can('batchDelete')) return;
	Modal.confirm({
		title: `确定删除选中的 ${ids.length} 个配置？`,
		okButtonProps: { danger: true },
		onOk: async () => {
			await service.batchRemove(ids);
			table.setSelectedKeys([]);
			await table.search({ ...filters });
			await loadGroups();
		},
	});
}
onMounted(refresh);
</script>

<template>
	<div class="config-page">
		<Form name="config-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem name="name" label="配置名称"><Input v-model:value="filters.name" allow-clear /></FormItem>
			<FormItem name="code" label="配置编码"><Input v-model:value="filters.code" allow-clear /></FormItem>
			<FormItem name="groupCode" label="分组编码"
				><Select v-model:value="filters.groupCode" :options="groups.map((item) => ({ label: item, value: item }))" allow-clear show-search style="min-width: 150px"
			/></FormItem>
			<div class="actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
			</div>
		</Form>
		<Alert v-if="groupError" :message="groupError" type="warning" show-icon class="mt-3" />
		<AdminTable
			:controller="table"
			:columns="columns"
			:selection="can('batchDelete')"
			:disabled-selection="(row) => row.sysFlag === 1"
			:output="can('page') ? { fileName: service.title, formatters: { sysFlag: (record: ConfigRecord) => (record.sysFlag === 1 ? '是' : '否') } } : undefined"
		>
			<template #toolbar>
				<Button v-if="can('add')" type="primary" @click="editor?.show()"><Plus :size="16" />新增配置</Button>
				<Button v-if="can('batchDelete')" danger :disabled="!table.selectedKeys.value.length" @click="batchRemove"><Trash :size="16" />批量删除</Button>
			</template>
			<template #bodyCell="{ column, record }">
				<Tag v-if="column.key === 'sysFlag'" :color="record.sysFlag === 1 ? 'processing' : 'default'">{{ record.sysFlag === 1 ? '是' : '否' }}</Tag>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑配置" @click="editor?.show(record)"><Pencil :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除配置“${record.name}”？`" :disabled="record.sysFlag === 1" @confirm="remove(record)"
						><Button type="text" size="small" danger title="删除" aria-label="删除配置" :disabled="record.sysFlag === 1"><Trash :size="16" /></Button
					></Popconfirm>
				</div>
			</template>
		</AdminTable>
		<ConfigEditor ref="editor" :scope="scope" :groups="groups" @saved="refresh" />
	</div>
</template>

<style scoped>
.config-page {
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
