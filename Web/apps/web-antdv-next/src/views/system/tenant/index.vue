<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { TenantRecord } from '#/api/system/tenant';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';

import { Avatar, Button, Descriptions, DescriptionsItem, Dropdown, Form, FormItem, Input, InputPassword, message, Modal, Switch, Tag, Tooltip } from 'antdv-next';

import { createTenantDatabase, databaseTypes, removeTenant, resetTenantPassword, setTenantStatus, synchronizeTenantMenus, tenantPage } from '#/api/system/tenant';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import { useAuthStore } from '#/store';

import TenantEditor from './component/tenant-editor.vue';
import TenantMenuEditor from './component/tenant-menu-editor.vue';
import { isDefaultTenant } from './tenant-form';

defineOptions({ name: 'SysTenant' });
const Pencil = createIconifyIcon('lucide:pencil');
const More = createIconifyIcon('lucide:ellipsis');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const Database = createIconifyIcon('lucide:database');
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysTenant:${action}`]);
const auth = useAuthStore();
const filters = reactive({ name: '', phone: '' });
const table = useAdminTable<TenantRecord, typeof filters>({ query: { ...filters }, pageSize: 50, load: tenantPage });
const editor = ref<InstanceType<typeof TenantEditor>>();
const grant = ref<InstanceType<typeof TenantMenuEditor>>();
const pending = ref<number[]>([]);
const passwordOpen = ref(false);
const password = ref('');
const columns: NonNullable<TableProps<TenantRecord>['columns']> = [
	{ title: '名称', key: 'name', dataIndex: 'name', width: 180 },
	{ title: '租管账号', key: 'adminAccount', dataIndex: 'adminAccount', width: 140 },
	{ title: '电话', key: 'phone', dataIndex: 'phone', width: 140 },
	{ title: '域名', key: 'host', dataIndex: 'host', width: 180 },
	{ title: '租户类型', key: 'tenantType', width: 110 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '数据库类型', key: 'dbType', width: 130 },
	{ title: '描述', key: 'viceDesc', dataIndex: 'viceDesc', width: 160 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 130 },
];
const commands = [
	{ key: 'goTenant', label: '进入租管端' },
	{ key: 'changeTenant', label: '切换租户' },
	{ key: 'grantMenu', label: '授权菜单' },
	{ key: 'syncGrantMenu', label: '同步授权' },
	{ key: 'resetPwd', label: '重置密码' },
	{ key: 'delete', label: '删除租户', danger: true },
];
function items(record: TenantRecord) {
	return commands.filter((command) => can(command.key)).map((command) => ({ ...command, disabled: command.key === 'delete' && isDefaultTenant(record) }));
}
function reset() {
	filters.name = '';
	filters.phone = '';
	void table.search({ ...filters });
}
async function status(record: TenantRecord) {
	if (!record.id || pending.value.includes(record.id) || isDefaultTenant(record)) return;
	pending.value.push(record.id);
	try {
		const next = record.status === 1 ? 2 : 1;
		await setTenantStatus(record.id, next);
		record.status = next;
	} catch {
		/* 请求层提示失败，保留原状态。 */
	} finally {
		pending.value = pending.value.filter((id) => id !== record.id);
	}
}
function command(action: string, record: TenantRecord) {
	if (!record.id || !can(action)) return;
	if (action === 'grantMenu') {
		void grant.value?.show(record);
		return;
	}
	const labels: Record<string, string> = { createDb: '创建数据库', goTenant: '进入租管端', changeTenant: '切换租户', syncGrantMenu: '同步授权', resetPwd: '重置租管密码', delete: '删除租户' };
	Modal.confirm({
		title: `确定为“${record.name}”${labels[action]}？`,
		okButtonProps: { danger: action === 'delete' },
		onOk: async () => {
			const id = record.id!;
			switch (action) {
				case 'createDb':
					await createTenantDatabase(id);
					break;
				case 'goTenant':
					await auth.changeTenant(id, true);
					return;
				case 'changeTenant':
					await auth.changeTenant(id);
					return;
				case 'syncGrantMenu':
					await synchronizeTenantMenus(id);
					break;
				case 'resetPwd':
					if (!record.userId) throw new Error('未找到租管账号');
					password.value = await resetTenantPassword(record.userId);
					passwordOpen.value = true;
					return;
				case 'delete':
					await removeTenant(id);
					break;
			}
			message.success('操作成功');
			await table.reload();
		},
	});
}
onMounted(table.reload);
</script>

<template>
	<div class="tenant-page">
		<Form :model="filters" name="tenant-query" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem label="租户名称" name="name"><Input v-model:value="filters.name" allow-clear /></FormItem>
			<FormItem label="联系电话" name="phone"><Input v-model:value="filters.phone" allow-clear /></FormItem>
			<div class="actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar
				><Button v-if="can('add')" type="primary" @click="editor?.show()"><Plus :size="16" />新增租户</Button></template
			>
			<template #expandedRowRender="{ record }">
				<Descriptions :column="{ xs: 1, sm: 2, md: 3 }" bordered size="small" class="tenant-detail">
					<DescriptionsItem label="Logo"><Avatar :src="record.logo ?? undefined" shape="square" /></DescriptionsItem>
					<DescriptionsItem label="标题">{{ record.title }}</DescriptionsItem>
					<DescriptionsItem label="副标题">{{ record.viceTitle }}</DescriptionsItem>
					<DescriptionsItem label="域名">{{ record.host }}</DescriptionsItem>
					<DescriptionsItem label="备案号">{{ record.icp }}</DescriptionsItem>
					<DescriptionsItem label="水印">{{ record.watermark }}</DescriptionsItem>
					<DescriptionsItem label="数据库标识">{{ record.configId }}</DescriptionsItem>
					<DescriptionsItem label="版权信息" :span="2">{{ record.copyright }}</DescriptionsItem>
					<DescriptionsItem label="数据库连接" :span="3"><InputPassword :value="record.connection ?? ''" readonly autocomplete="off" aria-label="数据库连接" /></DescriptionsItem>
					<DescriptionsItem label="从库连接" :span="3"><InputPassword :value="record.slaveConnections ?? ''" readonly autocomplete="off" aria-label="从库连接" /></DescriptionsItem>
				</Descriptions>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.key === 'tenantType'">{{ record.tenantType === 0 ? '字段隔离' : '数据库隔离' }}</template>
				<template v-else-if="column.key === 'dbType'">{{ databaseTypes.find((item) => item.value === record.dbType)?.label ?? record.dbType }}</template>
				<template v-else-if="column.key === 'status'">
					<Switch
						v-if="can('setStatus')"
						:checked="record.status === 1"
						:disabled="isDefaultTenant(record)"
						:loading="pending.includes(record.id ?? 0)"
						:aria-label="`切换${record.name}状态`"
						@change="status(record)"
					/>
					<Tag v-else :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
				</template>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Tooltip v-if="can('createDb')" title="创建数据库"
						><Button type="text" size="small" aria-label="创建数据库" :disabled="record.tenantType === 0" @click="command('createDb', record)"><Database :size="16" /></Button
					></Tooltip>
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑租户" @click="editor?.show(record)"><Pencil :size="16" /></Button
					></Tooltip>
					<Dropdown v-if="items(record).length" :trigger="['click']" :menu="{ items: items(record) }" @menu-click="({ key }) => command(String(key), record)">
						<Button type="text" size="small" aria-label="更多租户操作"><More :size="16" /></Button>
					</Dropdown>
				</div>
			</template>
		</AdminTable>
		<TenantEditor ref="editor" @saved="table.reload" />
		<TenantMenuEditor ref="grant" />
		<Modal v-model:open="passwordOpen" title="租管密码已重置" :footer="null" @after-close="password = ''"><Input :value="password" readonly aria-label="重置后的密码" autocomplete="off" /></Modal>
	</div>
</template>

<style scoped>
.tenant-page {
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
.tenant-detail {
	max-width: 100%;
	overflow: auto;
}
@media (max-width: 600px) {
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
}
</style>
