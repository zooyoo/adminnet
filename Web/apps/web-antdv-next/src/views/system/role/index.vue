<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { RoleRecord } from '#/api/system/access-admin';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, Popconfirm, Switch, Tag, Tooltip } from 'antdv-next';

import { removeRole, rolePage, setRoleStatus } from '#/api/system/access-admin';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import TenantSelect from '#/components/admin/tenant-select.vue';

import DataScopeEditor from './component/data-scope-editor.vue';
import RoleEditor from './component/role-editor.vue';

defineOptions({ name: 'SysRole' });
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysRole:${action}`]);
const filters = reactive({ name: '', code: '', tenantId: user.userInfo?.accountType === 999 ? Number(user.userInfo?.currentTenantId) || undefined : undefined });
const table = useAdminTable<RoleRecord, typeof filters>({ query: { ...filters }, pageSize: 50, load: rolePage });
const editor = ref<InstanceType<typeof RoleEditor>>();
const scopeEditor = ref<InstanceType<typeof DataScopeEditor>>();
const pendingStatus = ref<number[]>([]);
const scopes: Record<number, string> = { 1: '全部数据', 2: '本部门及以下数据', 3: '本部门数据', 4: '仅本人数据', 5: '自定义数据' };
const columns: NonNullable<TableProps<RoleRecord>['columns']> = [
	{ title: '角色名称', key: 'name', dataIndex: 'name', width: 160 },
	{ title: '角色编码', key: 'code', dataIndex: 'code', width: 160 },
	{ title: '数据范围', key: 'scope', width: 170 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 205 },
];
async function status(record: RoleRecord) {
	if (!record.id || pendingStatus.value.includes(record.id)) return;
	pendingStatus.value.push(record.id);
	try {
		const next = record.status === 1 ? 2 : 1;
		await setRoleStatus(record.id, next);
		record.status = next;
	} catch {
		// 请求层已提示错误，状态保持为服务端确认的值。
	} finally {
		pendingStatus.value = pendingStatus.value.filter((id) => id !== record.id);
	}
}
async function remove(record: RoleRecord) {
	if (!record.id) return;
	await removeRole(record.id);
	await table.reload();
}
function reset() {
	filters.name = '';
	filters.code = '';
	void table.search({ ...filters });
}
onMounted(table.reload);
</script>

<template>
	<div class="admin-page">
		<Form name="role-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="user.userInfo?.accountType === 999" label="租户" name="tenantId"><TenantSelect v-model="filters.tenantId" allow-clear /></FormItem>
			<FormItem label="角色名称" name="name"><Input v-model:value="filters.name" allow-clear /></FormItem>
			<FormItem label="角色编码" name="code"><Input v-model:value="filters.code" allow-clear /></FormItem>
			<div class="actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar
				><Button v-if="can('add')" type="primary" @click="editor?.show(undefined, filters.tenantId)"><Plus :size="16" />新增角色</Button></template
			>
			<template #bodyCell="{ column, record }">
				<template v-if="column.key === 'scope'">{{ scopes[record.dataScope ?? 4] }}</template>
				<template v-else-if="column.key === 'status'">
					<Switch v-if="can('setStatus')" :checked="record.status === 1" :loading="pendingStatus.includes(record.id ?? 0)" :aria-label="`切换${record.name}状态`" @change="status(record)" />
					<Tag v-else :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
				</template>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Button v-if="can('grantDataScope')" type="link" size="small" @click="scopeEditor?.show(record)">数据范围</Button>
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑角色" @click="editor?.show(record)"><Pencil :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除角色“${record.name}”？`" @confirm="remove(record)"
						><Button type="text" size="small" danger title="删除" aria-label="删除角色"><Trash :size="16" /></Button
					></Popconfirm>
				</div>
			</template>
		</AdminTable>
		<RoleEditor ref="editor" @saved="table.reload" />
		<DataScopeEditor ref="scopeEditor" @saved="table.reload" />
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
