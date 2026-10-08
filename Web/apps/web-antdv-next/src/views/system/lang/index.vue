<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { LanguageRecord } from '#/api/system/lang';

import { computed, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';

import { Button, Form, FormItem, Input, Popconfirm, Select, Tag, Tooltip } from 'antdv-next';

import { directionOptions, languageFields, languagePage, removeLanguage, weekOptions } from '#/api/system/lang';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';

import LanguageEditor from './component/language-editor.vue';

defineOptions({ name: 'SysLang' });
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysLang:${action}`]);
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const Filter = createIconifyIcon('lucide:list-filter');
const advanced = ref(false);
const filters = reactive({ keyword: '', name: '', code: '', isoCode: '', urlCode: '', active: undefined as boolean | undefined });
const activeValue = computed({
	get: () => (filters.active === undefined ? undefined : String(filters.active)),
	set: (value: string | undefined) => {
		filters.active = value === undefined ? undefined : value === 'true';
	},
});
const table = useAdminTable<LanguageRecord, typeof filters>({
	query: { ...filters },
	load: (query, signal) => languagePage({ ...query, field: query.field ?? 'active', order: query.order ?? 'descending' }, signal),
});
const editor = ref<InstanceType<typeof LanguageEditor>>();
const columns: NonNullable<TableProps<LanguageRecord>['columns']> = [
	...languageFields.map((field) => ({ title: field.label, key: field.key, dataIndex: field.key, width: 140, sorter: true })),
	{ title: '书写方向', key: 'direction', dataIndex: 'direction', width: 130, sorter: true },
	{ title: '每周起始日', key: 'weekStart', dataIndex: 'weekStart', width: 120, sorter: true },
	{ title: '是否启用', key: 'active', dataIndex: 'active', width: 100, sorter: true },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 85 },
];
function reset() {
	Object.assign(filters, { keyword: '', name: '', code: '', isoCode: '', urlCode: '', active: undefined });
	void table.search({ ...filters });
}
async function remove(record: LanguageRecord) {
	if (!record.id) return;
	await removeLanguage(record.id);
	await table.reload();
}
onMounted(table.reload);
</script>

<template>
	<div class="language-page">
		<Form name="language-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem name="keyword" label="关键字"><Input v-model:value="filters.keyword" allow-clear /></FormItem>
			<template v-if="advanced">
				<FormItem v-for="field in languageFields.slice(0, 4)" :key="field.key" :name="field.key" :label="field.label"
					><Input v-model:value="filters[field.key as 'name' | 'code' | 'isoCode' | 'urlCode']" allow-clear
				/></FormItem>
				<FormItem name="active" label="是否启用"
					><Select
						v-model:value="activeValue"
						:options="[
							{ label: '是', value: 'true' },
							{ label: '否', value: 'false' },
						]"
						:virtual="false"
						allow-clear
						style="min-width: 110px"
				/></FormItem>
			</template>
			<div class="actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button>
				<Button @click="reset"><Reset :size="16" />重置</Button>
				<Button :aria-expanded="advanced" @click="advanced = !advanced"><Filter :size="16" />高级查询</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar
				><Button v-if="can('add')" type="primary" @click="editor?.show()"><Plus :size="16" />新增语言</Button></template
			>
			<template #bodyCell="{ column, record }">
				<template v-if="column.key === 'direction'">{{ directionOptions.find((option) => option.value === record.direction)?.label }}</template>
				<template v-else-if="column.key === 'weekStart'">{{ weekOptions.find((option) => option.value === record.weekStart)?.label }}</template>
				<Tag v-else-if="column.key === 'active'" :color="record.active ? 'success' : 'default'">{{ record.active ? '是' : '否' }}</Tag>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑语言" @click="editor?.show(record.id)"><Pencil :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除语言“${record.name}”？`" @confirm="remove(record)"
						><Button type="text" size="small" danger title="删除" aria-label="删除语言"><Trash :size="16" /></Button
					></Popconfirm>
				</div>
			</template>
		</AdminTable>
		<LanguageEditor ref="editor" @saved="table.reload" />
	</div>
</template>

<style scoped>
.language-page {
	padding: 16px;
	min-width: 0;
}
.query-form {
	gap: 12px 0;
}
.actions {
	display: flex;
	gap: 6px;
	align-items: center;
}
@media (max-width: 640px) {
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
}
</style>
