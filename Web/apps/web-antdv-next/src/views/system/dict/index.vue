<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { DictData, DictType, UpdateDictTypeInput } from '#/api/system/dict';

import { computed, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Copy, createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Empty, Form, FormItem, Input, Popconfirm, Tag, Tooltip } from 'antdv-next';

import { dictDataPage, dictTagColor, dictTypePage, removeDictData, removeDictType } from '#/api/system/dict';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import { useReferenceStore } from '#/store/reference';

import DictDataEditor from './component/dict-data-editor.vue';
import DictTypeEditor from './component/dict-type-editor.vue';

defineOptions({ name: 'SysDict' });
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const { hasAccessByCodes } = useAccess();
const user = useUserStore();
const reference = useReferenceStore();
const typeEditor = ref<InstanceType<typeof DictTypeEditor>>();
const dataEditor = ref<InstanceType<typeof DictDataEditor>>();
const selected = ref<DictType>();
const typeFilter = reactive({ name: '', code: '' });
const dataFilter = reactive({ dictTypeId: 0, label: '' });
const typeTable = useAdminTable<DictType, typeof typeFilter>({
	query: { ...typeFilter },
	pageSize: 50,
	load: (query, signal) => dictTypePage({ ...query, field: query.field ?? 'orderNo', order: query.order ?? 'ascending' }, signal),
});
const dataTable = useAdminTable<DictData, typeof dataFilter>({ query: { ...dataFilter }, pageSize: 50, load: dictDataPage });
const can = (entity: 'Data' | 'Type', action: string) => hasAccessByCodes([`sysDict${entity}:${action}`]);
const mutable = (type?: DictType) => Boolean(type && (type.sysFlag === 2 || user.userInfo?.accountType === 999));
const typeColumns = computed<NonNullable<TableProps<DictType>['columns']>>(() => [
	{ title: '字典名称', key: 'name', dataIndex: 'name', width: 150, sorter: true },
	{ title: '字典编码', key: 'code', dataIndex: 'code', width: 150, sorter: true },
	...(user.userInfo?.accountType === 999
		? [
				{ title: '系统内置', key: 'sysFlag', dataIndex: 'sysFlag', width: 90, sorter: true },
				{ title: '租户字典', key: 'isTenant', dataIndex: 'isTenant', width: 90, sorter: true },
			]
		: []),
	{ title: '状态', key: 'status', dataIndex: 'status', width: 80, sorter: true },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80, sorter: true },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 80 },
]);
const dataColumns: NonNullable<TableProps<DictData>['columns']> = [
	{ title: '显示文本', key: 'label', dataIndex: 'label', width: 140 },
	{ title: '字典值', key: 'value', dataIndex: 'value', width: 110 },
	{ title: '编码', key: 'code', dataIndex: 'code', width: 110 },
	{ title: '扩展数据', key: 'extData', width: 90 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 70 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 120 },
];
function select(type: DictType) {
	selected.value = type;
	dataTable.rows.value = [];
	dataFilter.dictTypeId = type.id ?? 0;
	dataFilter.label = '';
	void dataTable.search({ ...dataFilter });
}
async function invalidate() {
	reference.$reset();
	await reference.load().catch(() => undefined);
}
async function typeSaved(record: UpdateDictTypeInput) {
	if (selected.value?.id && selected.value.id === record.id) selected.value = { ...selected.value, ...record };
	await Promise.all([typeTable.reload(), invalidate()]);
}
async function dataSaved() {
	await Promise.all([dataTable.reload(), invalidate()]);
}
async function deleteType(record: DictType) {
	if (!record.id || record.sysFlag === 1 || !mutable(record)) return;
	await removeDictType(record.id);
	if (selected.value?.id === record.id) {
		selected.value = undefined;
		dataFilter.dictTypeId = 0;
		await dataTable.search({ ...dataFilter });
	}
	await Promise.all([typeTable.reload(), invalidate()]);
}
async function deleteData(record: DictData) {
	if (!record.id) return;
	await removeDictData(record.id);
	await dataSaved();
}
function resetType() {
	typeFilter.name = '';
	typeFilter.code = '';
	void typeTable.search({ ...typeFilter });
}
function resetData() {
	dataFilter.label = '';
	void dataTable.search({ ...dataFilter });
}
onMounted(typeTable.reload);
</script>

<template>
	<div class="dictionary-page">
		<section class="dict-types">
			<h2>字典</h2>
			<Form :model="typeFilter" name="dict-type-query" layout="inline" class="query-form" @finish="typeTable.search({ ...typeFilter })">
				<FormItem name="name" label="名称"><Input v-model:value="typeFilter.name" allow-clear /></FormItem>
				<FormItem name="code" label="编码"><Input v-model:value="typeFilter.code" allow-clear /></FormItem>
				<div class="actions">
					<Button v-if="can('Type', 'page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="resetType"><Reset :size="16" />重置</Button>
				</div>
			</Form>
			<AdminTable :controller="typeTable" :columns="typeColumns" :on-row="(record: DictType) => ({ onClick: () => select(record) })">
				<template #toolbar
					><Button v-if="can('Type', 'add')" type="primary" @click="typeEditor?.show()"><Plus :size="16" />新增字典</Button></template
				>
				<template #bodyCell="{ column, record }">
					<Button v-if="column.key === 'name'" type="link" size="small" @click.stop="select(record)">{{ record.name }}</Button>
					<template v-else-if="column.key === 'sysFlag' || column.key === 'isTenant'">{{ record[column.key] === 1 ? '是' : '否' }}</template>
					<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
					<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
					<div v-else-if="column.key === 'actions'" class="actions" @click.stop>
						<Tooltip v-if="can('Type', 'update')" title="编辑"
							><Button type="text" size="small" aria-label="编辑字典" :disabled="!mutable(record)" @click="typeEditor?.show(record)"><Pencil :size="16" /></Button
						></Tooltip>
						<Popconfirm v-if="can('Type', 'delete')" :title="`确定删除字典“${record.name}”？`" :disabled="record.sysFlag === 1 || !mutable(record)" @confirm="deleteType(record)"
							><Button type="text" size="small" danger title="删除" aria-label="删除字典" :disabled="record.sysFlag === 1 || !mutable(record)"><Trash :size="16" /></Button
						></Popconfirm>
					</div>
				</template>
			</AdminTable>
		</section>
		<section class="dict-values">
			<h2>{{ selected?.name || '字典值' }}</h2>
			<Form :model="dataFilter" name="dict-data-query" layout="inline" class="query-form" @finish="dataTable.search({ ...dataFilter })">
				<FormItem name="label" label="显示文本"><Input v-model:value="dataFilter.label" allow-clear /></FormItem>
				<div class="actions">
					<Button v-if="can('Data', 'page')" type="primary" html-type="submit" :disabled="!selected"><Search :size="16" />查询</Button><Button @click="resetData"><Reset :size="16" />重置</Button>
				</div>
			</Form>
			<AdminTable :controller="dataTable" :columns="dataColumns">
				<template #toolbar
					><Button v-if="can('Data', 'add')" type="primary" :disabled="!mutable(selected)" @click="selected && dataEditor?.show(selected)"><Plus :size="16" />新增字典值</Button></template
				>
				<template #bodyCell="{ column, record }">
					<Tag v-if="column.key === 'label'" :color="dictTagColor(record.tagType)" :style="record.styleSetting ?? undefined" :class="record.classSetting">{{ record.label }}</Tag>
					<Tag v-else-if="column.key === 'extData'" :color="record.extData ? 'success' : 'warning'">{{ record.extData ? '有值' : '空' }}</Tag>
					<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
					<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
					<div v-else-if="column.key === 'actions'" class="actions">
						<Tooltip v-if="can('Data', 'update')" title="编辑"
							><Button type="text" size="small" aria-label="编辑字典值" @click="selected && dataEditor?.show(selected, record)"><Pencil :size="16" /></Button
						></Tooltip>
						<Tooltip v-if="can('Data', 'add')" title="复制"
							><Button type="text" size="small" aria-label="复制字典值" :disabled="!mutable(selected)" @click="selected && dataEditor?.show(selected, record, true)"><Copy :size="16" /></Button
						></Tooltip>
						<Popconfirm v-if="can('Data', 'delete')" :title="`确定删除字典值“${record.value}”？`" :disabled="!mutable(selected)" @confirm="deleteData(record)"
							><Button type="text" size="small" danger title="删除" aria-label="删除字典值" :disabled="!mutable(selected)"><Trash :size="16" /></Button
						></Popconfirm>
					</div>
				</template>
			</AdminTable>
			<Empty v-if="!selected" description="未选择字典" />
		</section>
		<DictTypeEditor ref="typeEditor" @saved="typeSaved" />
		<DictDataEditor ref="dataEditor" @saved="dataSaved" />
	</div>
</template>

<style scoped>
.dictionary-page {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}
.dict-types,
.dict-values {
	min-width: 0;
	padding: 16px;
}
.dict-types {
	border-right: 1px solid var(--ant-color-border);
}
h2 {
	font-size: 16px;
	margin-bottom: 16px;
	font-weight: 600;
}
.query-form {
	gap: 12px 0;
}
.actions {
	display: flex;
	align-items: center;
	gap: 6px;
}
@media (max-width: 1000px) {
	.dictionary-page {
		grid-template-columns: minmax(0, 1fr);
	}
	.dict-types {
		border-right: 0;
		border-bottom: 1px solid var(--ant-color-border);
	}
}
</style>
