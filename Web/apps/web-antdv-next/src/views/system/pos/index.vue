<script setup lang="ts">
import type { FormInstance, TableProps } from 'antdv-next';

import type { AuthApi } from '#/api/core/auth';
import type { Position, PositionQuery } from '#/api/system/pos';

import { computed, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Copy, createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, InputNumber, message, Modal, Popconfirm, Popover, RadioGroup, Select, Table, Tag, TextArea, Tooltip } from 'antdv-next';

import { getTenantOptionsApi } from '#/api';
import { deletePosition, listPositions, savePosition } from '#/api/system/pos';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import AuditRecord from '#/components/admin/audit-record.vue';
import { useDraggableModal } from '#/components/admin/draggable-modal';

defineOptions({ name: 'SysPos' });
const Pencil = createIconifyIcon('lucide:pencil');
const RotateCcw = createIconifyIcon('lucide:rotate-ccw');
const Trash2 = createIconifyIcon('lucide:trash-2');
const { hasAccessByCodes } = useAccess();
const user = useUserStore();
const can = (code: string) => hasAccessByCodes([`sysPos:${code}`]);
const isSuperAdmin = computed(() => user.userInfo?.accountType === 999);
const tenants = ref<AuthApi.TenantOption[]>([]);
const filters = reactive<PositionQuery>({ name: '', code: '', tenantId: isSuperAdmin.value ? user.userInfo?.currentTenantId : undefined });
const table = useAdminTable<Position, PositionQuery>({
	query: { ...filters },
	load: async (query, signal) => {
		const items = await listPositions({ name: query.name, code: query.code, tenantId: query.tenantId }, signal);
		return { items: items.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: items.length };
	},
});
const columns: NonNullable<TableProps<Position>['columns']> = [
	{ title: '序号', key: 'index', width: 65 },
	{ title: '职位名称', dataIndex: 'name', key: 'name', width: 160 },
	{ title: '职位编码', dataIndex: 'code', key: 'code', width: 160 },
	{ title: '在职人数', key: 'count', width: 100 },
	{ title: '人员明细', key: 'users', width: 120 },
	{ title: '排序', dataIndex: 'orderNo', key: 'orderNo', width: 80 },
	{ title: '状态', key: 'status', width: 80 },
	{ title: '修改记录', key: 'audit', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 130 },
];
const memberColumns = [
	{ title: '账号', dataIndex: 'account' },
	{ title: '姓名', dataIndex: 'realName' },
];
const open = ref(false);
const saving = ref(false);
const title = ref('');
const drag = useDraggableModal(open, saving);
const formRef = ref<FormInstance>();
const value = ref<Position>({ name: '', code: '', orderNo: 100, status: 1 });

function edit(record?: Position, copy = false) {
	title.value = record ? (copy ? '复制职位' : '编辑职位') : '添加职位';
	value.value = record
		? { id: copy ? undefined : record.id, name: copy ? '' : record.name, code: record.code, tenantId: record.tenantId, orderNo: record.orderNo, status: record.status, remark: record.remark }
		: { name: '', code: '', tenantId: filters.tenantId, orderNo: 100, status: 1 };
	formRef.value?.clearValidate();
	open.value = true;
}

async function save() {
	if (saving.value) return;
	try {
		await formRef.value?.validate();
		saving.value = true;
		await savePosition(value.value);
		open.value = false;
		message.success('保存成功');
		await table.reload();
	} catch {
		// 校验错误由表单显示，接口错误由统一请求层显示。
	} finally {
		saving.value = false;
	}
}

async function remove(record: Position) {
	if (!record.id) return;
	await deletePosition(record.id);
	message.success('删除成功');
	await table.reload();
}

function reset() {
	filters.name = '';
	filters.code = '';
	void table.search({ ...filters });
}

const outputOptions = {
	fileName: '职位清单',
	formatters: {
		count: (row: Position) => row.userList?.length ?? 0,
		status: (row: Position) => (row.status === 1 ? '启用' : '禁用'),
	},
};

onMounted(async () => {
	if (isSuperAdmin.value) tenants.value = await getTenantOptionsApi();
	await table.reload();
});
</script>

<template>
	<div class="position-page">
		<Form name="position-query" :model="filters" layout="inline" class="query-form" @finish="table.search({ ...filters })">
			<FormItem v-if="isSuperAdmin" name="tenantId" label="租户"><Select v-model:value="filters.tenantId" :options="tenants" allow-clear class="tenant-select" /></FormItem>
			<FormItem name="name" label="职位名称"><Input v-model:value="filters.name" allow-clear /></FormItem>
			<FormItem name="code" label="职位编码"><Input v-model:value="filters.code" allow-clear /></FormItem>
			<div class="query-actions">
				<Button v-if="can('list')" type="primary" html-type="submit"><Search :size="16" />查询</Button>
				<Button @click="reset"><RotateCcw :size="16" />重置</Button>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns" :output="can('list') ? outputOptions : undefined" selection>
			<template #toolbar>
				<Button v-if="can('add')" type="primary" @click="edit()"><Plus :size="16" />新增职位</Button>
			</template>
			<template #bodyCell="{ column, record, index }">
				<template v-if="column.key === 'index'">{{ index + 1 }}</template>
				<template v-else-if="column.key === 'count'">{{ record.userList?.length ?? 0 }}</template>
				<Popover v-else-if="column.key === 'users' && record.userList?.length" :trigger="['hover', 'click', 'focus']" :mouse-enter-delay="0.6" placement="bottom">
					<Button type="link" size="small">人员明细</Button>
					<template #content><Table :data-source="record.userList" :columns="memberColumns" row-key="id" :pagination="false" size="small" /></template>
				</Popover>
				<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '启用' : '禁用' }}</Tag>
				<AuditRecord v-else-if="column.key === 'audit'" :record="record" />
				<div v-else-if="column.key === 'actions'" class="row-actions">
					<Tooltip v-if="can('update')" title="编辑"
						><Button type="text" size="small" aria-label="编辑职位" @click="edit(record)"><Pencil :size="16" /></Button
					></Tooltip>
					<Tooltip v-if="can('add')" title="复制"
						><Button type="text" size="small" aria-label="复制职位" @click="edit(record, true)"><Copy :size="16" /></Button
					></Tooltip>
					<Popconfirm v-if="can('delete')" :title="`确定删除职位“${record.name}”？`" @confirm="remove(record)">
						<Button danger type="text" size="small" title="删除" aria-label="删除职位"><Trash2 :size="16" /></Button>
					</Popconfirm>
				</div>
			</template>
		</AdminTable>
		<Modal v-model:open="open" :modal-render="drag.render" :confirm-loading="saving" :mask-closable="false" :width="640" @ok="save">
				<template #title><div role="button" tabindex="0" :aria-label="title" :style="{ cursor: saving ? 'default' : 'move', touchAction: 'none', userSelect: 'none' }" @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.finish" @pointercancel="drag.finish" @keydown="drag.keyboard">{{ title }}</div></template>
			<Form ref="formRef" name="position-editor" :model="value" layout="vertical">
				<FormItem label="职位名称" name="name" :rules="[{ required: true, message: '请输入职位名称' }]"><Input v-model:value="value.name" /></FormItem>
				<FormItem label="职位编码" name="code" :rules="[{ required: true, message: '请输入职位编码' }]"><Input v-model:value="value.code" /></FormItem>
				<FormItem label="排序" name="orderNo"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
				<FormItem label="状态" name="status"
					><RadioGroup
						v-model:value="value.status"
						:options="[
							{ label: '启用', value: 1 },
							{ label: '禁用', value: 2 },
						]"
				/></FormItem>
				<FormItem label="备注" name="remark"><TextArea v-model:value="value.remark" :rows="3" /></FormItem>
			</Form>
		</Modal>
	</div>
</template>

<style scoped>
.position-page {
	padding: 16px;
	min-width: 0;
}
.query-form {
	display: flex;
	flex-wrap: wrap;
	gap: 12px 0;
}
.query-actions,
.row-actions {
	display: flex;
	align-items: center;
	gap: 6px;
}
.tenant-select {
	min-width: 180px;
}
.print-template-select {
	min-width: 180px;
}
@media (max-width: 640px) {
	.query-form :deep(.ant-form-item) {
		flex: 1 1 100%;
		margin-inline-end: 0;
	}
	.query-form :deep(.ant-form-item-control) {
		min-width: 0;
	}
}
</style>
