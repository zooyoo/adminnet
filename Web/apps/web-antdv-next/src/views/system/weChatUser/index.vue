<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { WechatUserQuery, WechatUserRow } from '#/api/system/wechat-user';

import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Form, FormItem, Input, Modal, Select, Table } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { wechatUserApi } from '#/api/system/wechat-user';

import { createWechatUserDraft, safeWechatAvatar, validateWechatUserDraft, wechatPlatforms } from './wechat-user-form';

defineOptions({ name: 'SysWechatUser' });
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysWechatUser:${action}`]);
const superAdmin = computed(() => user.userInfo?.accountType === 999);
const identity = computed(() =>
	[user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId, user.userInfo?.accountType, ...['page', 'add', 'update', 'delete'].map(can)].join(':')
);
const query = reactive<WechatUserQuery>({ nickName: '', mobile: '', page: 1, pageSize: 20 });
const items = ref<WechatUserRow[]>([]);
const total = ref(0);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const editorError = ref('');
const open = ref(false);
const draft = ref(createWechatUserDraft());
const deleting = ref<WechatUserRow>();
const failedAvatars = reactive(new Set<string>());
let visible = false;
let generation = 0;
let pageGeneration = 0;
const controllers = new Set<AbortController>();
const fields = [
	{ key: 'unionId', label: 'UnionId', max: 64 },
	{ key: 'nickName', label: '昵称', max: 64 },
	{ key: 'mobile', label: '手机号', max: 16 },
	{ key: 'avatar', label: '头像地址', max: 256 },
	{ key: 'language', label: '语言', max: 64 },
	{ key: 'country', label: '国家', max: 64 },
	{ key: 'province', label: '省份', max: 64 },
	{ key: 'city', label: '城市', max: 64 },
] as const;
const columns: NonNullable<TableProps<WechatUserRow>['columns']> = [
	{ title: '头像', key: 'avatar', width: 70 },
	{ title: '昵称', dataIndex: 'nickName', width: 150 },
	{ title: '平台', key: 'platform', width: 120 },
	{ title: 'OpenId', dataIndex: 'openId', width: 240 },
	{ title: '手机号', dataIndex: 'mobile', width: 150 },
	{ title: '关联账号 ID', dataIndex: 'userId', width: 190 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 170 },
];
const pagination = computed(() => ({
	current: query.page,
	pageSize: query.pageSize,
	total: total.value,
	showSizeChanger: true,
	pageSizeOptions: ['10', '20', '50', '100'],
	showTotal: (count: number) => `共 ${count} 条`,
}));
function request() {
	const controller = new AbortController();
	controllers.add(controller);
	sessionBoundary.track(controller);
	const version = sessionBoundary.version;
	const current = generation;
	return {
		controller,
		valid: () => visible && current === generation && version === sessionBoundary.version && !controller.signal.aborted,
		release: () => {
			controllers.delete(controller);
			sessionBoundary.release(controller);
		},
	};
}
async function load() {
	if (!visible || !can('page')) return;
	const current = ++pageGeneration;
	const task = request();
	loading.value = true;
	error.value = '';
	try {
		const result = await wechatUserApi.page({ ...query }, task.controller.signal);
		if (!task.valid() || current !== pageGeneration) return;
		items.value = result.items;
		total.value = result.total;
	} catch (cause) {
		if (task.valid() && current === pageGeneration) {
			items.value = [];
			total.value = 0;
			error.value = cause instanceof Error ? cause.message : '微信用户查询失败，请重试';
		}
	} finally {
		if (task.valid() && current === pageGeneration) loading.value = false;
		task.release();
	}
}
function search() {
	query.page = 1;
	void load();
}
function reset() {
	Object.assign(query, { nickName: '', mobile: '', platformType: undefined, tenantId: undefined, page: 1 });
	void load();
}
function show(row?: WechatUserRow) {
	if (busy.value || !can(row ? 'update' : 'add')) return;
	draft.value = createWechatUserDraft(row);
	editorError.value = '';
	open.value = true;
}
async function save() {
	if (busy.value || !open.value || !can(draft.value.id ? 'update' : 'add')) return;
	editorError.value = validateWechatUserDraft(draft.value, superAdmin.value);
	if (editorError.value) return;
	busy.value = true;
	const task = request();
	try {
		await (draft.value.id ? wechatUserApi.update : wechatUserApi.add)({ ...draft.value }, task.controller.signal);
		if (!task.valid()) return;
		open.value = false;
		await load();
	} catch (cause) {
		if (task.valid()) editorError.value = cause instanceof Error ? cause.message : '保存失败，输入已保留，请重试';
	} finally {
		if (task.valid()) busy.value = false;
		task.release();
	}
}
async function remove() {
	if (busy.value || !deleting.value || !can('delete')) return;
	busy.value = true;
	error.value = '';
	const task = request();
	try {
		await wechatUserApi.delete(deleting.value.id, task.controller.signal);
		if (!task.valid()) return;
		deleting.value = undefined;
		if (items.value.length === 1 && query.page > 1) query.page--;
		await load();
	} catch (cause) {
		if (task.valid()) error.value = cause instanceof Error ? cause.message : '删除失败，请重试';
	} finally {
		if (task.valid()) busy.value = false;
		task.release();
	}
}
function clear() {
	generation++;
	for (const controller of controllers) {
		controller.abort();
		sessionBoundary.release(controller);
	}
	controllers.clear();
	items.value = [];
	total.value = 0;
	open.value = false;
	deleting.value = undefined;
	draft.value = createWechatUserDraft();
	busy.value = false;
	loading.value = false;
	error.value = '';
	editorError.value = '';
	failedAvatars.clear();
}
function activate() {
	if (visible) return;
	visible = true;
	void load();
}
function deactivate() {
	visible = false;
	clear();
}
watch(
	identity,
	() => {
		clear();
		reset();
	},
	{ flush: 'sync' }
);
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onScopeDispose(deactivate);
</script>

<template>
	<div class="wechat-page">
		<Alert v-if="!can('page')" type="warning" title="当前账号没有查询微信用户权限。" show-icon />
		<template v-else>
			<Form name="wechat-query" :model="query" layout="inline" class="query" @finish="search">
				<FormItem label="查询昵称" name="nickName"><Input v-model:value="query.nickName" allow-clear /></FormItem>
				<FormItem label="查询手机号" name="mobile"><Input v-model:value="query.mobile" allow-clear /></FormItem>
				<FormItem label="查询平台" name="platformType"><Select v-model:value="query.platformType" :options="wechatPlatforms" allow-clear class="platform" /></FormItem>
				<FormItem v-if="superAdmin" label="租户 ID" name="tenantId"><Input v-model:value="query.tenantId" allow-clear /></FormItem>
				<div class="actions"><Button type="primary" html-type="submit">查询</Button><Button @click="reset">重置</Button></div>
			</Form>
			<Alert v-if="error" :title="error" type="error" show-icon />
			<div class="actions"><Button v-if="can('add')" type="primary" :disabled="busy" @click="show()">新增微信用户</Button><Button :loading="loading" @click="load">刷新列表</Button></div>
			<Table
				:columns="columns"
				:data-source="items"
				row-key="id"
				:loading="loading"
				:pagination="pagination"
				:scroll="{ x: 1190 }"
				@change="
					(page) => {
						query.page = page.current ?? 1;
						query.pageSize = page.pageSize ?? 20;
						load();
					}
				"
			>
				<template #bodyCell="{ column, record }">
					<template v-if="column.key === 'avatar'"
						><img
							v-if="safeWechatAvatar(record.avatar) && !failedAvatars.has(String(record.id))"
							:src="safeWechatAvatar(record.avatar)"
							:alt="`${record.nickName || '微信用户'}的头像`"
							width="36"
							height="36"
							referrerpolicy="no-referrer"
							@error="failedAvatars.add(String(record.id))"
						/><span v-else aria-label="暂无头像">—</span></template
					>
					<span v-else-if="column.key === 'platform'">{{ wechatPlatforms.find((item) => item.value === record.platformType)?.label ?? record.platformType }}</span>
					<div v-else-if="column.key === 'actions'" class="actions">
						<Button v-if="can('update')" type="link" :disabled="busy" @click="show(record)">编辑</Button
						><Button v-if="can('delete')" type="link" danger :disabled="busy" @click="deleting = record">删除</Button>
					</div>
				</template>
			</Table>
		</template>
		<Modal :open="open" :title="draft.id ? '编辑微信用户' : '新增微信用户'" :width="760" :footer="null" :mask-closable="false" :closable="!busy" :keyboard="!busy" @cancel="open = false">
			<Form name="wechat-editor" :model="draft" layout="vertical" :disabled="busy" @finish="save">
				<Alert v-if="editorError" :title="editorError" type="error" show-icon role="alert" />
				<div class="fields">
					<FormItem label="平台类型" name="platformType" required><Select v-model:value="draft.platformType" :options="wechatPlatforms" /></FormItem>
					<FormItem label="关联账号 ID" name="userId" :extra="superAdmin ? '填写系统账号 ID；0 表示未绑定。' : '填写本租户的系统账号 ID。'" required><Input v-model:value="draft.userId" /></FormItem>
					<FormItem label="OpenId" name="openId" :rules="[{ required: true, whitespace: true, message: '请输入 OpenId' }]" extra="平台内的用户标识，请核对后填写。"
						><Input v-model:value="draft.openId" :maxlength="64"
					/></FormItem>
					<FormItem label="性别" name="sex"
						><Select
							:value="draft.sex ?? undefined"
							:options="[
								{ label: '未知', value: 0 },
								{ label: '男', value: 1 },
								{ label: '女', value: 2 },
							]"
							allow-clear
							@update:value="draft.sex = $event === 0 || $event === 1 || $event === 2 ? $event : null"
					/></FormItem>
					<FormItem v-for="field in fields" :key="field.key" :label="field.label" :name="field.key"
						><Input :value="draft[field.key] ?? ''" :maxlength="field.max" @update:value="draft[field.key] = $event || null"
					/></FormItem>
				</div>
				<div class="actions footer"><Button :disabled="busy" @click="open = false">取消</Button><Button type="primary" html-type="submit" :loading="busy">保存资料</Button></div>
			</Form>
		</Modal>
		<Modal
			:open="!!deleting"
			title="删除微信用户"
			:confirm-loading="busy"
			:closable="!busy"
			:keyboard="!busy"
			:mask-closable="false"
			:cancel-button-props="{ disabled: busy }"
			ok-text="确认删除"
			:ok-button-props="{ danger: true }"
			@ok="remove"
			@cancel="deleting = undefined"
		>
			<p>确定删除“{{ deleting?.nickName || deleting?.openId }}”的用户资料？此操作无法撤销。</p>
			<Alert v-if="error" :title="error" type="error" show-icon />
		</Modal>
	</div>
</template>

<style scoped>
.wechat-page {
	display: flex;
	flex-direction: column;
	gap: 16px;
	padding: 16px;
}
.query {
	gap: 12px 0;
}
.platform {
	min-width: 150px;
}
.actions {
	display: flex;
	align-items: center;
	gap: 8px;
}
.fields {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	column-gap: 24px;
	margin-top: 16px;
}
.footer {
	justify-content: flex-end;
}
img {
	object-fit: cover;
	border-radius: 6px;
}
</style>
