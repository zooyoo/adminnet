<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { OrgRecord } from '#/api/system/access-admin';
import type { TreeOption } from '#/utils/admin-tree';

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Copy, createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { useMediaQuery } from '@vueuse/core';
import { Alert, Button, Form, FormItem, Input, Popconfirm, Select, Splitter, SplitterPanel, Tag, Tooltip, Tree } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
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
const compact = useMediaQuery('(max-width: 800px)');
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
let disposed = false;
const deleteTarget = ref<number>();
const deleting = ref(false);
const deleteError = ref('');
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
	const version = sessionBoundary.version;
	navigationError.value = '';
	try {
		const rows = await orgTree(tenantId.value);
		if (current !== treeGeneration || version !== sessionBoundary.version || disposed) return false;
		navigation.value = rows;
		expanded.value = treeKeys(treeOptions(rows));
		if (filters.id && !findTreeNode(rows, filters.id)) {
			selected.value = [];
			Object.assign(filters, { id: 0, name: '', type: undefined, tenantId: tenantId.value });
		}
		return true;
	} catch (cause) {
		if (current === treeGeneration && version === sessionBoundary.version && !disposed) navigationError.value = cause instanceof Error ? cause.message : '机构树加载失败';
		return false;
	}
}
function select(keys: Array<number | string>) {
	const node = findTreeNode(navigation.value, Number(keys[0] ?? 0));
	const id = node?.id ?? 0;
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
	treeSearch.value = '';
	selected.value = [];
	Object.assign(filters, { id: 0, name: '', type: undefined, tenantId: tenantId.value });
	await refresh();
}
async function refresh() {
	if (await loadTree()) await table.search({ ...filters });
}
async function remove(record: OrgRecord) {
	if (!record.id || disposed) return;
	const version = sessionBoundary.version;
	await removeOrg(record.id);
	if (disposed || version !== sessionBoundary.version) return;
	await refresh();
}
function deleteOpenChanged(record: OrgRecord, open: boolean) {
	if (deleting.value || disposed) return;
	deleteTarget.value = open ? record.id : undefined;
	deleteError.value = '';
}
async function confirmRemove(record: OrgRecord) {
	if (!record.id || deleting.value || disposed) return;
	const version = sessionBoundary.version;
	deleting.value = true;
	deleteError.value = '';
	try {
		await remove(record);
		if (!disposed && version === sessionBoundary.version) deleteTarget.value = undefined;
	} catch (cause) {
		if (!disposed && version === sessionBoundary.version) deleteError.value = cause instanceof Error && cause.message ? cause.message : '机构删除失败，请重试';
	} finally {
		deleting.value = false;
		if (disposed || version !== sessionBoundary.version) {
			deleteTarget.value = undefined;
			deleteError.value = '';
		}
	}
}
onBeforeUnmount(() => {
	disposed = true;
	treeGeneration += 1;
});
onMounted(async () => {
	await Promise.all([refresh(), reference.load().catch(() => undefined)]);
});
</script>

<template>
	<div class="org-page">
		<Splitter class="org-splitter" :orientation="compact ? 'vertical' : 'horizontal'">
			<SplitterPanel class="org-panel" :default-size="compact ? undefined : '22%'" :min="compact ? 0 : 210" :resizable="!compact">
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
							><Button aria-label="刷新机构树" @click="refresh"><Refresh :size="16" /></Button
						></Tooltip>
					</div>
					<Alert v-if="navigationError" :message="navigationError" type="error" show-icon />
					<Tree v-model:expanded-keys="expanded" :selected-keys="selected" :tree-data="filteredNodes" block-node @select="select" />
				</aside>
			</SplitterPanel>
			<SplitterPanel class="org-panel" :min="compact ? 0 : 200" :resizable="!compact">
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
								<Popconfirm
									v-if="can('delete')"
									:title="`确定删除机构“${record.name}”？`"
									:open="deleteTarget === record.id"
									:description="deleteTarget === record.id ? deleteError : ''"
									:ok-button-props="{ loading: deleting }"
									:cancel-button-props="{ disabled: deleting }"
									@open-change="(open) => deleteOpenChanged(record, open)"
									@confirm="void confirmRemove(record)"
									><Button type="text" size="small" danger title="删除" aria-label="删除机构"><Trash :size="16" /></Button
								></Popconfirm>
							</div>
						</template>
					</AdminTable>
				</main>
			</SplitterPanel>
		</Splitter>
		<OrgEditor ref="editor" @saved="refresh" />
	</div>
</template>

<style scoped>
.org-page {
	min-height: 100%;
}
.org-splitter {
	height: auto;
	min-height: inherit;
}
.org-navigation {
	padding: 16px;
	border-right: 1px solid hsl(var(--border));
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
	.org-panel {
		flex: 0 0 auto !important;
	}
	.org-page {
		min-height: 0;
	}
	.org-navigation {
		max-height: 300px;
		overflow: auto;
		border-right: 0;
		border-bottom: 1px solid hsl(var(--border));
	}
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
}
</style>
