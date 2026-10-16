<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { MenuRecord } from '#/api/system/access-admin';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Copy, createIconifyIcon, IconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, Popconfirm, Select, Switch, Tag, Tooltip } from 'antdv-next';

import { menuList, removeMenu, setMenuStatus } from '#/api/system/access-admin';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import TenantSelect from '#/components/admin/tenant-select.vue';
import { normalizeMenuIcon } from '#/utils/admin-tree';

import MenuEditor from './component/menu-editor.vue';

defineOptions({ name: 'SysMenu' });
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes(action === 'setStatus' ? ['sysMenu:setStatus', 'sysUser:setStatus'] : [`sysMenu:${action}`]);
const filters = reactive({ title: '', type: undefined as number | undefined, tenantId: user.userInfo?.accountType === 999 ? Number(user.userInfo?.currentTenantId) || undefined : undefined });
const table = useAdminTable<MenuRecord, typeof filters>({
	query: { ...filters },
	load: async (query, signal) => {
		const items = await menuList(query.tenantId, query.title, query.type, signal);
		return { items, total: items.length };
	},
});
const editor = ref<InstanceType<typeof MenuEditor>>();
const pendingStatus = ref<number[]>([]);
const types = [
	{ label: '目录', value: 1 },
	{ label: '菜单', value: 2 },
	{ label: '按钮', value: 3 },
];
const columns: NonNullable<TableProps<MenuRecord>['columns']> = [
	{ title: '菜单名称', key: 'title', dataIndex: 'title', width: 190 },
	{ title: '类型', key: 'type', width: 80 },
	{ title: '路由路径', key: 'path', dataIndex: 'path', width: 180 },
	{ title: '组件路径', key: 'component', dataIndex: 'component', width: 200 },
	{ title: '权限标识', key: 'permission', dataIndex: 'permission', width: 160 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 130 },
];
async function status(record: MenuRecord) {
	if (!record.id || pendingStatus.value.includes(record.id)) return;
	pendingStatus.value.push(record.id);
	try {
		const next = record.status === 1 ? 2 : 1;
		await setMenuStatus(record.id, next);
		record.status = next;
	} catch {
		// 请求层已提示错误，状态保持为服务端确认的值。
	} finally {
		pendingStatus.value = pendingStatus.value.filter((id) => id !== record.id);
	}
}
async function remove(record: MenuRecord) {
	if (!record.id) return;
	await removeMenu(record.id);
	await table.reload();
}
function reset() {
	filters.title = '';
	filters.type = undefined;
	void table.search({ ...filters });
}
onMounted(table.reload);
</script>

<template>
	<div class="admin-page">
		<Form :model="filters" name="menu-query" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="user.userInfo?.accountType === 999" label="租户" name="tenantId"><TenantSelect v-model="filters.tenantId" /></FormItem>
			<FormItem label="菜单名称" name="title"><Input v-model:value="filters.title" allow-clear /></FormItem>
			<FormItem label="类型" name="type"><Select v-model:value="filters.type" :options="types" allow-clear style="min-width: 120px" /></FormItem>
			<div class="actions">
				<Button v-if="can('list')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns" :pagination="false">
			<template #toolbar
				><Button v-if="can('add')" type="primary" @click="editor?.show(undefined, filters.tenantId)"><Plus :size="16" />新增菜单</Button></template
			>
			<template #bodyCell="{ column, record }">
				<span v-if="column.key === 'title'" class="menu-title"><IconifyIcon v-if="record.icon" :icon="normalizeMenuIcon(record.icon)" class="size-4" />{{ record.title }}</span>
				<Tag v-else-if="column.key === 'type'" :color="record.type === 3 ? 'orange' : record.type === 1 ? 'blue' : 'green'">{{ types.find((item) => item.value === record.type)?.label }}</Tag>
				<template v-else-if="column.key === 'status'">
					<Switch v-if="can('setStatus')" :checked="record.status === 1" :loading="pendingStatus.includes(record.id ?? 0)" :aria-label="`切换${record.title}状态`" @change="status(record)" />
					<Tag v-else :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
				</template>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑菜单" @click="editor?.show(record, filters.tenantId)"><Pencil :size="16" /></Button
					></Tooltip>
					<Tooltip v-if="can('add')" title="复制"
						><Button type="text" size="small" aria-label="复制菜单" @click="editor?.show(record, filters.tenantId, true)"><Copy :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除菜单“${record.title}”？`" @confirm="remove(record)"
						><Button type="text" size="small" danger title="删除" aria-label="删除菜单"><Trash :size="16" /></Button
					></Popconfirm>
				</div>
			</template>
		</AdminTable>
		<MenuEditor ref="editor" @saved="table.reload" />
	</div>
</template>

<style scoped>
.admin-page {
	min-width: 0;
	padding: 16px;
}
.query-form {
	gap: 12px 0;
}
.actions,
.menu-title {
	display: inline-flex;
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
