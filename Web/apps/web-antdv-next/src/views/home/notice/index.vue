<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { Notice, NoticeQuery, NoticeRecipient } from '#/api/system/notice';

import { computed, inject, onMounted, onScopeDispose, reactive, ref, watch } from 'vue';

import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, Form, FormItem, Input, Modal, Select, Tag, Tooltip } from 'antdv-next';

import { onlineSession, onlineStatus } from '#/api/realtime';
import { sessionBoundary } from '#/api/session';
import { pageReceivedNotices, setNoticeRead } from '#/api/system/notice';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import NoticeContent from '#/components/notice-content/index.vue';
import { noticeReadKey } from '#/components/notice-content/notice-read';

defineOptions({ name: 'ReceivedNotices' });
const notifyRead = inject(noticeReadKey, () => {});
const Eye = createIconifyIcon('lucide:eye');
const Search = createIconifyIcon('lucide:search');
const Refresh = createIconifyIcon('lucide:rotate-ccw');
const filters = reactive<NoticeQuery>({ title: '', type: undefined });
const table = useAdminTable<NoticeRecipient, NoticeQuery>({ query: { ...filters }, load: pageReceivedNotices });
const detail = ref<Notice>();
const readError = ref('');
const reading = ref(false);
const open = computed({
	get: () => detail.value !== undefined,
	set: (value) => {
		if (!value) detail.value = undefined;
	},
});
const columns: NonNullable<TableProps<NoticeRecipient>['columns']> = [
	{ title: '标题', dataIndex: ['sysNotice', 'title'], key: 'title', width: 240 },
	{ title: '类型', key: 'type', width: 90 },
	{ title: '阅读状态', key: 'readStatus', width: 110 },
	{ title: '发布者', dataIndex: ['sysNotice', 'publicUserName'], key: 'publisher', width: 130 },
	{ title: '发布时间', dataIndex: ['sysNotice', 'publicTime'], key: 'time', width: 180 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 70 },
];
async function viewDetail(record: NoticeRecipient) {
	if (!record.sysNotice) return;
	detail.value = record.sysNotice;
	readError.value = '';
	if (record.readStatus !== 1) await markRead(record.sysNotice);
}
async function markRead(notice: Notice) {
	if (notice.id === undefined || reading.value) return;
	const version = sessionBoundary.version;
	reading.value = true;
	try {
		await setNoticeRead(notice.id);
		if (version !== sessionBoundary.version) return;
		readError.value = '';
		notifyRead();
		await table.reload();
	} catch (error) {
		if (version === sessionBoundary.version) readError.value = error instanceof Error ? error.message : '设置已读失败';
	} finally {
		reading.value = false;
	}
}
function reset() {
	filters.title = '';
	filters.type = undefined;
	void table.search({ ...filters });
}
const unsubscribe = onlineSession.subscribe('PublicNotice', () => {
	void table.reload();
});
watch(onlineStatus, (status) => {
	if (status === 'connected') void table.reload();
});
onMounted(() => {
	void table.reload();
});
onScopeDispose(unsubscribe);
</script>

<template>
	<section class="received-notices">
		<Form :model="filters" layout="vertical" class="received-filters" @finish="table.search({ ...filters })">
			<FormItem label="标题"><Input v-model:value="filters.title" aria-label="接收通知标题" allow-clear /></FormItem>
			<FormItem label="类型"
				><Select
					v-model:value="filters.type"
					:options="[
						{ value: 1, label: '通知' },
						{ value: 2, label: '公告' },
					]"
					allow-clear
			/></FormItem>
			<div class="received-actions">
				<Button type="primary" html-type="submit"><Search :size="16" />查询</Button>
				<Tooltip title="重置"
					><Button aria-label="重置收件筛选" @click="reset"><Refresh :size="16" /></Button
				></Tooltip>
			</div>
		</Form>
		<AdminTable :controller="table" :columns="columns">
			<template #bodyCell="{ column, record }">
				<Tag v-if="column.key === 'readStatus'" :color="record.readStatus === 1 ? 'default' : 'processing'">{{ record.readStatus === 1 ? '已读' : '未读' }}</Tag>
				<template v-else-if="column.key === 'type'">{{ record.sysNotice?.type === 2 ? '公告' : '通知' }}</template>
				<Button v-else-if="column.key === 'actions'" type="text" :disabled="!record.sysNotice || reading" :aria-label="`查看通知 ${record.sysNotice?.title ?? ''}`" @click="viewDetail(record)"
					><Eye :size="16"
				/></Button>
			</template>
		</AdminTable>
		<Modal v-model:open="open" title="通知详情" :footer="null" centered :styles="{ body: { maxHeight: 'calc(100dvh - 160px)', overflowY: 'auto' } }">
			<Alert v-if="readError" :message="readError" type="error" show-icon />
			<template v-if="detail">
				<h3>{{ detail.title }}</h3>
				<NoticeContent :content="detail.content" />
				<Button v-if="readError" :loading="reading" @click="markRead(detail)">重试已读</Button>
			</template>
		</Modal>
	</section>
</template>

<style scoped>
.received-notices {
	min-width: 0;
}
.received-filters {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
	gap: 12px;
	align-items: end;
}
.received-filters :deep(.ant-form-item) {
	min-width: 0;
	margin-bottom: 0;
}
.received-actions {
	display: flex;
	gap: 8px;
}
.received-content {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font-family: inherit;
}
</style>
