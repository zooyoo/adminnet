<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { RegistrationRecord } from '#/api/system/registration';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, Popconfirm, Tooltip } from 'antdv-next';

import { registrations, removeRegistration } from '#/api/system/registration';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import TenantSelect from '#/components/admin/tenant-select.vue';

import RegistrationEditor from './component/registration-editor.vue';

defineOptions({ name: 'SysUserRegWay' });
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysUserRegWay:${action}`]);
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const filters = reactive({ tenantId: user.userInfo?.accountType === 999 ? Number(user.userInfo?.currentTenantId) || undefined : undefined, name: '', keyword: '' });
const table = useAdminTable<RegistrationRecord, typeof filters>({ query: { ...filters }, load: registrations });
const editor = ref<InstanceType<typeof RegistrationEditor>>();
const columns: NonNullable<TableProps<RegistrationRecord>['columns']> = [
	{ title: '名称', key: 'name', dataIndex: 'name', width: 170 },
	{ title: '机构', key: 'orgName', dataIndex: 'orgName', width: 160 },
	{ title: '角色', key: 'roleName', dataIndex: 'roleName', width: 150 },
	{ title: '职位', key: 'posName', dataIndex: 'posName', width: 140 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 85 },
];
function reset() {
	Object.assign(filters, { tenantId: undefined, name: '', keyword: '' });
	void table.search({ ...filters });
}
async function remove(record: RegistrationRecord) {
	if (!record.id) return;
	await removeRegistration(record.id);
	await table.reload();
}
onMounted(table.reload);
</script>

<template>
	<div class="registration-page">
		<Form :model="filters" name="registration-query" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="user.userInfo?.accountType === 999" name="tenantId" label="租户"><TenantSelect v-model="filters.tenantId" allow-clear /></FormItem>
			<FormItem name="keyword" label="关键字"><Input v-model:value="filters.keyword" allow-clear /></FormItem>
			<FormItem name="name" label="名称"><Input v-model:value="filters.name" allow-clear /></FormItem>
			<div class="actions">
				<Button v-if="can('list')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns" :pagination="false">
			<template #toolbar
				><Button v-if="can('add')" type="primary" @click="editor?.show(undefined, filters.tenantId)"><Plus :size="16" />新增注册方案</Button></template
			>
			<template #bodyCell="{ column, record }">
				<AuditRecord v-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑注册方案" @click="editor?.show(record)"><Pencil :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除注册方案“${record.name}”？`" @confirm="remove(record)"
						><Button type="text" size="small" danger title="删除" aria-label="删除注册方案"><Trash :size="16" /></Button
					></Popconfirm>
				</div>
			</template>
		</AdminTable>
		<RegistrationEditor ref="editor" @saved="table.reload" />
	</div>
</template>

<style scoped>
.registration-page {
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
