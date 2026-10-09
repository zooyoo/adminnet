<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { SysJobCluster, SysJobTrigger, SysJobTriggerRecord } from '#/api-services/models';
import type { JobRecord } from '#/api/system/job';

import { computed, h, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, Form, FormItem, Input, message, Modal, Select, Table, Tag, Tooltip } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { jobActions, jobClusters, jobGroups, jobPage, jobRecords, triggerActions } from '#/api/system/job';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';

import JobEditor from './component/job-editor.vue';
import TriggerEditor from './component/trigger-editor.vue';
import { statusTitles, typeTitles } from './job-form';

defineOptions({ name: 'SysJob' });
type TriggerRecord = Record<string, unknown> & SysJobTrigger;
type TimelineRecord = Record<string, unknown> & SysJobTriggerRecord;
type ClusterRecord = Record<string, unknown> & SysJobCluster;
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysJob:${action}`]);
const router = useRouter();
const icons = Object.fromEntries(
	['play', 'pause', 'square', 'trash-2', 'pencil', 'plus', 'refresh-cw', 'rotate-ccw', 'search', 'list', 'history', 'alarm-clock', 'save', 'server', 'layout-dashboard'].map((name) => [
		name,
		createIconifyIcon(`lucide:${name}`),
	])
);
const query = reactive({ jobId: '', groupName: '', description: '' });
const table = useAdminTable<JobRecord, typeof query>({ query: { ...query }, load: jobPage });
const groups = ref<string[]>([]);
const editorOpen = ref(false);
const editing = ref<JobRecord>();
const selected = ref<JobRecord>();
const triggerOpen = ref(false);
const editingTrigger = ref<SysJobTrigger>();
const busy = ref(false);
const error = ref('');
const action = ref<{ title: string; name: keyof typeof jobActions | keyof typeof triggerActions; jobId: string; triggerId?: string }>();
const recordsOpen = ref(false);
const recordJobId = ref('');
const recordTriggerId = ref('');
const records = useAdminTable<TimelineRecord, { jobId: string; triggerId: string }>({ query: { jobId: '', triggerId: '' }, load: jobRecords });
const clusterOpen = ref(false);
const clusters = ref<ClusterRecord[]>([]);
const clusterLoading = ref(false);
const clusterError = ref('');
let active = true;
let operation: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
lifetime.signal.addEventListener('abort', clearTransient);
let poll: ReturnType<typeof setInterval> | undefined;
const selectedTriggers = computed(() => table.rows.value.find((row) => row.jobId === selected.value?.jobId)?.jobTriggers ?? []);
const jobColumns: NonNullable<TableProps<JobRecord>['columns']> = [
	{ title: '任务编号', dataIndex: 'jobId', width: 220 },
	{ title: '分组', dataIndex: 'groupName', width: 140 },
	{ title: '创建类型', key: 'type', width: 100 },
	{ title: '描述', dataIndex: 'description', width: 200 },
	{ title: '执行策略', key: 'policy', width: 110 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 300 },
];
const triggerColumns: NonNullable<TableProps<TriggerRecord>['columns']> = [
	{ title: '触发器编号', dataIndex: 'triggerId', width: 200 },
	{ title: '类型', dataIndex: 'triggerType', width: 220 },
	{ title: '参数', dataIndex: 'args', width: 200 },
	{ title: '状态', key: 'status', width: 110 },
	{ title: '最近运行', dataIndex: 'lastRunTime', width: 170 },
	{ title: '下次运行', dataIndex: 'nextRunTime', width: 170 },
	{ title: '运行 / 出错次数', key: 'counts', width: 130 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 190 },
];
const recordColumns: NonNullable<TableProps<TimelineRecord>['columns']> = [
	{ title: '任务', dataIndex: 'jobId', width: 200 },
	{ title: '触发器', dataIndex: 'triggerId', width: 200 },
	{ title: '最近运行', dataIndex: 'lastRunTime', width: 175 },
	{ title: '状态', key: 'status', width: 110 },
	{ title: '耗时（毫秒）', dataIndex: 'elapsedTime', width: 130 },
	{ title: '结果', dataIndex: 'result', width: 260 },
];
const clusterColumns: NonNullable<TableProps<ClusterRecord>['columns']> = [
	{ title: '集群编号', dataIndex: 'clusterId' },
	{ title: '描述', dataIndex: 'description' },
	{ title: '状态', key: 'status' },
	{ title: '更新时间', dataIndex: 'updatedTime' },
];
const actionOptions: Array<{ name: keyof typeof jobActions; title: string; icon: string }> = [
	{ name: 'runJob', title: '立即运行', icon: 'play' },
	{ name: 'pauseJob', title: '暂停任务', icon: 'pause' },
	{ name: 'startJob', title: '启动任务', icon: 'play' },
	{ name: 'cancelJob', title: '取消运行', icon: 'square' },
	{ name: 'deleteJobDetail', title: '删除任务', icon: 'trash-2' },
];
const globalActions: Array<{ name: keyof typeof jobActions; title: string; icon: string }> = [
	{ name: 'startAllJob', title: '启动所有任务', icon: 'play' },
	{ name: 'pauseAllJob', title: '暂停所有任务', icon: 'pause' },
	{ name: 'cancelSleep', title: '唤醒调度器', icon: 'alarm-clock' },
	{ name: 'persistAll', title: '持久化所有任务', icon: 'save' },
	{ name: 'clearJobTriggerRecord', title: '清空全部运行记录', icon: 'trash-2' },
];
async function search() {
	table.query.value = { ...query };
	await table.search();
}
function edit(record?: JobRecord) {
	editing.value = record;
	editorOpen.value = true;
}
function editTrigger(record?: SysJobTrigger) {
	editingTrigger.value = record;
	triggerOpen.value = true;
}
async function savedJob() {
	await table.reload();
	try {
		groups.value = await jobGroups(lifetime.signal);
	} catch {
		/* 请求层统一提示分组加载失败。 */
	}
}
function clearTransient() {
	operation?.abort();
	busy.value = false;
	clusterLoading.value = false;
	editorOpen.value = false;
	triggerOpen.value = false;
	recordsOpen.value = false;
	clusterOpen.value = false;
	action.value = undefined;
	selected.value = undefined;
	clusters.value = [];
}
async function execute() {
	if (busy.value || !action.value) return;
	const value = action.value;
	const generation = sessionBoundary.version;
	const controller = new AbortController();
	operation = controller;
	const valid = () => active && generation === sessionBoundary.version && !controller.signal.aborted;
	busy.value = true;
	error.value = '';
	try {
		if (value.triggerId !== undefined) await triggerActions[value.name as keyof typeof triggerActions](value.jobId, value.triggerId, controller.signal);
		else await jobActions[value.name as keyof typeof jobActions](value.jobId, controller.signal);
		if (!valid()) return;
		action.value = undefined;
		message.success(`${value.title}请求已完成`);
		await table.reload();
		if (recordsOpen.value) await records.reload();
	} catch (cause) {
		if (valid()) error.value = cause instanceof Error ? cause.message : '调度操作失败';
	} finally {
		if (valid()) busy.value = false;
	}
}
async function showRecords(jobId: string, triggerId = '') {
	recordJobId.value = jobId;
	recordTriggerId.value = triggerId;
	records.query.value = { jobId, triggerId };
	recordsOpen.value = true;
	await records.search();
}
async function loadClusters() {
	if (clusterLoading.value) return;
	const generation = sessionBoundary.version;
	const controller = new AbortController();
	operation = controller;
	const valid = () => active && generation === sessionBoundary.version && !controller.signal.aborted;
	clusterLoading.value = true;
	clusterError.value = '';
	try {
		const result = await jobClusters(controller.signal);
		if (valid()) clusters.value = result;
	} catch (cause) {
		if (valid()) clusterError.value = cause instanceof Error ? cause.message : '集群加载失败';
	} finally {
		if (valid()) clusterLoading.value = false;
	}
}
function stopPoll() {
	if (poll) clearInterval(poll);
	poll = undefined;
}
function startPoll() {
	stopPoll();
	poll = setInterval(() => {
		if (active && !busy.value && !editorOpen.value && !triggerOpen.value && !table.loading.value && !table.error.value && can('pageJobDetail')) void table.reload();
	}, 5000);
}
onMounted(async () => {
	if (can('pageJobDetail')) {
		await table.reload();
		try {
			groups.value = await jobGroups(lifetime.signal);
		} catch {
			groups.value = [];
		}
	}
	startPoll();
});
onActivated(() => {
	active = true;
	startPoll();
});
onDeactivated(() => {
	active = false;
	clearTransient();
	stopPoll();
});
onScopeDispose(() => {
	active = false;
	lifetime.abort();
	sessionBoundary.release(lifetime);
	stopPoll();
});
</script>

<template>
	<div class="job-page p-4">
		<section class="job-heading mb-4">
			<h2 class="mb-4 text-lg font-semibold">任务调度</h2>
			<Form layout="inline" :model="query" class="job-search">
				<FormItem label="任务编号"><Input v-model:value="query.jobId" aria-label="查询任务编号" allow-clear /></FormItem>
				<FormItem name="groupName" label="分组"
					><Select v-model:value="query.groupName" aria-label="查询分组" :options="groups.map((value) => ({ label: value, value }))" allow-clear style="width: 150px"
				/></FormItem>
				<FormItem label="描述"><Input v-model:value="query.description" aria-label="查询任务描述" allow-clear /></FormItem>
				<FormItem><Button v-if="can('pageJobDetail')" :icon="h(icons.search!)" :loading="table.loading.value" @click="search">查询任务</Button></FormItem>
				<FormItem
					><Tooltip title="重置查询"
						><Button
							aria-label="重置查询"
							:icon="h(icons['rotate-ccw']!)"
							@click="
								Object.assign(query, { jobId: '', groupName: '', description: '' });
								search();
							" /></Tooltip
				></FormItem>
			</Form>
			<div class="job-toolbar mt-4">
				<Button v-if="can('addJobDetail')" type="primary" :icon="h(icons.plus!)" :disabled="busy" @click="edit()">新增任务</Button>
				<template v-for="item in globalActions" :key="item.name"
					><Tooltip v-if="can(item.name)" :title="item.title"
						><Button :aria-label="item.title" :icon="h(icons[item.icon]!)" :disabled="busy" :danger="item.name === 'clearJobTriggerRecord'" @click="action = { ...item, jobId: '' }" /></Tooltip
				></template>
				<Button
					v-if="can('jobClusterList')"
					:icon="h(icons.server!)"
					@click="
						clusterOpen = true;
						loadClusters();
					"
					>查看集群</Button
				>
				<Button v-if="can('pageJobDetail')" :icon="h(icons['layout-dashboard']!)" @click="router.push('/platform/job/dashboard')">打开独立调度看板</Button>
			</div>
		</section>
		<Alert v-if="!can('pageJobDetail')" type="warning" title="没有任务查询权限" />
		<AdminTable v-else :controller="table" :columns="jobColumns" row-key="jobId">
			<template #bodyCell="{ column, record }">
				<Tag v-if="column.key === 'type'">{{ typeTitles[record.createType ?? 0] }}</Tag>
				<span v-else-if="column.key === 'policy'">{{ record.concurrent ? '允许并行' : '串行执行' }}</span>
				<div v-else-if="column.key === 'actions'" class="job-actions">
					<Tooltip v-if="can('updateJobDetail')" title="编辑任务"><Button aria-label="编辑任务" :icon="h(icons.pencil!)" size="small" @click="edit(record)" /></Tooltip>
					<Tooltip title="触发器"><Button aria-label="触发器" :icon="h(icons.list!)" size="small" @click="selected = record" /></Tooltip>
					<Tooltip v-if="can('pageJobTriggerRecord')" title="运行记录"><Button aria-label="运行记录" :icon="h(icons.history!)" size="small" @click="showRecords(record.jobId)" /></Tooltip>
					<template v-for="item in actionOptions" :key="item.name"
						><Tooltip v-if="can(item.name)" :title="item.title"
							><Button
								:aria-label="item.title"
								:icon="h(icons[item.icon]!)"
								size="small"
								:disabled="busy"
								:danger="item.name === 'deleteJobDetail'"
								@click="action = { ...item, jobId: record.jobId }" /></Tooltip
					></template>
				</div>
			</template>
		</AdminTable>
		<section v-if="selected" class="job-triggers mt-4">
			<h3 class="mb-3 font-semibold">触发器 · {{ selected.jobId }}</h3>
			<div class="job-toolbar mb-3">
				<Button v-if="can('addJobTrigger')" type="primary" :icon="h(icons.plus!)" @click="editTrigger()">新增触发器</Button
				><Button :icon="h(icons['refresh-cw']!)" :loading="table.loading.value" @click="table.reload">刷新触发器</Button><Button @click="selected = undefined">收起触发器</Button>
			</div>
			<Table :columns="triggerColumns" :data-source="selectedTriggers" row-key="triggerId" :pagination="false" :scroll="{ x: 1620 }" size="small">
				<template #bodyCell="{ column, record }">
					<Tag v-if="column.key === 'status'" :color="record.status === 2 ? 'green' : record.status === 3 ? 'orange' : 'blue'">{{ statusTitles[record.status ?? 0] }}</Tag>
					<span v-else-if="column.key === 'counts'">{{ record.numberOfRuns }} / {{ record.numberOfErrors }}</span>
					<div v-else-if="column.key === 'actions'" class="job-actions">
						<Tooltip v-if="can('updateJobTrigger')" title="编辑触发器"
							><Button aria-label="编辑触发器" :icon="h(icons.pencil!)" size="small" :disabled="!record.id" @click="editTrigger(record)"
						/></Tooltip>
						<Tooltip v-if="can('pageJobTriggerRecord')" title="触发记录"
							><Button aria-label="触发记录" :icon="h(icons.history!)" size="small" @click="showRecords(record.jobId, record.triggerId)"
						/></Tooltip>
						<Tooltip v-if="can('startTrigger')" title="启动触发器"
							><Button aria-label="启动触发器" :icon="h(icons.play!)" size="small" @click="action = { name: 'startTrigger', title: '启动触发器', jobId: record.jobId, triggerId: record.triggerId }"
						/></Tooltip>
						<Tooltip v-if="can('pauseTrigger')" title="暂停触发器"
							><Button aria-label="暂停触发器" :icon="h(icons.pause!)" size="small" @click="action = { name: 'pauseTrigger', title: '暂停触发器', jobId: record.jobId, triggerId: record.triggerId }"
						/></Tooltip>
						<Tooltip v-if="can('deleteJobTrigger')" title="删除触发器"
							><Button
								aria-label="删除触发器"
								:icon="h(icons['trash-2']!)"
								size="small"
								danger
								@click="action = { name: 'deleteJobTrigger', title: '删除触发器', jobId: record.jobId, triggerId: record.triggerId }"
						/></Tooltip>
					</div>
				</template>
			</Table>
		</section>
		<JobEditor v-model:open="editorOpen" :record="editing" @saved="savedJob" />
		<TriggerEditor v-if="selected" v-model:open="triggerOpen" :job-id="selected.jobId" :record="editingTrigger" @saved="table.reload" />
		<Modal
			:open="!!action"
			:title="`确认${action?.title ?? ''}`"
			:confirm-loading="busy"
			:closable="!busy"
			:keyboard="!busy"
			:mask="{ closable: false }"
			:cancel-button-props="{ disabled: busy }"
			ok-text="确认执行"
			@ok="execute"
			@cancel="
				action = undefined;
				error = '';
			"
		>
			<Alert v-if="error" type="error" :title="error" show-icon />
			<p>{{ action?.jobId ? `目标任务：${action.jobId}` : '此操作影响调度引擎中的所有任务或全部记录，不只影响查询结果。' }}</p>
			<p v-if="action?.triggerId">目标触发器：{{ action.triggerId }}</p>
			<p v-if="action?.name === 'cancelJob'">仅取消正在执行且遵守 CancellationToken 的作业，不删除任务定义。</p>
		</Modal>
		<Modal v-model:open="recordsOpen" :title="`运行记录 · ${recordJobId}${recordTriggerId ? ` / ${recordTriggerId}` : ''}`" :width="1100" :footer="null">
			<Button :loading="records.loading.value" class="mb-3" @click="records.reload">刷新运行记录</Button>
			<AdminTable :controller="records" :columns="recordColumns"
				><template #bodyCell="{ column, record }"
					><Tag v-if="column.key === 'status'">{{ statusTitles[record.status ?? 0] }}</Tag></template
				></AdminTable
			>
		</Modal>
		<Modal v-model:open="clusterOpen" title="任务集群" :width="1000" :footer="null">
			<Alert v-if="clusterError" type="error" :title="clusterError" />
			<Button :loading="clusterLoading" class="mb-3" @click="loadClusters">刷新集群</Button>
			<Table :columns="clusterColumns" :data-source="clusters" row-key="clusterId" :loading="clusterLoading" :pagination="false"
				><template #bodyCell="{ column, record }"
					><Tag v-if="column.key === 'status'">{{ ['崩溃', '运行', '等待'][record.status ?? 0] ?? record.status }}</Tag></template
				></Table
			>
		</Modal>
	</div>
</template>

<style scoped>
.job-toolbar,
.job-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.job-search {
	row-gap: 12px;
}
.job-heading,
.job-triggers {
	padding: 16px 0;
	border-bottom: 1px solid hsl(var(--border));
}
.job-actions {
	flex-wrap: nowrap;
	gap: 6px;
}
.job-actions :deep(button) {
	width: 28px;
	height: 28px;
}
.job-page :deep(.ant-table-cell) {
	overflow-wrap: anywhere;
}
</style>
