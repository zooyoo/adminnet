<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { UserRecord } from '#/api/system/user';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Avatar, Button, Dropdown, Form, FormItem, Input, message, Modal, Popconfirm, Switch, Tag, Tooltip } from 'antdv-next';

import { removeUser, resetUserPassword, setUserStatus, unlockUser, userPage } from '#/api/system/user';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import OrgNavigation from '#/components/admin/org-navigation.vue';
import { useReferenceStore } from '#/store/reference';

import UserEditor from './component/user-editor.vue';

defineOptions({ name: 'SysUser' });
const Pencil = createIconifyIcon('lucide:pencil');
const Trash = createIconifyIcon('lucide:trash-2');
const More = createIconifyIcon('lucide:ellipsis');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const user = useUserStore();
const reference = useReferenceStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysUser:${action}`]);
const filters = reactive({
	orgId: -1,
	tenantId: user.userInfo?.accountType === 999 ? Number(user.userInfo?.currentTenantId) || undefined : undefined,
	account: '',
	realName: '',
	phone: '',
	posName: '',
});
const table = useAdminTable<UserRecord, typeof filters>({ query: { ...filters }, pageSize: 50, load: userPage });
const editor = ref<InstanceType<typeof UserEditor>>();
const navigation = ref<InstanceType<typeof OrgNavigation>>();
const pending = ref<number[]>([]);
const passwordVisible = ref(false);
const resetPassword = ref('');
const columns: NonNullable<TableProps<UserRecord>['columns']> = [
	{ title: '头像', key: 'avatar', width: 70 },
	{ title: '账号', key: 'account', dataIndex: 'account', width: 140 },
	{ title: '姓名', key: 'realName', dataIndex: 'realName', width: 110 },
	{ title: '手机号码', key: 'phone', dataIndex: 'phone', width: 140 },
	{ title: '账号类型', key: 'accountType', width: 120 },
	{ title: '角色集合', key: 'roleName', dataIndex: 'roleName', width: 170 },
	{ title: '所属机构', key: 'orgName', dataIndex: 'orgName', width: 140 },
	{ title: '职位', key: 'posName', dataIndex: 'posName', width: 110 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 70 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 125 },
];
function selected(node: { id: number; tenantId?: number }) {
	Object.assign(filters, { orgId: node.id || -1, tenantId: node.tenantId, account: '', realName: '', phone: '', posName: '' });
	void table.search({ ...filters });
}
function reset() {
	navigation.value?.reset();
}
function menuItems() {
	return [
		...(can('add') ? [{ key: 'copy', label: '复制账号' }] : []),
		...(can('resetPwd') ? [{ key: 'reset', label: '重置密码' }] : []),
		...(can('unlockLogin') ? [{ key: 'unlock', label: '解除登录锁定' }] : []),
	];
}
async function status(record: UserRecord) {
	if (!record.id || pending.value.includes(record.id)) return;
	pending.value.push(record.id);
	try {
		const next = record.status === 1 ? 2 : 1;
		await setUserStatus(record.id, next);
		record.status = next;
	} catch {
		/* 请求层提示失败，不改变已确认状态。 */
	} finally {
		pending.value = pending.value.filter((id) => id !== record.id);
	}
}
async function remove(record: UserRecord) {
	if (!record.id) return;
	await removeUser(record.id);
	await table.reload();
}
function action(key: string, record: UserRecord) {
	if (key === 'copy') {
		void editor.value?.show(record, true);
		return;
	}
	Modal.confirm({
		title: key === 'reset' ? `确定重置“${record.account}”的密码？` : `确定解除“${record.account}”的登录锁定？`,
		onOk: async () => {
			if (!record.id) return;
			if (key === 'reset') {
				resetPassword.value = await resetUserPassword(record.id);
				passwordVisible.value = true;
			} else {
				await unlockUser(record.id);
				message.success('已解除登录锁定');
			}
		},
	});
}
onMounted(async () => {
	await Promise.all([table.reload(), reference.load().catch(() => undefined)]);
});
</script>

<template>
	<div class="user-page">
		<OrgNavigation ref="navigation" @select="selected" />
		<main class="user-main">
			<Form :model="filters" name="user-query" layout="inline" class="query-form" @finish="table.search({ ...filters })">
				<FormItem name="account" label="账号"><Input v-model:value="filters.account" allow-clear /></FormItem>
				<FormItem name="realName" label="姓名"><Input v-model:value="filters.realName" allow-clear /></FormItem>
				<FormItem name="phone" label="手机号码"><Input v-model:value="filters.phone" allow-clear /></FormItem>
				<FormItem name="posName" label="职位"><Input v-model:value="filters.posName" allow-clear /></FormItem>
				<div class="actions">
					<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
				</div>
			</Form>
			<AdminTable :controller="table" :columns="columns">
				<template #toolbar
					><Button v-if="can('add')" type="primary" @click="editor?.show(undefined, false, filters.tenantId, filters.orgId > 0 ? filters.orgId : undefined)"
						><Plus :size="16" />新增账号</Button
					></template
				>
				<template #bodyCell="{ column, record }">
					<Avatar v-if="column.key === 'avatar'" :src="record.avatar ?? undefined" size="small">{{ record.realName?.slice(0, 1) ?? record.account.slice(0, 1) }}</Avatar>
					<template v-else-if="column.key === 'accountType'">{{ reference.label('AccountTypeEnum', record.accountType) }}</template>
					<template v-else-if="column.key === 'status'">
						<Switch v-if="can('setStatus')" :checked="record.status === 1" :loading="pending.includes(record.id ?? 0)" :aria-label="`切换${record.account}状态`" @change="status(record)" />
						<Tag v-else :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
					</template>
					<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
					<div v-else-if="column.key === 'actions'" class="actions">
						<Tooltip v-if="can('update')" title="编辑"
							><Button type="text" size="small" aria-label="编辑账号" @click="editor?.show(record)"><Pencil :size="16" /></Button
						></Tooltip>
						<Popconfirm v-if="can('delete')" :title="`确定删除账号“${record.account}”？`" @confirm="remove(record)"
							><Button type="text" size="small" danger title="删除" aria-label="删除账号"><Trash :size="16" /></Button
						></Popconfirm>
						<Dropdown v-if="menuItems().length" :trigger="['click']" :menu="{ items: menuItems() }" @menu-click="({ key }) => action(String(key), record)">
							<Button type="text" size="small" aria-label="更多账号操作"><More :size="16" /></Button>
						</Dropdown>
					</div>
				</template>
			</AdminTable>
		</main>
		<UserEditor ref="editor" @saved="table.reload" />
		<Modal v-model:open="passwordVisible" title="密码重置成功" :footer="null" @after-close="resetPassword = ''"
			><Input :value="resetPassword" readonly aria-label="重置后的密码" autocomplete="off"
		/></Modal>
	</div>
</template>

<style scoped>
.user-page {
	display: grid;
	grid-template-columns: minmax(210px, 22%) minmax(0, 1fr);
	min-height: 100%;
}
.user-main {
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
	.user-page {
		grid-template-columns: minmax(0, 1fr);
		min-height: 0;
		align-content: start;
	}
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
}
</style>
