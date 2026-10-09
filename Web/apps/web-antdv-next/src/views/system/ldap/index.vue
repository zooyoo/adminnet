<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { LdapRecord } from '#/api/system/ldap';

import { onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, message, Modal, Tag } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { ldapPage, removeLdap, syncLdapOrgs, syncLdapUsers } from '#/api/system/ldap';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import TenantSelect from '#/components/admin/tenant-select.vue';

import LdapEditor from './component/ldap-editor.vue';

defineOptions({ name: 'SysLdap' });
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysLdap:${action}`]);
const Reset = createIconifyIcon('lucide:rotate-ccw');
const filters = reactive({ tenantId: user.userInfo?.accountType === 999 ? Number(user.userInfo.currentTenantId) || undefined : undefined, keyword: '', host: '' });
const table = useAdminTable<LdapRecord, typeof filters>({ query: { ...filters }, load: ldapPage });
const editor = ref<InstanceType<typeof LdapEditor>>();
const busy = ref(false);
const columns: NonNullable<TableProps<LdapRecord>['columns']> = [
	{ title: '主机', key: 'host', dataIndex: 'host', width: 170 },
	{ title: '端口', key: 'port', dataIndex: 'port', width: 75 },
	{ title: '搜索基准', key: 'baseDn', dataIndex: 'baseDn', width: 220 },
	{ title: '绑定 DN', key: 'bindDn', dataIndex: 'bindDn', width: 220 },
	{ title: '过滤规则', key: 'authFilter', dataIndex: 'authFilter', width: 180 },
	{ title: '版本', key: 'version', dataIndex: 'version', width: 70 },
	{ title: '状态', key: 'status', width: 75 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 340 },
];
function reset() {
	Object.assign(filters, { keyword: '', host: '' });
	void table.search({ ...filters });
}
function act(record: LdapRecord, action: 'delete' | 'syncOrg' | 'syncUser') {
	if (!record.id || busy.value) return;
	const version = sessionBoundary.version;
	const id = record.id;
	const labels = { delete: '删除域配置', syncOrg: '同步域组织', syncUser: '同步域账户' };
	Modal.confirm({
		title: `确定${labels[action]}“${record.host}”？`,
		content: action === 'syncOrg' ? '按目录编码更新此租户机构，保留已有机构及用户关联。' : undefined,
		async onOk() {
			if (version !== sessionBoundary.version) return;
			busy.value = true;
			try {
				if (action === 'delete') await removeLdap(id);
				else if (action === 'syncUser') await syncLdapUsers(id);
				else await syncLdapOrgs(id);
				if (version !== sessionBoundary.version) return;
				message.success(`${labels[action]}成功`);
				await table.reload();
			} finally {
				busy.value = false;
			}
		},
	});
}
onMounted(table.reload);
</script>

<template>
	<section class="ldap-page">
		<Form name="ldap-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="user.userInfo?.accountType === 999" name="tenantId" label="租户"><TenantSelect v-model="filters.tenantId" allow-clear /></FormItem>
			<FormItem name="keyword" label="关键字"><Input v-model:value="filters.keyword" allow-clear /></FormItem>
			<FormItem name="host" label="主机"><Input v-model:value="filters.host" allow-clear /></FormItem>
			<div class="actions">
				<Button v-if="can('page')" type="primary" html-type="submit"><Search :size="16" />查询</Button><Button @click="reset"><Reset :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar
				><Button v-if="can('add')" type="primary" :disabled="busy" @click="editor?.show(undefined, filters.tenantId)"><Plus :size="16" />新增域配置</Button></template
			>
			<template #bodyCell="{ column, record }">
				<Tag v-if="column.key === 'status'" :color="record.status === 1 ? 'green' : 'default'">{{ record.status === 1 ? '启用' : '停用' }}</Tag>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="actions">
					<Button v-if="can('update') && can('detail')" type="link" size="small" :disabled="busy" @click="editor?.show(record.id)">编辑域配置</Button>
					<Button v-if="can('delete')" type="link" size="small" danger :disabled="busy" @click="act(record, 'delete')">删除</Button>
					<Button v-if="can('syncUser')" type="link" size="small" :disabled="busy || record.status !== 1" @click="act(record, 'syncUser')">同步域账户</Button>
					<Button v-if="can('syncOrg')" type="link" size="small" :disabled="busy || record.status !== 1" @click="act(record, 'syncOrg')">同步域组织</Button>
				</div>
			</template>
		</AdminTable>
		<LdapEditor ref="editor" @saved="table.reload" />
	</section>
</template>

<style scoped>
.ldap-page {
	padding: 16px;
	min-width: 0;
}
.query-form {
	gap: 12px 0;
}
.actions {
	display: flex;
	align-items: center;
	gap: 4px;
}
</style>
