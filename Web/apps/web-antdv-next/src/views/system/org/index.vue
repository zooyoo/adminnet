<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { OrgRecord } from '#/api/system/access-admin';
import type { TreeOption } from '#/utils/admin-tree';

import { computed, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Copy, createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Form, FormItem, Input, Popconfirm, Select, Tag, Tooltip, Tree } from 'antdv-next';

import { orgList, orgTree, removeOrg } from '#/api/system/access-admin';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import TenantSelect from '#/components/admin/tenant-select.vue';
import { useReferenceStore } from '#/store/reference';
import { findTreeNode, treeKeys, treeOptions } from '#/utils/admin-tree';

import OrgEditor from './component/org-editor.vue';

defineOptions({ name: 'SysOrg' });
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const Expand = createIconifyIcon('lucide:chevrons-up-down');
const Collapse = createIconifyIcon('lucide:chevrons-down-up');
const Refresh = createIconifyIcon('lucide:refresh-cw');
const user = useUserStore();
const reference = useReferenceStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysOrg:${action}`]);
const tenantId = ref<number>();
const filters = reactive({ id: 0, name: '', type: undefined as string | undefined, tenantId: undefined as number | undefined });
const expandedRows = ref<number[]>([]);
const table = useAdminTable<OrgRecord, typeof filters>({
	query: { ...filters },
	load: async (query, signal) => {
		const items = await orgList(query.tenantId, query.id, query.name, query.type, signal);
		expandedRows.value = treeKeys(treeOptions(items));
		return { items, total: items.length };
	},
});
const treeSearch = ref('');
const navigation = ref<Awaited<ReturnType<typeof orgTree>>>([]);
const expanded = ref<number[]>([]);
const selected = ref<number[]>([]);
const navigationError = ref('');
let treeGeneration = 0;
const nodes = computed(() => treeOptions(navigation.value));
const filteredNodes = computed(() => {
	function filter(items: TreeOption[]): TreeOption[] {
		return items.flatMap((item) => {
			if (item.title.includes(treeSearch.value)) return [item];
			const children = filter(item.children ?? []);
			return children.length ? [{ ...item, children }] : [];
		});
	}
	return treeSearch.value ? filter(nodes.value) : nodes.value;
});
const editor = ref<InstanceType<typeof OrgEditor>>();
const columns: NonNullable<TableProps<OrgRecord>['columns']> = [
	{ title: '机构名称', key: 'name', dataIndex: 'name', width: 200 },
	{ title: '机构编码', key: 'code', dataIndex: 'code', width: 130 },
	{ title: '级别', key: 'level', dataIndex: 'level', width: 70 },
	{ title: '机构类型', key: 'type', width: 100 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 130 },
];
async function loadTree() {
	const current = ++treeGeneration;
	navigationError.value = '';
	try {
		const rows = await orgTree(tenantId.value);
		if (current !== treeGeneration) return;
		navigation.value = rows;
		expanded.value = treeKeys(treeOptions(rows));
	} catch (cause) {
		if (current === treeGeneration) navigationError.value = cause instanceof Error ? cause.message : '机构树加载失败';
	}
}
function select(keys: Array<number | string>) {
	const id = Number(keys[0] ?? 0);
	const node = findTreeNode(navigation.value, id);
	selected.value = id ? [id] : [];
	Object.assign(filters, { id, name: '', type: undefined, tenantId: node?.tenantId ?? tenantId.value });
	void table.search({ ...filters });
}
function reset() {
	treeSearch.value = '';
	select([]);
}
function expandRows(keys: readonly (number | string)[]) {
	expandedRows.value = keys.map(Number);
}
async function tenantChanged() {
	navigation.value = [];
	reset();
	await loadTree();
}
async function refresh() {
	await Promise.all([loadTree(), table.search({ ...filters })]);
}
async function remove(record: OrgRecord) {
	if (!record.id) return;
	await removeOrg(record.id);
	if (selected.value.includes(record.id)) reset();
	await refresh();
}
onMounted(async () => {
	await Promise.all([refresh(), reference.load().catch(() => undefined)]);
});
</script>

<template>
	<div class="org-page">
		<aside class="org-navigation">
			<TenantSelect v-if="user.userInfo?.accountType === 999" v-model="tenantId" allow-clear aria-label="机构树租户" @change="tenantChanged" />
			<Input v-model:value="treeSearch" placeholder="机构名称" aria-label="搜索机构树" allow-clear />
			<div class="actions">
				<Tooltip title="全部展开"
					><Button aria-label="全部展开机构树" @click="expanded = treeKeys(nodes)"><Expand :size="16" /></Button
				></Tooltip>
				<Tooltip title="全部折叠"
					><Button aria-label="全部折叠机构树" @click="expanded = []"><Collapse :size="16" /></Button
				></Tooltip>
				<Tooltip title="根节点"
					><Button aria-label="选择根节点" @click="reset"><Reset :size="16" /></Button
				></Tooltip>
				<Tooltip title="刷新"
					><Button aria-label="刷新机构树" @click="loadTree"><Refresh :size="16" /></Button
				></Tooltip>
			</div>
			<Alert v-if="navigationError" :message="navigationError" type="error" show-icon />
			<Tree v-model:expanded-keys="expanded" :selected-keys="selected" :tree-data="filteredNodes" block-node @select="select" />
		</aside>
		<main class="org-main">
			<Form :model="filters" name="org-query" layout="inline" class="query-form" @finish="table.search({ ...filters })">
				<FormItem label="机构名称" name="name"><Input v-model:value="filters.name" allow-clear /></FormItem>
				<FormItem label="机构类型" name="type"><Select v-model:value="filters.type" :options="reference.options('org_type')" allow-clear style="min-width: 120px" /></FormItem>
				<div class="actions">
					<Button type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
				</div>
			</Form>
			<AdminTable :controller="table" :columns="columns" :pagination="false" :expandable="{ expandedRowKeys: expandedRows, onExpandedRowsChange: expandRows }">
				<template #toolbar
					><Button v-if="can('add')" type="primary" @click="editor?.show(undefined, filters.tenantId, false, filters.id)"><Plus :size="16" />新增机构</Button></template
				>
				<template #bodyCell="{ column, record }">
					<template v-if="column.key === 'type'">{{ reference.label('org_type', record.type) }}</template>
					<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
					<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
					<div v-else-if="column.key === 'actions'" class="actions">
						<Tooltip v-if="can('update')" title="编辑"
							><Button type="text" size="small" aria-label="编辑机构" @click="editor?.show(record)"><Pencil :size="16" /></Button
						></Tooltip>
						<Tooltip v-if="can('add')" title="复制"
							><Button type="text" size="small" aria-label="复制机构" @click="editor?.show(record, undefined, true)"><Copy :size="16" /></Button
						></Tooltip>
						<Popconfirm v-if="can('delete')" :title="`确定删除机构“${record.name}”？`" @confirm="remove(record)"
							><Button type="text" size="small" danger title="删除" aria-label="删除机构"><Trash :size="16" /></Button
						></Popconfirm>
					</div>
				</template>
			</AdminTable>
		</main>
		<OrgEditor ref="editor" @saved="refresh" />
	</div>
</template>

<style scoped>
.org-page {
	display: grid;
	grid-template-columns: minmax(210px, 22%) minmax(0, 1fr);
	min-height: 100%;
}
.org-navigation {
	padding: 16px;
	border-right: 1px solid var(--ant-color-border);
	display: flex;
	flex-direction: column;
	gap: 12px;
	min-width: 0;
}
.org-main {
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
@media (max-width: 800px) {
	.org-page {
		grid-template-columns: minmax(0, 1fr);
		min-height: 0;
		align-content: start;
	}
	.org-navigation {
		max-height: 300px;
		overflow: auto;
		border-right: 0;
		border-bottom: 1px solid var(--ant-color-border);
	}
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
}
</style>
