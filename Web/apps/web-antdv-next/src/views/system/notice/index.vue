<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { Notice, NoticeQuery } from '#/api/system/notice';

import { computed, onMounted, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon, Plus } from '@vben/icons';

import { Alert, Button, Form, FormItem, Input, Modal, Select, Tag, Tooltip } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { addNotice, deleteNotice, pageNotices, publishNotice, updateNotice } from '#/api/system/notice';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import NoticeContent from '#/components/notice-content/index.vue';
import { hasNoticeContent, noticePlainText } from '#/components/notice-content/notice-html';
import NoticeEditor from '#/components/notice-editor/index.vue';

defineOptions({ name: 'SysNotice' });
const { hasAccessByCodes } = useAccess();
const Edit = createIconifyIcon('lucide:pencil');
const Eye = createIconifyIcon('lucide:eye');
const RefreshCw = createIconifyIcon('lucide:refresh-cw');
const Send = createIconifyIcon('lucide:send');
const Trash2 = createIconifyIcon('lucide:trash-2');
const can = (action: string) => hasAccessByCodes([`sysNotice:${action}`]);
const filters = reactive<NoticeQuery>({ title: '', type: undefined });
const table = useAdminTable<Notice, NoticeQuery>({ query: { ...filters }, load: pageNotices });
const editing = ref<Notice>();
const detail = ref<Notice>();
const saving = ref(false);
const uploading = ref(false);
const validation = ref('');
const action = ref<{ kind: 'delete' | 'publish'; notice: Notice }>();
const actionOpen = computed({
	get: () => action.value !== undefined,
	set: (open) => {
		if (!open && !saving.value) action.value = undefined;
	},
});
const editorOpen = computed({
	get: () => editing.value !== undefined,
	set: (open) => {
		if (!open && !saving.value) editing.value = undefined;
	},
});
const detailOpen = computed({
	get: () => detail.value !== undefined,
	set: (open) => {
		if (!open) detail.value = undefined;
	},
});
const columns: NonNullable<TableProps<Notice>['columns']> = [
	{ title: '标题', dataIndex: 'title', key: 'title', width: 220 },
	{ title: '内容', dataIndex: 'content', key: 'content', width: 300, ellipsis: { showTitle: false } },
	{ title: '类型', key: 'type', width: 90 },
	{ title: '状态', key: 'status', width: 90 },
	{ title: '创建时间', dataIndex: 'createTime', key: 'createTime', width: 180 },
	{ title: '发布者', dataIndex: 'publicUserName', key: 'publicUserName', width: 130 },
	{ title: '发布时间', dataIndex: 'publicTime', key: 'publicTime', width: 180 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 170 },
];

function openAdd() {
	uploading.value = false;
	validation.value = '';
	editing.value = { title: '', content: '', type: 1, status: 0 };
}
function openEdit(notice: Notice) {
	uploading.value = false;
	validation.value = '';
	editing.value = { ...notice };
}
function reset() {
	filters.title = '';
	filters.type = undefined;
	void table.search({ ...filters });
}
async function save() {
	if (!editing.value || saving.value || uploading.value || !can(editing.value.id ? 'update' : 'add')) return;
	validation.value = '';
	if (!editing.value.title.trim() || editing.value.title.trim().length > 32 || !hasNoticeContent(editing.value.content) || ![1, 2].includes(editing.value.type ?? 0)) {
		validation.value = '请输入 1 至 32 个字符的标题、内容，并选择通知类型';
		return;
	}
	const version = sessionBoundary.version;
	saving.value = true;
	try {
		if (editing.value.id) await updateNotice(editing.value);
		else await addNotice({ title: editing.value.title.trim(), content: editing.value.content, type: editing.value.type ?? 1 });
		if (version !== sessionBoundary.version) return;
		editing.value = undefined;
		await table.reload();
	} catch {
		// 请求层提示错误，保留草稿供重试。
	} finally {
		saving.value = false;
	}
}
async function confirmAction() {
	const pending = action.value;
	if (!pending?.notice.id || saving.value || !can(pending.kind === 'delete' ? 'delete' : 'public')) return;
	const version = sessionBoundary.version;
	saving.value = true;
	try {
		if (pending.kind === 'publish') await publishNotice(pending.notice.id);
		else await deleteNotice(pending.notice.id);
		if (version !== sessionBoundary.version) return;
		action.value = undefined;
		await table.reload();
	} catch {
		// 请求层提示错误，保留操作目标供重试。
	} finally {
		saving.value = false;
	}
}
onMounted(() => {
	if (can('page')) void table.reload();
});
</script>

<template>
	<section class="notice-page">
		<Form :model="filters" layout="inline" class="notice-filters" @finish="table.search({ ...filters })">
			<FormItem label="标题"><Input v-model:value="filters.title" allow-clear aria-label="通知标题筛选" /></FormItem>
			<FormItem label="类型">
				<Select
					v-model:value="filters.type"
					:options="[
						{ value: 1, label: '通知' },
						{ value: 2, label: '公告' },
					]"
					allow-clear
					aria-label="通知类型筛选"
				/>
			</FormItem>
			<Button type="primary" html-type="submit"><RefreshCw :size="16" />查询</Button>
			<Tooltip title="重置"
				><Button aria-label="重置通知筛选" @click="reset"><RefreshCw :size="16" /></Button
			></Tooltip>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #toolbar>
				<Button v-if="can('add')" type="primary" @click="openAdd"><Plus :size="16" />新增通知</Button>
			</template>
			<template #bodyCell="{ column, record }">
				<template v-if="column.key === 'content'">
					<div class="notice-content-cell">
						<!-- 复用净化后的纯文本摘要，旧表格信息与详情入口同时保留。 -->
						<Tooltip :title="noticePlainText(record.content)"><span class="notice-summary">{{ noticePlainText(record.content) }}</span></Tooltip>
						<Button type="link" size="small" @click="detail = record"><Eye :size="14" />查看内容</Button>
					</div>
				</template>
				<Tag v-else-if="column.key === 'type'" :color="record.type === 2 ? 'blue' : 'cyan'">{{ record.type === 2 ? '公告' : '通知' }}</Tag>
				<Tag v-else-if="column.key === 'status'" :color="record.status === 1 ? 'success' : 'default'">{{ record.status === 1 ? '已发布' : '草稿' }}</Tag>
				<div v-else-if="column.key === 'actions'" class="row-actions">
					<Tooltip v-if="can('update') && record.status !== 1" title="编辑"
						><Button type="text" aria-label="编辑通知" @click="openEdit(record)"><Edit :size="16" /></Button
					></Tooltip>
					<Button v-if="can('public') && record.status !== 1" type="text" title="发布" aria-label="发布通知" @click="action = { kind: 'publish', notice: record }"><Send :size="16" /></Button>
					<Button v-if="can('delete') && record.status !== 1" danger type="text" title="删除" aria-label="删除通知" @click="action = { kind: 'delete', notice: record }"><Trash2 :size="16" /></Button>
				</div>
			</template>
		</AdminTable>
		<Modal
			v-model:open="editorOpen"
			:title="editing?.id ? '编辑通知' : '新增通知'"
			:width="900"
			centered
			:styles="{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }"
			:confirm-loading="saving"
			:ok-button-props="{ disabled: uploading }"
			:closable="!saving"
			:keyboard="!saving"
			:mask-closable="!saving"
			:cancel-button-props="{ disabled: saving }"
			@ok="save"
		>
			<Alert v-if="validation" :message="validation" type="error" show-icon />
			<Form v-if="editing" layout="vertical">
				<FormItem label="标题" required><Input v-model:value="editing.title" aria-label="通知标题" /></FormItem>
				<FormItem label="类型"
					><Select
						v-model:value="editing.type"
						:options="[
							{ value: 1, label: '通知' },
							{ value: 2, label: '公告' },
						]"
						aria-label="通知类型"
				/></FormItem>
				<FormItem label="内容" required><NoticeEditor v-model="editing.content" :disabled="saving" @busy="uploading = $event" /></FormItem>
			</Form>
		</Modal>
		<Modal
			v-model:open="actionOpen"
			:title="action?.kind === 'publish' ? '确定发布通知？发布后不可撤销' : '确定删除通知？'"
			:confirm-loading="saving"
			:closable="!saving"
			:keyboard="!saving"
			:mask-closable="!saving"
			:cancel-button-props="{ disabled: saving }"
			@ok="confirmAction"
		>
			<p>{{ action?.notice.title }}</p>
		</Modal>
		<Modal v-model:open="detailOpen" title="通知详情" :footer="null" centered :styles="{ body: { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }">
			<template v-if="detail">
				<h3>{{ detail.title }}</h3>
				<NoticeContent :content="detail.content" />
			</template>
		</Modal>
	</section>
</template>

<style scoped>
.notice-page {
	min-width: 0;
}
.notice-filters {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	align-items: end;
	margin-bottom: 8px;
}
.notice-filters :deep(.ant-form-item) {
	margin-bottom: 0;
}
.notice-content {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font-family: inherit;
}
.notice-content-cell {
	display: flex;
	flex-direction: column;
	min-width: 0;
}
.notice-summary {
	display: block;
	max-width: 260px;
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}
.row-actions {
	display: flex;
	gap: 2px;
}
</style>
