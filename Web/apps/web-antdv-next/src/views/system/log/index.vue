<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { LogKind, LogQuery, LogRecord } from '#/api/system/log';

import { computed, h, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, watch } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Alert, Button, DatePicker, Form, FormItem, Input, InputNumber, message, Modal, Select, Spin, Table, Tag } from 'antdv-next';

import { decodeFileResponse, downloadFile } from '#/api/file-response';
import { sessionBoundary } from '#/api/session';
import { clearLogs, exportLogs, logDetail, logPage } from '#/api/system/log';
import AdminTable from '#/components/admin-table/index.vue';
import { useAdminTable } from '#/components/admin-table/use-admin-table';
import TenantSelect from '#/components/admin/tenant-select.vue';

import { diffChunks, formatDiffSql } from './log-diff';

const props = defineProps<{ kind: LogKind }>();
const { hasAccessByCodes } = useAccess();
const user = useUserStore();
const isSuperAdmin = computed(() => user.userInfo?.accountType === 999);
const prefix = computed(() => ({ diff: 'sysDifflog', ex: 'sysExlog', op: 'sysOplog', vis: 'sysVislog' })[props.kind]);
const can = (action: string) => hasAccessByCodes([`${prefix.value}:${action}`]);
const labels = { diff: '数据差异日志', ex: '异常日志', op: '操作日志', vis: '访问日志' } as const;
const icons = Object.fromEntries(['download', 'trash-2', 'search', 'refresh-cw'].map((name) => [name, h(createIconifyIcon(`lucide:${name}`))]));
const query = reactive<LogQuery>({ startTime: undefined, endTime: undefined, account: '', controllerName: '', actionName: '', remoteIp: '', status: '', elapsed: undefined, tenantId: undefined });
const table = useAdminTable<LogRecord, LogQuery>({ query: { ...query }, load: (value, signal) => logPage(props.kind, value, AbortSignal.any([signal, viewController.signal])) });
const detailOpen = ref(false);
const detailLoading = ref(false);
const detailError = ref('');
const detail = ref<LogRecord>();
const clearOpen = ref(false);
const busy = ref(false);
const actionError = ref('');
let active = true;
let generation = 0;
let viewController = new AbortController();
let detailController: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
function cancelTransient() {
	active = false;
	generation += 1;
	viewController.abort();
	detailController?.abort();
	detailOpen.value = false;
	clearOpen.value = false;
	detail.value = undefined;
	busy.value = false;
}
lifetime.signal.addEventListener('abort', cancelTransient);
const columns = computed<NonNullable<TableProps<LogRecord>['columns']>>(() => {
	if (props.kind === 'diff')
		return [
			{ title: '差异操作', dataIndex: 'diffType', width: 120 },
			{ title: '业务对象', dataIndex: 'businessData', width: 220 },
			{ title: '耗时（ms）', dataIndex: 'elapsed', width: 110 },
			{ title: '时间', dataIndex: 'createTime', width: 190 },
			{ title: '详情', key: 'detail', width: 90 },
		];
	const identity = [
		{ title: '账号', dataIndex: 'account', width: 130 },
		{ title: '真实姓名', dataIndex: 'realName', width: 130 },
		{ title: 'IP', dataIndex: 'remoteIp', width: 150 },
		{ title: '登录地点', dataIndex: 'location', width: 160 },
		{ title: '经度', dataIndex: 'longitude', width: 110 },
		{ title: '纬度', dataIndex: 'latitude', width: 110 },
		{ title: '浏览器', dataIndex: 'browser', width: 160 },
		{ title: '操作系统', dataIndex: 'os', width: 140 },
	];
	const outcome = [
		{ title: '状态', key: 'status', width: 90 },
		{ title: '耗时(ms)', dataIndex: 'elapsed', width: 110 },
		{ title: '时间', dataIndex: 'logDateTime', width: 190 },
	];
	if (props.kind === 'vis') return [{ title: '模块', dataIndex: 'controllerName', width: 170 }, { title: '方法', dataIndex: 'actionName', width: 170 }, ...identity, ...outcome];
	return [
		{ title: '模块', dataIndex: 'controllerName', width: 170 },
		{ title: '显示名称', dataIndex: 'displayTitle', width: 180 },
		{ title: '方法', dataIndex: 'actionName', width: 170 },
		{ title: '请求方式', dataIndex: 'httpMethod', width: 100 },
		{ title: '请求地址', dataIndex: 'requestUrl', width: 280 },
		{ title: '级别', dataIndex: 'logLevel', key: 'level', width: 100 },
		{ title: '事件Id', dataIndex: 'eventId', width: 100 },
		{ title: '线程Id', dataIndex: 'threadId', sorter: true, width: 110 },
		{ title: '请求跟踪Id', dataIndex: 'traceId', sorter: true, width: 190 },
		...identity,
		...outcome,
		{ title: '详情', key: 'detail', width: 90 },
	];
});
const filters = computed(() =>
	props.kind === 'vis' ? ['actionName', 'account', 'remoteIp', 'status', 'elapsed'] : props.kind === 'diff' ? [] : ['controllerName', 'actionName', 'account', 'remoteIp', 'status', 'elapsed']
);
function search() {
	void table.search({ ...query, page: 1 });
}
function reset() {
	Object.assign(query, { startTime: undefined, endTime: undefined, account: '', controllerName: '', actionName: '', remoteIp: '', status: '', elapsed: undefined, tenantId: undefined });
	void table.reset();
}
async function showDetail(record: LogRecord) {
	if (props.kind === 'vis' || !record.id || !can('page')) return;
	detailController?.abort();
	detailController = new AbortController();
	const current = ++generation;
	const version = sessionBoundary.version;
	const valid = () => active && current === generation && version === sessionBoundary.version && detailOpen.value;
	detailOpen.value = true;
	detailLoading.value = true;
	detailError.value = '';
	detail.value = undefined;
	try {
		const result = await logDetail(props.kind, record.id, AbortSignal.any([viewController.signal, detailController.signal]));
		if (valid()) {
			if (!result) throw new Error('日志不存在或无权查看');
			detail.value = { ...result };
		}
	} catch (cause) {
		if (valid()) detailError.value = cause instanceof Error ? cause.message : '详情加载失败';
	} finally {
		if (valid()) detailLoading.value = false;
	}
}
async function clear() {
	if (!can('clear') || !isSuperAdmin.value || props.kind === 'diff' || busy.value) return;
	const version = sessionBoundary.version;
	busy.value = true;
	actionError.value = '';
	try {
		await clearLogs(props.kind, viewController.signal);
		if (active && version === sessionBoundary.version) {
			message.success('日志已清空');
			clearOpen.value = false;
			await table.reload();
		}
	} catch (cause) {
		if (active && version === sessionBoundary.version) actionError.value = cause instanceof Error ? cause.message : '清空失败';
	} finally {
		if (active) busy.value = false;
	}
}
async function exportLog() {
	if (!can('export') || !['ex', 'op'].includes(props.kind)) return;
	const version = sessionBoundary.version;
	try {
		const response = await exportLogs(props.kind as 'ex' | 'op', { startTime: query.startTime, endTime: query.endTime, tenantId: query.tenantId }, viewController.signal);
		const decoded = await decodeFileResponse(response, `${labels[props.kind]}.xlsx`);
		if (active && version === sessionBoundary.version && decoded.kind === 'file') downloadFile(decoded.file);
	} catch (cause) {
		if (active && version === sessionBoundary.version) message.error(cause instanceof Error ? cause.message : '导出失败');
	}
}
function logLevelLabel(value: unknown) {
	return ({ 1: '调试', 2: '消息', 3: '警告', 4: '错误' } as Record<number, string>)[Number(value)] || '其他';
}
function parse(value: unknown) {
	if (typeof value !== 'string') return value;
	try {
		return JSON.parse(value);
	} catch {
		return value;
	}
}
const diffRows = computed(() => {
	if (props.kind !== 'diff' || !detail.value) return [];
	const groups = parse(detail.value.diffData);
	if (!Array.isArray(groups)) return [];
	return groups.flatMap((group: Record<string, unknown>, groupIndex: number) => {
		const columns = group.columns ?? group.Columns;
		return Array.isArray(columns)
			? columns.map((column: Record<string, unknown>, index: number) => ({
					key: [groupIndex, index].join('-'),
					tableName: group.tableName ?? group.TableName,
					tableDescription: group.tableDescription ?? group.TableDescription,
					columnName: column.columnName ?? column.ColumnName,
					columnDescription: column.columnDescription ?? column.ColumnDescription,
					beforeValue: column.beforeValue ?? column.BeforeValue,
					afterValue: column.afterValue ?? column.AfterValue,
				}))
			: [];
	});
});
const diffParameters = computed(() => {
	const values = parse(detail.value?.parameters);
	return Array.isArray(values)
		? values.map((value: Record<string, unknown>, index: number) => ({
				key: index,
				parameterName: value.parameterName ?? value.ParameterName,
				dbType: value.dbType ?? value.DbType,
				value: value.value ?? value.Value,
			}))
		: [];
});
onMounted(() => {
	if (can('page')) void table.reload();
});
watch(detailOpen, (open) => {
	if (!open) {
		detailController?.abort();
		generation += 1;
		detail.value = undefined;
	}
});
onActivated(() => {
	if (!active) {
		active = true;
		viewController = new AbortController();
		if (can('page')) void table.reload();
	}
});
onDeactivated(cancelTransient);
onScopeDispose(() => {
	cancelTransient();
	lifetime.signal.removeEventListener('abort', cancelTransient);
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<main class="log-page">
		<header>
			<div>
				<h1>{{ labels[kind] }}</h1>
			</div>
			<div class="actions">
				<Button :icon="icons['refresh-cw']" aria-label="刷新日志" :disabled="!can('page')" @click="table.reload" /><Button
					v-if="['op', 'ex'].includes(kind) && can('export')"
					:icon="icons.download"
					@click="exportLog"
					>导出</Button
				><Button v-if="kind !== 'diff' && can('clear') && isSuperAdmin" :disabled="kind === 'vis'" danger :icon="icons['trash-2']" @click="clearOpen = true">清空</Button>
			</div>
		</header>
		<Form name="log-filters" :colon="false" :model="query" layout="inline" class="log-filters" @finish="search"
			><FormItem v-if="isSuperAdmin" name="tenantId" label="租户"><TenantSelect v-model="query.tenantId" allow-clear /></FormItem
			><FormItem name="startTime" label="开始时间"><DatePicker v-model:value="query.startTime" show-time value-format="YYYY-MM-DD HH:mm:ss" /></FormItem
			><FormItem name="endTime" label="结束时间"><DatePicker v-model:value="query.endTime" show-time value-format="YYYY-MM-DD HH:mm:ss" /></FormItem
			><FormItem v-if="filters.includes('controllerName')" name="controllerName" label="模块"><Input v-model:value="query.controllerName" allow-clear /></FormItem
			><FormItem v-if="filters.includes('actionName')" name="actionName" label="方法"><Input v-model:value="query.actionName" allow-clear /></FormItem
			><FormItem v-if="filters.includes('account')" name="account" label="账号"><Input v-model:value="query.account" allow-clear /></FormItem
			><FormItem v-if="filters.includes('remoteIp')" name="remoteIp" label="IP"><Input v-model:value="query.remoteIp" allow-clear /></FormItem
			><FormItem v-if="filters.includes('status')" name="status" label="状态"
				><Select
					v-model:value="query.status"
					allow-clear
					:options="[
						{ label: '成功', value: '200' },
						{ label: '失败', value: 'error' },
					]" /></FormItem
			><FormItem v-if="filters.includes('elapsed')" name="elapsed" label="最小耗时"><InputNumber v-model:value="query.elapsed" :min="0" /></FormItem>
			<div class="filter-actions"><Button v-if="can('page')" type="primary" html-type="submit" :icon="icons.search">查询</Button><Button @click="reset">重置</Button></div></Form
		>
		<Alert v-if="!can('page')" type="warning" title="无日志查询权限" show-icon />
		<AdminTable v-if="can('page')" :controller="table" :columns="columns" :pagination="true" row-key="id"
			><template #bodyCell="{ column, record }"
				><Tag v-if="column.key === 'level'">{{ logLevelLabel(record.logLevel) }}</Tag
				><Tag v-else-if="column.key === 'status'" :color="record.status === '200' ? 'success' : 'error'">{{ record.status === '200' ? '成功' : '失败' }}</Tag
				><Button v-else-if="column.key === 'detail'" type="link" size="small" :disabled="!record.id || kind === 'vis'" @click="showDetail(record)">详情</Button
				><template v-else>{{ record[String(column.dataIndex)] ?? '—' }}</template></template
			></AdminTable
		>
		<Modal v-model:open="detailOpen" :title="`${labels[kind]}详情`" width="1000px" :footer="null"
			><Alert v-if="detailError" type="error" :title="detailError" show-icon /><Spin v-if="detailLoading" />
			<div v-else-if="kind === 'diff'" class="diff-detail">
				<Table
					:data-source="diffRows"
					:pagination="false"
					size="small"
					:columns="[
						{ title: '表', dataIndex: 'tableName' },
						{ title: '字段', dataIndex: 'columnName' },
						{ title: '修改前', dataIndex: 'beforeValue' },
						{ title: '修改后', dataIndex: 'afterValue' },
					]"
				>
					<template #bodyCell="{ column, record }">
						<template v-if="column.dataIndex === 'tableName'"
							>{{ record.tableName }}
							<p v-if="record.tableDescription">{{ record.tableDescription }}</p></template
						>
						<template v-else-if="column.dataIndex === 'columnName'"
							>{{ record.columnName }}
							<p v-if="record.columnDescription">{{ record.columnDescription }}</p></template
						>
						<template v-else-if="column.dataIndex === 'beforeValue' || column.dataIndex === 'afterValue'"
							><span
								v-for="(chunk, index) in diffChunks(record.beforeValue, record.afterValue, column.dataIndex === 'beforeValue')"
								:key="index"
								:class="{ 'diff-changed': chunk.changed, 'diff-delete': chunk.changed && column.dataIndex === 'beforeValue', 'diff-add': chunk.changed && column.dataIndex === 'afterValue' }"
								>{{ chunk.text }}</span
							></template
						>
					</template></Table
				>
				<Table v-if="detail?.sql" :data-source="[{ key: 'sql', sql: detail?.sql }]" :pagination="false" size="small" :columns="[{ title: 'SQL语句', dataIndex: 'sql' }]"
					><template #bodyCell="{ record }">
						<pre class="diff-sql">{{ formatDiffSql(record.sql) }}</pre>
					</template></Table
				>
				<Alert v-else type="info" title="SQL 已由服务端隐藏" />
				<Table
					v-if="diffParameters.length"
					:data-source="diffParameters"
					:pagination="false"
					size="small"
					:columns="[
						{ title: '参数名', dataIndex: 'parameterName' },
						{ title: '类型', dataIndex: 'dbType' },
						{ title: '值', dataIndex: 'value' },
					]"
				/>
				<Alert v-else type="info" title="参数已由服务端隐藏" />
			</div>
			<pre v-else class="detail-content">{{ JSON.stringify(parse(detail), null, 2) }}</pre>
		</Modal>
		<Modal
			v-model:open="clearOpen"
			title="确认清空日志"
			ok-text="确认清空"
			cancel-text="取消"
			:confirm-loading="busy"
			:closable="!busy"
			:keyboard="!busy"
			:cancel-button-props="{ disabled: busy }"
			:mask-closable="false"
			@ok="clear"
			><p>清空后无法恢复，请确认将清空全部租户的{{ labels[kind] }}。</p>
			<Alert v-if="actionError" type="error" :title="actionError" show-icon
		/></Modal>
	</main>
</template>

<style scoped>
.diff-changed {
	font-weight: 600;
	background: color-mix(in srgb, currentColor 15%, transparent);
	border-radius: 2px;
}
.diff-delete {
	color: #dc2626;
}
.diff-add {
	color: #16a34a;
}
.diff-sql {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
.log-page {
	margin: 16px;
	padding: 20px;
	background: hsl(var(--card));
}
header {
	display: flex;
	align-items: flex-start;
	justify-content: space-between;
	gap: 16px;
	margin-bottom: 16px;
}
h1 {
	margin: 0;
	font-size: 20px;
}
header p {
	margin: 6px 0;
	color: hsl(var(--muted-foreground));
}
.actions,
.filter-actions {
	display: flex;
	gap: 8px;
	align-items: center;
}
.log-filters {
	padding: 14px;
	border: 1px solid hsl(var(--border));
	border-radius: 8px;
	margin-bottom: 16px;
}
.detail-content {
	max-height: 65vh;
	overflow: auto;
	padding: 16px;
	background: hsl(var(--muted));
	white-space: pre-wrap;
	word-break: break-word;
}
</style>
