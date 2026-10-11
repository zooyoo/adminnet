<script setup lang="ts">
import type { FormProps, TableProps } from 'antdv-next';

import type { PluginRow } from '#/api/system/plugin';

import { computed, h, nextTick, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Card, Form, FormItem, Input, InputNumber, Modal, Select, Table } from 'antdv-next';

import { getTenantOptionsApi } from '#/api/core/auth';
import { sessionBoundary } from '#/api/session';
import { pluginApi } from '#/api/system/plugin';

import CodeEditor from './code-editor.vue';
import { createPluginState, PluginSession } from './plugin-session';

const { hasAccessByCodes } = useAccess();
const users = useUserStore();
const permissions = computed(() => ({
	page: hasAccessByCodes(['sysPlugin:page']),
	add: hasAccessByCodes(['sysPlugin:add']),
	update: hasAccessByCodes(['sysPlugin:update']),
	delete: hasAccessByCodes(['sysPlugin:delete']),
}));
const identity = computed(() => [users.userInfo?.userId, users.userInfo?.tenantId, users.userInfo?.currentTenantId, users.userInfo?.accountType].join(':'));
const superAdmin = computed(() => Number(users.userInfo?.accountType) === 999);
const state = reactive(createPluginState());
const session = new PluginSession(state, { api: pluginApi, boundary: sessionBoundary, identity: () => identity.value, permissions: () => permissions.value });
const tenantOptions = ref<Array<{ label: string; value: string }>>([]);
const tenantBusy = ref(false);
const tenantError = ref('');
const errorSummary = ref<HTMLElement>();
let visible = false;
let tenantVersion = 0;
async function loadTenants() {
	const version = ++tenantVersion;
	if (!superAdmin.value || !permissions.value.page) return;
	tenantBusy.value = true;
	tenantError.value = '';
	try {
		const options = await getTenantOptionsApi();
		if (version === tenantVersion && visible) tenantOptions.value = options.map((item) => ({ label: item.label, value: String(item.value) }));
	} catch {
		if (version === tenantVersion && visible) tenantError.value = '租户选项加载失败，请重试';
	} finally {
		if (version === tenantVersion) tenantBusy.value = false;
	}
}
function activate() {
	if (visible) return;
	visible = true;
	session.activate();
	void loadTenants();
}
function deactivate() {
	visible = false;
	tenantVersion += 1;
	tenantOptions.value = [];
	tenantBusy.value = false;
	tenantError.value = '';
	session.deactivate();
}
watch(
	[identity, permissions],
	() => {
		tenantVersion += 1;
		tenantOptions.value = [];
		tenantBusy.value = false;
		tenantError.value = '';
		session.contextChanged(visible);
		if (visible) void loadTenants();
	},
	{ flush: 'sync' }
);
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onScopeDispose(deactivate);
const columns: TableProps<PluginRow>['columns'] = [
	{ title: '功能名称', key: 'name', dataIndex: 'name', width: 180 },
	{ title: '程序集名称', key: 'assemblyName', dataIndex: 'assemblyName', width: 280 },
	{ title: '排序', key: 'orderNo', dataIndex: 'orderNo', width: 80 },
	{ title: '状态', key: 'status', width: 90 },
	{ title: '修改记录', key: 'modified', width: 200 },
	{ title: '操作', key: 'actions', width: 150, fixed: 'right' },
];
const pagination = computed(() => ({
	current: state.page,
	pageSize: state.pageSize,
	total: state.total,
	showSizeChanger: true,
	pageSizeOptions: [10, 20, 50, 100],
	showTotal: (total: number) => `共 ${total} 条`,
}));
function changePage(value: { current?: number; pageSize?: number }) {
	state.page = value.current ?? 1;
	state.pageSize = value.pageSize ?? 50;
	void session.loadPage();
}
const requiredMark: NonNullable<FormProps['requiredMark']> = (label, { required }) => h('span', [required ? h('span', { 'aria-hidden': true }, '* ') : null, label]);
async function save() {
	await session.save();
	if (Object.keys(state.errors).length > 0 || state.editorError) {
		await nextTick();
		errorSummary.value?.focus();
	}
}
function chooseStatus(value: unknown) {
	if (value === 1 || value === 2) state.draft.status = value;
}
function chooseOrder(value: unknown) {
	state.draft.orderNo = typeof value === 'number' ? value : Number.NaN;
}
</script>

<template>
	<Page class="plugin-page" title="动态插件" description="维护插件代码和程序集；启用插件保存后发布，禁用后停止提供接口。">
		<Alert v-if="!permissions.page" type="warning" title="暂无动态插件查看权限" show-icon />
		<Card v-else>
			<Form name="plugin-filter" :model="state" layout="inline" :colon="false" @finish="session.search()">
				<FormItem v-if="superAdmin" name="tenantId" label="租户">
					<div class="plugin-tenant">
						<Select v-model:value="state.tenantId" :options="tenantOptions" :loading="tenantBusy" allow-clear :show-search="{ optionFilterProp: 'label' }" style="width: 100%" placeholder="全部租户" />
					</div>
				</FormItem>
				<FormItem name="name" label="功能名称"><Input v-model:value="state.name" allow-clear :maxlength="64" placeholder="输入功能名称" /></FormItem>
				<FormItem
					><div class="plugin-actions">
						<Button html-type="submit" :auto-insert-space="false" :loading="state.listBusy">查询</Button>
						<Button :auto-insert-space="false" @click="session.search(true)">重置</Button>
						<Button v-if="permissions.add" type="primary" :auto-insert-space="false" :disabled="state.saveBusy" @click="session.openEditor()">新增插件</Button>
					</div></FormItem
				>
			</Form>
			<Alert v-if="tenantError" class="plugin-feedback" type="error" :title="tenantError" show-icon
				><template #action><Button @click="loadTenants()">重试</Button></template></Alert
			>
			<Alert v-if="state.listError" class="plugin-feedback" type="error" :title="state.listError" show-icon />
			<Alert v-if="state.notice" class="plugin-feedback" type="success" :title="state.notice" show-icon />
			<Table :columns="columns" :data-source="state.items" row-key="id" :loading="state.listBusy" :pagination="pagination" :scroll="{ x: 1000 }" @change="changePage">
				<template #bodyCell="{ column, record }">
					<template v-if="column.key === 'status'">{{ record.status === 1 ? '启用' : '禁用' }}</template>
					<template v-else-if="column.key === 'modified'">{{ [record.updateUserName || record.createUserName, record.updateTime || record.createTime].filter(Boolean).join(' / ') || '—' }}</template>
					<template v-else-if="column.key === 'actions'"
						><div class="plugin-actions">
							<Button v-if="permissions.update" type="link" :auto-insert-space="false" :disabled="state.saveBusy" @click="session.openEditor(record)">编辑</Button>
							<Button v-if="permissions.delete" type="link" danger :auto-insert-space="false" :disabled="state.deleteBusy" @click="session.requestDelete(record)">删除</Button>
						</div></template
					>
				</template>
				<template #emptyText>暂无动态插件</template>
			</Table>
		</Card>
		<Modal
			:open="state.editorOpen"
			:title="state.draft.id === undefined ? '添加动态插件' : '编辑动态插件'"
			:width="900"
			:mask-closable="false"
			:closable="!state.saveBusy"
			destroy-on-hidden
			@cancel="session.closeEditor()"
		>
			<div v-if="Object.keys(state.errors).length || state.editorError" ref="errorSummary" tabindex="-1" role="alert" class="plugin-feedback" aria-label="插件保存错误">
				<Alert type="error" :title="state.editorError || '请检查以下输入项'" show-icon />
				<ul v-if="Object.keys(state.errors).length">
					<li v-for="(error, field) in state.errors" :key="field">
						<a :href="`#plugin-editor_${field}`">{{ error }}</a>
					</li>
				</ul>
			</div>
			<Form name="plugin-editor" :model="state.draft" layout="vertical" :colon="false" :required-mark="requiredMark" :disabled="state.saveBusy" autocomplete="off" @finish="save()">
				<div class="plugin-fields">
					<FormItem name="name" label="功能名称" required :help="state.errors.name" :validate-status="state.errors.name ? 'error' : undefined"
						><Input v-model:value="state.draft.name" :maxlength="64"
					/></FormItem>
					<FormItem
						name="assemblyName"
						label="程序集名称"
						:help="state.errors.assemblyName || '留空由服务器生成；更新后的实际名称以列表为准。'"
						:validate-status="state.errors.assemblyName ? 'error' : undefined"
						><Input v-model:value="state.draft.assemblyName" :maxlength="512"
					/></FormItem>
					<FormItem name="orderNo" label="排序" :help="state.errors.orderNo" :validate-status="state.errors.orderNo ? 'error' : undefined"
						><InputNumber :value="state.draft.orderNo" :min="-2147483648" :max="2147483647" class="plugin-number" @change="chooseOrder"
					/></FormItem>
					<FormItem name="status" label="状态" :help="state.errors.status"
						><Select
							:value="state.draft.status"
							:options="[
								{ label: '启用', value: 1 },
								{ label: '禁用', value: 2 },
							]"
							@change="chooseStatus"
					/></FormItem>
				</div>
				<FormItem name="csharpCode" label="C# 代码" required :help="state.errors.csharpCode" :validate-status="state.errors.csharpCode ? 'error' : undefined"
					><CodeEditor v-if="state.editorOpen" :key="String(state.draft.id ?? 'new')" v-model:value="state.draft.csharpCode" :disabled="state.saveBusy"
				/></FormItem>
				<FormItem name="remark" label="备注" :help="state.errors.remark" :validate-status="state.errors.remark ? 'error' : undefined"
					><Input.TextArea v-model:value="state.draft.remark" :maxlength="128" :rows="2"
				/></FormItem>
			</Form>
			<template #footer
				><Button :auto-insert-space="false" :disabled="state.saveBusy" @click="session.closeEditor()">取消</Button
				><Button type="primary" :auto-insert-space="false" :loading="state.saveBusy" @click="save()">保存</Button></template
			>
		</Modal>
		<Modal :open="state.deleteRow !== undefined" title="删除动态插件" :mask-closable="false" :closable="!state.deleteBusy" destroy-on-hidden @cancel="session.cancelDelete()">
			<p>确定删除动态插件“{{ state.deleteRow?.name }}”吗？已发布的插件接口也将移除。</p>
			<Alert v-if="state.deleteError" type="error" :title="state.deleteError" show-icon />
			<template #footer
				><Button :auto-insert-space="false" :disabled="state.deleteBusy" @click="session.cancelDelete()">取消</Button
				><Button type="primary" danger :auto-insert-space="false" :loading="state.deleteBusy" @click="session.confirmDelete()">删除</Button></template
			>
		</Modal>
	</Page>
</template>

<style scoped>
.plugin-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.plugin-feedback {
	margin-block: 12px;
}
.plugin-fields {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	column-gap: 24px;
}
.plugin-tenant {
	width: 220px;
	min-width: 180px;
}
.plugin-number {
	width: 100%;
}
.plugin-code {
	font-family: Consolas, monospace;
	tab-size: 4;
}
</style>
