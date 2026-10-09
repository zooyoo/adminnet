<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { DbColumnOutput } from '#/api-services/models';

import { computed, h, onActivated, onDeactivated, onMounted, onScopeDispose, ref } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, Modal, Table, Tooltip } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { databaseActions } from '#/api/system/database';

import DatabaseSelector from './component/database-selector.vue';
import StructureEditor from './component/structure-editor.vue';
import { moveColumnInput } from './database-form';
import { useDatabaseSelection } from './use-database-selection';

defineOptions({ name: 'SysDatabase' });
const { hasAccessByCodes } = useAccess();
const can = (action: string) => hasAccessByCodes([`sysDatabase:${action}`]);
const selection = useDatabaseSelection();
const { columns, configId, tableName, loading, error, ready, connection, target } = selection;
const title = computed(() => connection.value?.dbNickName || configId.value);
const icons = Object.fromEntries(['plus', 'pencil', 'trash-2', 'arrow-up', 'arrow-down', 'refresh-cw'].map((name) => [name, h(createIconifyIcon(`lucide:${name}`))]));
const editing = ref(false);
const mode = ref<'addColumn' | 'addTable' | 'updateColumn' | 'updateTable'>('addTable');
const selectedColumn = ref<DbColumnOutput>();
const action = ref<{ title: string; column: DbColumnOutput; index: number; direction?: 'down' | 'up' }>();
const busy = ref(false);
const actionError = ref('');
const unavailable = computed(() => loading.value || editing.value || !!action.value || busy.value);
let active = true;
let operation: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
const tableColumns: NonNullable<TableProps<DbColumnOutput>['columns']> = [
	{ title: '序号', key: 'index', width: 60 },
	{ title: '字段名', dataIndex: 'dbColumnName', width: 180 },
	{ title: '类型', dataIndex: 'dataType', width: 150 },
	{ title: '主键', dataIndex: 'isPrimarykey', key: 'flag', width: 70 },
	{ title: '自增', dataIndex: 'isIdentity', key: 'flagIdentity', width: 70 },
	{ title: '可空', dataIndex: 'isNullable', key: 'flagNullable', width: 70 },
	{ title: '长度', dataIndex: 'length', width: 70 },
	{ title: '小数位', dataIndex: 'decimalDigits', width: 75 },
	{ title: '默认值', dataIndex: 'defaultValue', width: 180 },
	{ title: '描述', dataIndex: 'columnDescription', width: 220 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 165 },
];
function clearTransient() {
	operation?.abort();
	selection.cancel();
	editing.value = false;
	action.value = undefined;
	busy.value = false;
}
lifetime.signal.addEventListener('abort', clearTransient);
function edit(next: typeof mode.value, column?: DbColumnOutput) {
	mode.value = next;
	selectedColumn.value = column;
	editing.value = true;
}
async function saved(name: string) {
	await selection.selectConnection(configId.value, name);
}
async function execute() {
	if (!action.value || busy.value) return;
	const snapshot = action.value;
	const selectedTarget = { ...target.value };
	const version = sessionBoundary.version;
	operation = new AbortController();
	const signal = operation.signal;
	const valid = () => active && version === sessionBoundary.version && !signal.aborted;
	busy.value = true;
	actionError.value = '';
	try {
		if (snapshot.direction) await databaseActions.moveColumn(moveColumnInput(selectedTarget, columns.value, snapshot.index, snapshot.direction), signal);
		else await databaseActions.deleteColumn(selectedTarget, snapshot.column.dbColumnName!, signal);
		if (valid()) {
			action.value = undefined;
			await selection.selectTable(selectedTarget.tableName);
		}
	} catch (cause) {
		if (valid()) actionError.value = cause instanceof Error ? cause.message : '操作失败';
	} finally {
		if (valid()) busy.value = false;
	}
}
function ask(column: DbColumnOutput, index: number, direction?: 'down' | 'up') {
	actionError.value = '';
	action.value = { title: direction ? (direction === 'up' ? '上移字段' : '下移字段') : '删除字段', column, index, direction };
}
onMounted(() => {
	if (can('list')) void selection.initialize();
});
onActivated(() => {
	const wasInactive = !active;
	active = true;
	if (wasInactive && configId.value) void selection.selectConnection(configId.value, tableName.value);
});
onDeactivated(() => {
	active = false;
	clearTransient();
});
onScopeDispose(() => {
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<main class="database-page">
		<h1>库表管理</h1>
		<Alert v-if="!can('list')" type="warning" title="无数据库管理权限" show-icon />
		<template v-else>
			<div class="database-toolbar">
				<DatabaseSelector :selection="selection" :disabled="editing || !!action || busy" />
				<div class="toolbar-actions">
					<Tooltip title="刷新结构"
						><Button :icon="icons['refresh-cw']" aria-label="刷新结构" :disabled="!configId || loading || editing || !!action" @click="selection.selectConnection(configId, tableName)"
					/></Tooltip>
					<Button v-if="can('addTable')" :icon="icons.plus" type="primary" :disabled="!ready || unavailable" @click="edit('addTable')">增加表</Button>
					<Button v-if="can('updateTable')" :icon="icons.pencil" :disabled="!tableName || unavailable || !!error" @click="edit('updateTable')">编辑表</Button>
					<Button v-if="can('addColumn')" :icon="icons.plus" :disabled="!tableName || unavailable || !!error" @click="edit('addColumn')">增加字段</Button>
					<Tooltip title="沿用原系统禁用删除表的策略"><Button :icon="icons['trash-2']" disabled danger>删除表</Button></Tooltip>
				</div>
			</div>
			<Alert v-if="error" type="error" :title="error" show-icon class="mb-4" />
			<div class="structure-title">
				<h2>{{ tableName || '字段结构' }}</h2>
				<span v-if="tableName">{{ title }} · {{ columns.length }} 个字段</span>
			</div>
			<Table
				:columns="tableColumns"
				:data-source="columns"
				row-key="dbColumnName"
				:loading="loading"
				:pagination="false"
				:scroll="{ x: 1410 }"
				size="small"
				:locale="{ emptyText: tableName ? '暂无字段' : '请选择数据库和数据表' }"
			>
				<template #bodyCell="{ column, record, index }">
					<template v-if="column.key === 'index'">{{ index + 1 }}</template>
					<template v-else-if="String(column.key).startsWith('flag')">{{ record[column.dataIndex as keyof DbColumnOutput] ? '是' : '否' }}</template>
					<div v-else-if="column.key === 'actions'" class="row-actions">
						<Tooltip :title="connection?.canMoveColumn ? '上移字段' : '当前数据库不支持物理列顺序调整'"
							><Button
								:icon="icons['arrow-up']"
								:aria-label="`上移 ${record.dbColumnName}`"
								:disabled="!can('moveColumn') || !connection?.canMoveColumn || unavailable || index === 0"
								@click="ask(record, index, 'up')"
						/></Tooltip>
						<Tooltip :title="connection?.canMoveColumn ? '下移字段' : '当前数据库不支持物理列顺序调整'"
							><Button
								:icon="icons['arrow-down']"
								:aria-label="`下移 ${record.dbColumnName}`"
								:disabled="!can('moveColumn') || !connection?.canMoveColumn || unavailable || index === columns.length - 1"
								@click="ask(record, index, 'down')"
						/></Tooltip>
						<Tooltip title="编辑字段"
							><Button v-if="can('updateColumn')" :icon="icons.pencil" :aria-label="`编辑 ${record.dbColumnName}`" :disabled="unavailable" @click="edit('updateColumn', record)"
						/></Tooltip>
						<Tooltip title="删除字段"
							><Button v-if="can('deleteColumn')" :icon="icons['trash-2']" :aria-label="`删除 ${record.dbColumnName}`" :disabled="unavailable" danger @click="ask(record, index)"
						/></Tooltip>
					</div>
				</template>
			</Table>
			<StructureEditor
				:key="mode"
				v-model:open="editing"
				:mode="mode"
				:target="target"
				:connection-title="title"
				:types="selection.types.value"
				:column="selectedColumn"
				:table="selection.tables.value.find((item) => item.name === tableName)"
				@saved="saved"
			/>
			<Modal
				:open="!!action"
				:title="`确认${action?.title ?? ''}`"
				ok-text="确认执行"
				cancel-text="取消"
				:mask-closable="false"
				:ok-button-props="{ loading: busy, danger: !action?.direction }"
				@ok="execute"
				@cancel="
					operation?.abort();
					busy = false;
					action = undefined;
				"
			>
				<p>{{ title }} / {{ tableName }} / {{ action?.column.dbColumnName }}</p>
				<Alert v-if="actionError" type="error" :title="actionError" show-icon />
			</Modal>
		</template>
	</main>
</template>

<style scoped>
.database-page {
	margin: 16px;
	padding: 20px;
	background: hsl(var(--card));
	min-width: 0;
}
h1 {
	font-size: 20px;
	font-weight: 600;
	margin-bottom: 16px;
}
.database-toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	padding-bottom: 16px;
	border-bottom: 1px solid hsl(var(--border));
	margin-bottom: 16px;
}
.toolbar-actions,
.row-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 6px;
}
.row-actions {
	flex-wrap: nowrap;
}
.row-actions :deep(button) {
	width: 32px;
	height: 32px;
	padding: 0;
}
.structure-title {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: baseline;
	margin-bottom: 12px;
	overflow-wrap: anywhere;
}
h2 {
	font-size: 16px;
	font-weight: 600;
}
.structure-title span {
	font-size: 13px;
	color: hsl(var(--muted-foreground));
}
</style>
