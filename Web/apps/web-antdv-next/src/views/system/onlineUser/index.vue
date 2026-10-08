<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { AuthApi } from '#/api/core/auth';
import type { OnlineUser, OnlineUserQuery } from '#/api/system/online-user';

import { computed, onMounted, onScopeDispose, reactive, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { LogOut, RotateCw, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, Modal, Select, Tag, Tooltip } from 'antdv-next';

import { getTenantOptionsApi } from '#/api';
import { onlineSession, onlineStatus } from '#/api/realtime';
import { sessionBoundary } from '#/api/session';
import { forceOffline, pageOnlineUsers } from '#/api/system/online-user';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';

defineOptions({ name: 'SysOnlineUser' });
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const canForce = computed(() => hasAccessByCodes(['sysOnlineUser:forceOffline']));
const isSuperAdmin = computed(() => user.userInfo?.accountType === 999);
const tenants = ref<AuthApi.TenantOption[]>([]);
const filters = reactive<OnlineUserQuery>({ userName: '', realName: '', tenantId: undefined });
const table = useAdminTable<OnlineUser, OnlineUserQuery>({ query: { ...filters }, load: pageOnlineUsers });
const target = ref<OnlineUser>();
const saving = ref(false);
const open = computed({
	get: () => target.value !== undefined,
	set: (value) => {
		if (!value && !saving.value) target.value = undefined;
	},
});
const columns: NonNullable<TableProps<OnlineUser>['columns']> = [
	{ title: '账号', dataIndex: 'userName', key: 'userName', width: 160 },
	{ title: '姓名', dataIndex: 'realName', key: 'realName', width: 120 },
	{ title: 'IP 地址', dataIndex: 'ip', key: 'ip', width: 150 },
	{ title: '浏览器', dataIndex: 'browser', key: 'browser', width: 140 },
	{ title: '操作系统', dataIndex: 'os', key: 'os', width: 130 },
	{ title: '连接时间', dataIndex: 'time', key: 'time', width: 180 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 70 },
];
const statusText = computed(
	() =>
		({
			connected: '已连接',
			connecting: '连接中',
			disconnected: '连接已断开',
			reconnecting: '重连中',
		})[onlineStatus.value]
);
let timer: ReturnType<typeof setTimeout> | undefined;
const refresh = () => {
	if (timer !== undefined) clearTimeout(timer);
	timer = setTimeout(() => {
		timer = undefined;
		void table.reload();
	}, 200);
};
const unsubscribe = onlineSession.subscribe('OnlineUserList', refresh);
watch(onlineStatus, (status) => {
	if (status === 'connected') refresh();
});
watch(
	() => user.userInfo?.currentTenantId,
	() => {
		filters.tenantId = undefined;
		target.value = undefined;
		void table.search({ ...filters });
	}
);

async function confirmOffline() {
	if (!target.value || !canForce.value || saving.value) return;
	const version = sessionBoundary.version;
	saving.value = true;
	try {
		await forceOffline(target.value);
		if (version !== sessionBoundary.version) return;
		target.value = undefined;
		await table.reload();
	} catch {
		// 请求层显示错误，保留目标供重试。
	} finally {
		saving.value = false;
	}
}
function reset() {
	filters.userName = '';
	filters.realName = '';
	filters.tenantId = undefined;
	void table.search({ ...filters });
}
onMounted(async () => {
	void table.reload();
	if (isSuperAdmin.value) {
		const version = sessionBoundary.version;
		try {
			const options = await getTenantOptionsApi();
			if (version === sessionBoundary.version) tenants.value = options;
		} catch {
			// 查询错误由请求层反馈，仍允许刷新在线列表。
		}
	}
});
onScopeDispose(() => {
	unsubscribe();
	if (timer !== undefined) clearTimeout(timer);
});
</script>

<template>
	<section class="online-users">
		<Form :model="filters" layout="vertical" class="online-filters" @finish="table.search({ ...filters })">
			<FormItem v-if="isSuperAdmin" label="租户">
				<Select v-model:value="filters.tenantId" :options="tenants" allow-clear aria-label="在线用户租户" />
			</FormItem>
			<FormItem label="账号"><Input v-model:value="filters.userName" allow-clear aria-label="在线用户账号" /></FormItem>
			<FormItem label="姓名"><Input v-model:value="filters.realName" allow-clear aria-label="在线用户姓名" /></FormItem>
			<div class="filter-actions">
				<Button type="primary" html-type="submit"><Search :size="16" />查询</Button>
				<Tooltip title="重置"
					><Button aria-label="重置在线用户筛选" @click="reset"><RotateCw :size="16" /></Button
				></Tooltip>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar
				><Tag :color="onlineStatus === 'connected' ? 'success' : 'warning'">{{ statusText }}</Tag></template
			>
			<template #bodyCell="{ column, record }">
				<Tooltip v-if="column.key === 'actions' && canForce" title="强制下线">
					<Button danger type="text" :aria-label="`强制下线 ${record.userName}`" @click="target = record"><LogOut :size="16" /></Button>
				</Tooltip>
			</template>
		</AdminTable>
		<Modal
			v-model:open="open"
			:title="`确定将 ${target?.userName ?? ''} 强制下线？`"
			:confirm-loading="saving"
			:ok-button-props="{ danger: true }"
			:cancel-button-props="{ disabled: saving }"
			:closable="!saving"
			:keyboard="!saving"
			:mask-closable="!saving"
			@ok="confirmOffline"
		/>
	</section>
</template>

<style scoped>
.online-users {
	min-width: 0;
}
.online-filters {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 12px;
	align-items: end;
}
.online-filters :deep(.ant-form-item) {
	margin-bottom: 0;
	min-width: 0;
}
.filter-actions {
	display: flex;
	gap: 8px;
	align-items: center;
}
@media (max-width: 480px) {
	.online-filters {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
