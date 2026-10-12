<script setup lang="ts" generic="T extends Record<string, unknown>, Q extends Record<string, unknown>">
import type { TableProps } from 'antdv-next';

import type { ColumnFixed } from './column-settings';
import type { TableOutputOptions } from './table-output';
import type { AdminTableController } from './use-admin-table';

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref, useId } from 'vue';

import { ArrowDown, ArrowUp, createIconifyIcon, RotateCw, Settings } from '@vben/icons';

import { Alert, Button, Checkbox, Dropdown, message, Popover, Select, Table, Tooltip } from 'antdv-next';
import { isCancel } from 'axios';

import { sessionBoundary } from '#/api/session';

import { canMoveColumnSetting, columnSettings, configuredColumns, moveColumnSetting } from './column-settings';
import { exportTablePdf, exportWorkbook, printTable, tableMatrix } from './table-output';

const props = withDefaults(
	defineProps<{
		controller: AdminTableController<T, Q>;
		columns: NonNullable<TableProps<T>['columns']>;
		pagination?: boolean;
		selection?: boolean;
		rowKey?: string;
		output?: TableOutputOptions<T>;
		disabledSelection?: (record: T) => boolean;
		scroll?: TableProps<T>['scroll'];
		editable?: (record: T, key: string) => boolean;
		reloadDisabled?: boolean;
	}>(),
	{ pagination: true, selection: false, rowKey: 'id', output: undefined, disabledSelection: undefined, scroll: undefined, editable: undefined, reloadDisabled: false }
);

const hiddenKeys = ref<string[]>([]);
const columnControlId = useId();
const outputLoading = ref(false);
let active = true;
let outputGeneration = 0;
onActivated(() => {
	active = true;
});
onDeactivated(() => {
	active = false;
	outputGeneration += 1;
});
onBeforeUnmount(() => {
	active = false;
	outputGeneration += 1;
});
const Download = createIconifyIcon('lucide:download');
const Printer = createIconifyIcon('lucide:printer');
const orderedKeys = ref<string[]>([]);
const fixedColumns = ref<Record<string, ColumnFixed>>({});
const fixedOptions = [{ value: 'none', label: '不固定' }, { value: 'start', label: '固定左侧' }, { value: 'end', label: '固定右侧' }];
const columnOptions = computed(() => columnSettings(configuredColumns(props.columns, [], orderedKeys.value, fixedColumns.value)));
const visibleColumns = computed(() => configuredColumns(props.columns, hiddenKeys.value, orderedKeys.value, fixedColumns.value));
const pager = computed(() =>
	props.pagination
		? {
				current: props.controller.page.value,
				pageSize: props.controller.pageSize.value,
				total: props.controller.total.value,
				showSizeChanger: true,
				pageSizeOptions: ['10', '20', '50', '100'],
				showTotal: (total: number) => `共 ${total} 条`,
			}
		: false
);
const rowSelection = computed(() =>
	props.selection
		? {
				selectedRowKeys: props.controller.selectedKeys.value,
				preserveSelectedRowKeys: true,
				getCheckboxProps: (record: T) => ({ disabled: props.disabledSelection?.(record) ?? false }),
				onChange: (keys: Array<number | string>) => props.controller.setSelectedKeys(keys),
			}
		: undefined
);

const outputScope = ref<'all' | 'page' | 'selected'>('page');
const scopeOptions = computed(() => [
	{ key: 'page', label: props.pagination ? '当前页' : '当前列表' },
	...(props.selection ? [{ key: 'selected', label: '选中项' }] : []),
	{ key: 'all', label: '全部匹配结果' },
]);

async function runOutput(mode: 'all' | 'page' | 'pdf' | 'print' | 'selected') {
	if (!props.output || outputLoading.value) return;
	const version = sessionBoundary.version;
	const generation = ++outputGeneration;
	const selectedKeys = [...props.controller.selectedKeys.value];
	const isCurrent = () => active && generation === outputGeneration && version === sessionBoundary.version;
	const columns = [...visibleColumns.value];
	const config = props.output;
	outputLoading.value = true;
	try {
		const scope = mode === 'print' || mode === 'pdf' ? outputScope.value : mode;
		const records = scope === 'page' ? [...props.controller.rows.value] : await props.controller.collectAll();
		const source = scope === 'selected' ? records.filter((record) => selectedKeys.includes(record[props.rowKey] as number | string)) : records;
		if (!source.length) throw new Error(scope === 'selected' ? '请先选择数据' : '没有可输出的数据');
		if (!isCurrent()) return;
		const matrix = tableMatrix(source, columns, config.formatters);
		if (mode === 'print') await printTable(matrix, config.fileName, isCurrent);
		else if (mode === 'pdf') await exportTablePdf(matrix, config.fileName, isCurrent);
		else await exportWorkbook(matrix, config.fileName, isCurrent);
	} catch (cause) {
		if (isCurrent() && !isCancel(cause) && !(cause instanceof DOMException && cause.name === 'AbortError')) message.error(cause instanceof Error ? cause.message : '输出失败');
	} finally {
		outputLoading.value = false;
	}
}

function cellText(value: unknown) {
	return typeof value === 'string' || typeof value === 'number' ? value : '';
}

function toggleColumn(key: string) {
	hiddenKeys.value = hiddenKeys.value.includes(key) ? hiddenKeys.value.filter((item) => item !== key) : [...hiddenKeys.value, key];
}

function moveColumn(key: string, direction: -1 | 1) {
	orderedKeys.value = moveColumnSetting(columnOptions.value, key, direction);
}

function setFixed(key: string, value: unknown) {
	fixedColumns.value = { ...fixedColumns.value, [key]: value === 'start' || value === 'end' ? value : false };
}
function change(
	pagination: { current?: number; pageSize?: number },
	_filters: unknown,
	sorter: Array<{ field?: unknown; columnKey?: unknown; order?: 'ascend' | 'descend' | null }> | { field?: unknown; columnKey?: unknown; order?: 'ascend' | 'descend' | null }
) {
	const sort = Array.isArray(sorter) ? sorter[0] : sorter;
	const field = sort?.field ?? sort?.columnKey;
	void props.controller.change(pagination.current ?? 1, pagination.pageSize ?? props.controller.pageSize.value, typeof field === 'string' ? field : undefined, sort?.order);
}
</script>

<template>
	<section class="admin-table">
		<div class="table-toolbar">
			<div class="table-actions"><slot name="toolbar"></slot></div>
			<div class="table-actions">
				<Dropdown v-if="props.output" :trigger="['click']" :menu="{ items: scopeOptions }" @menu-click="({ key }) => (outputScope = key as 'all' | 'page' | 'selected')">
					<Button aria-label="输出范围">{{ scopeOptions.find((item) => item.key === outputScope)?.label }}</Button>
				</Dropdown>
				<Tooltip v-if="props.output" title="导出 PDF"
					><Button aria-label="导出 PDF" :loading="outputLoading" @click="runOutput('pdf')"><Download :size="16" /></Button
				></Tooltip>
				<Dropdown
					v-if="props.output"
					:trigger="['click']"
					:menu="{
						items: [{ key: 'page', label: '导出本页数据' }, ...(props.selection ? [{ key: 'selected', label: '导出选中数据' }] : []), { key: 'all', label: '导出全部数据' }],
					}"
					@menu-click="({ key }) => runOutput(key === 'all' ? 'all' : key === 'selected' ? 'selected' : 'page')"
				>
					<Button aria-label="导出数据" :loading="outputLoading"><Download :size="16" />导出</Button>
				</Dropdown>
				<Tooltip v-if="props.output" title="打印"
					><Button aria-label="打印" :disabled="outputLoading" @click="runOutput('print')"><Printer :size="16" /></Button
				></Tooltip>
				<Tooltip title="刷新"
					><Button aria-label="刷新" :loading="controller.loading.value" :disabled="reloadDisabled" @click="controller.reload"><RotateCw :size="16" /></Button
				></Tooltip>
				<Popover trigger="click" placement="bottomRight">
					<Tooltip title="列设置"
						><Button aria-label="列设置"><Settings :size="16" /></Button
					></Tooltip>
					<template #content>
						<div v-for="(item, index) in columnOptions" :key="item.key" class="column-option">
							<Checkbox :checked="!hiddenKeys.includes(item.key)" @change="toggleColumn(item.key)">{{ item.label }}</Checkbox>
							<label class="column-control-label" :for="`${columnControlId}-${item.key}`">固定{{ item.label }}</label><Select :id="`${columnControlId}-${item.key}`" :value="item.fixed || 'none'" :options="fixedOptions" size="small" :aria-label="`固定${item.label}`" @update:value="(value) => setFixed(item.key, value)" />
							<Button type="text" size="small" :disabled="!canMoveColumnSetting(columnOptions, index, -1)" :aria-label="`上移${item.label}`" @click="moveColumn(item.key, -1)"><ArrowUp :size="14" /></Button>
							<Button type="text" size="small" :disabled="!canMoveColumnSetting(columnOptions, index, 1)" :aria-label="`下移${item.label}`" @click="moveColumn(item.key, 1)"><ArrowDown :size="14" /></Button>
						</div>
					</template>
				</Popover>
			</div>
		</div>
		<Alert v-if="controller.error.value" :title="controller.error.value" type="error" show-icon class="mb-3" />
		<Table
			v-bind="$attrs"
			:columns="visibleColumns"
			:data-source="controller.rows.value"
			:loading="controller.loading.value"
			:pagination="pager"
			:row-selection="rowSelection"
			:row-key="rowKey"
			:scroll="scroll ?? { x: 'max-content' }"
			size="small"
			@change="change"
		>
			<template v-if="$slots.bodyCell || $slots.editCell" #bodyCell="context">
				<slot v-if="$slots.editCell && editable?.(context.record, String(context.column.key ?? context.column.dataIndex ?? ''))" name="editCell" v-bind="context" />
				<slot v-else name="bodyCell" v-bind="context">{{ cellText(context.text) }}</slot>
			</template>
			<template v-if="$slots.expandedRowRender" #expandedRowRender="context"><slot name="expandedRowRender" v-bind="context"></slot></template>
		</Table>
	</section>
</template>

<style scoped>
.admin-table {
	min-width: 0;
	width: 100%;
}
.table-toolbar {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
	padding: 12px 0;
}
.table-actions {
	display: flex;
	align-items: center;
	gap: 8px;
	flex-wrap: wrap;
}
.column-control-label {
	position: absolute;
	width: 1px;
	height: 1px;
	padding: 0;
	margin: -1px;
	overflow: hidden;
	clip-path: inset(50%);
	white-space: nowrap;
}
.column-option {
	display: grid;
	grid-template-columns: minmax(100px, 1fr) 112px 28px 28px;
	align-items: center;
	gap: 4px;
	min-height: 32px;
}
</style>
