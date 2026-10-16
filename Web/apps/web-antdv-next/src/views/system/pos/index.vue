<script setup lang="ts">
import type { FormInstance, TableProps } from 'antdv-next';

import type { AuthApi } from '#/api/core/auth';
import type { Position, PositionQuery } from '#/api/system/pos';

import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { Copy, createIconifyIcon, Plus, Search } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Button, Form, FormItem, Input, InputNumber, message, Modal, Popconfirm, Popover, RadioGroup, Select, Table, Tag, TextArea, Tooltip } from 'antdv-next';

import { getTenantOptionsApi } from '#/api';
import { sessionBoundary } from '#/api/session';
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
const memberColumns: NonNullable<TableProps<NonNullable<Position['userList']>[number]>['columns']> = [
	{ title: '序号', key: 'index', width: 65 },
	{ title: '账号', dataIndex: 'account' },
	{ title: '姓名', dataIndex: 'realName' },
];
const open = ref(false);
const saving = ref(false);
const title = ref('');
const drag = useDraggableModal(open, saving);
const formRef = ref<FormInstance>();
const value = ref<Position>({ name: '', code: '', orderNo: 100, status: 1 });
let generation = 0;
let editorSession = sessionBoundary.version;
let editorBoundary: AbortController | undefined;
let disposed = false;
const deleteTarget = ref<Position['id']>();
const deleting = ref(false);
const deleteError = ref('');

function invalidateEditor() {
	generation += 1;
	open.value = false;
	saving.value = false;
	if (editorBoundary) {
		editorBoundary.signal.removeEventListener('abort', invalidateEditor);
		sessionBoundary.release(editorBoundary);
		editorBoundary = undefined;
	}
}

function close() {
	if (!saving.value) invalidateEditor();
}

function edit(record?: Position, copy = false) {
	if (saving.value || disposed) return;
	invalidateEditor();
	editorSession = sessionBoundary.version;
	editorBoundary = new AbortController();
	editorBoundary.signal.addEventListener('abort', invalidateEditor);
	sessionBoundary.track(editorBoundary);
	title.value = record ? (copy ? '复制职位' : '编辑职位') : '添加职位';
	value.value = record
		? { id: copy ? undefined : record.id, name: copy ? '' : record.name, code: record.code, tenantId: record.tenantId, orderNo: record.orderNo, status: record.status, remark: record.remark }
		: { name: '', code: '', tenantId: filters.tenantId, orderNo: 100, status: 1 };
	formRef.value?.clearValidate();
	open.value = true;
}

async function save() {
	if (saving.value || !open.value || disposed || editorSession !== sessionBoundary.version) return;
	const current = generation;
	const version = editorSession;
	const valid = () => current === generation && version === sessionBoundary.version && open.value && !disposed;
	saving.value = true;
	try {
		await formRef.value?.validate();
		if (!valid()) return;
		await savePosition({ ...value.value });
		if (!valid()) return;
		invalidateEditor();
		message.success('保存成功');
		await table.reload();
	} catch {
		// 校验错误由表单显示，接口错误由统一请求层显示。
	} finally {
		if (valid()) saving.value = false;
	}
}

async function remove(record: Position) {
	if (!record.id || disposed) return;
	const version = sessionBoundary.version;
	await deletePosition(record.id);
	if (disposed || version !== sessionBoundary.version) return;
	message.success('删除成功');
	const query = table.query.value;
	const page = table.page.value;
	const pageSize = table.pageSize.value;
	await table.reload();
	if (disposed || version !== sessionBoundary.version || table.loading.value || table.error.value || table.query.value !== query || table.page.value !== page || table.pageSize.value !== pageSize)
		return;
	const lastPage = Math.max(1, Math.ceil(table.total.value / pageSize));
	if (page > lastPage) {
		table.page.value = lastPage;
		await table.reload();
	}
}

function deleteOpenChanged(record: Position, open: boolean) {
	if (deleting.value || disposed) return;
	deleteTarget.value = open ? record.id : undefined;
	deleteError.value = '';
}
async function confirmRemove(record: Position) {
	if (!record.id || deleting.value || disposed) return;
	const version = sessionBoundary.version;
	deleting.value = true;
	deleteError.value = '';
	try {
		await remove(record);
		if (!disposed && version === sessionBoundary.version) deleteTarget.value = undefined;
	} catch (cause) {
		if (!disposed && version === sessionBoundary.version) deleteError.value = cause instanceof Error && cause.message ? cause.message : '职位删除失败，请重试';
	} finally {
		deleting.value = false;
		if (disposed || version !== sessionBoundary.version) {
			deleteTarget.value = undefined;
			deleteError.value = '';
		}
	}
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
onBeforeUnmount(() => {
	disposed = true;
	invalidateEditor();
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
					<template #content>
						<Table :data-source="record.userList" :columns="memberColumns" row-key="id" :pagination="false" size="small">
							<template #bodyCell="{ column: memberColumn, index: memberIndex }"
								><template v-if="memberColumn.key === 'index'">{{ memberIndex + 1 }}</template></template
							>
						</Table>
					</template>
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
					<Popconfirm
						v-if="can('delete')"
						:title="`确定删除职位“${record.name}”？`"
						:open="deleteTarget === record.id"
						:description="deleteTarget === record.id ? deleteError : ''"
						:ok-button-props="{ loading: deleting }"
						:cancel-button-props="{ disabled: deleting }"
						@open-change="(open) => deleteOpenChanged(record, open)"
						@confirm="void confirmRemove(record)"
					>
						<Button danger type="text" size="small" title="删除" aria-label="删除职位"><Trash2 :size="16" /></Button>
					</Popconfirm>
				</div>
			</template>
		</AdminTable>
		<Modal
			:open="open"
			:modal-render="drag.render"
			:confirm-loading="saving"
			:closable="!saving"
			:keyboard="!saving"
			:cancel-button-props="{ disabled: saving }"
			:ok-button-props="{ disabled: saving }"
			:mask-closable="false"
			:width="640"
			@ok="save"
			@cancel="close"
		>
				<template #title><div role="button" tabindex="0" :aria-label="title" :style="{ cursor: saving ? 'default' : 'move', touchAction: 'none', userSelect: 'none' }" @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.finish" @pointercancel="drag.finish" @keydown="drag.keyboard">{{ title }}</div></template>
			<Form ref="formRef" name="position-editor" :model="value" layout="vertical" :disabled="saving">
				<FormItem label="职位名称" name="name" :rules="[{ required: true, message: '请输入职位名称' }]"><Input v-model:value="value.name" allow-clear /></FormItem>
				<FormItem label="职位编码" name="code" :rules="[{ required: true, message: '请输入职位编码' }]"><Input v-model:value="value.code" allow-clear /></FormItem>
				<FormItem label="排序" name="orderNo"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
				<FormItem label="状态" name="status"
					><RadioGroup
						v-model:value="value.status"
						:options="[
							{ label: '启用', value: 1 },
							{ label: '禁用', value: 2 },
						]"
				/></FormItem>
				<FormItem label="备注" name="remark"><TextArea v-model:value="value.remark" :rows="3" allow-clear /></FormItem>
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
