<script setup lang="ts" generic="T extends Record<string, unknown>, Q extends Record<string, unknown>">
import type { TableProps } from 'antdv-next';

import type { TableOutputOptions } from './table-output';
import type { AdminTableController } from './use-admin-table';

import { computed, onActivated, onBeforeUnmount, onDeactivated, ref } from 'vue';

import { ArrowDown, ArrowUp, createIconifyIcon, RotateCw, Settings } from '@vben/icons';

import { Alert, Button, Checkbox, Dropdown, message, Popover, Table, Tooltip } from 'antdv-next';
import { isCancel } from 'axios';

import { sessionBoundary } from '#/api/session';

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
	}>(),
	{ pagination: true, selection: false, rowKey: 'id', output: undefined, disabledSelection: undefined }
);

const hiddenKeys = ref<string[]>([]);
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
const columnKey = (column: (typeof props.columns)[number], index: number) => String(column.key ?? ('dataIndex' in column ? column.dataIndex : undefined) ?? index);
const columnOptions = computed(() =>
	props.columns
		.map((column, index) => ({
			column,
			key: columnKey(column, index),
			label: typeof column.title === 'string' ? column.title : columnKey(column, index),
		}))
		.sort((a, b) => {
			const rank = (key: string) => (orderedKeys.value.includes(key) ? orderedKeys.value.indexOf(key) : props.columns.length);
			return rank(a.key) - rank(b.key);
		})
);
const visibleColumns = computed(() => columnOptions.value.filter((item) => !hiddenKeys.value.includes(item.key)).map((item) => item.column));
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

function moveColumn(index: number, direction: number) {
	const keys = columnOptions.value.map((item) => item.key);
	const key = keys[index];
	const other = keys[index + direction];
	if (key !== undefined && other !== undefined) {
		keys[index] = other;
		keys[index + direction] = key;
		orderedKeys.value = keys;
	}
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
					><Button aria-label="刷新" :loading="controller.loading.value" @click="controller.reload"><RotateCw :size="16" /></Button
				></Tooltip>
				<Popover trigger="click" placement="bottomRight">
					<Tooltip title="列设置"
						><Button aria-label="列设置"><Settings :size="16" /></Button
					></Tooltip>
					<template #content>
						<div v-for="(item, index) in columnOptions" :key="item.key" class="column-option">
							<Checkbox :checked="!hiddenKeys.includes(item.key)" @change="toggleColumn(item.key)">{{ item.label }}</Checkbox>
							<Button type="text" size="small" :disabled="index === 0" :aria-label="`上移${item.label}`" @click="moveColumn(index, -1)"><ArrowUp :size="14" /></Button>
							<Button type="text" size="small" :disabled="index === columnOptions.length - 1" :aria-label="`下移${item.label}`" @click="moveColumn(index, 1)"><ArrowDown :size="14" /></Button>
						</div>
					</template>
				</Popover>
			</div>
		</div>
		<Alert v-if="controller.error.value" :message="controller.error.value" type="error" show-icon class="mb-3" />
		<Table
			v-bind="$attrs"
			:columns="visibleColumns"
			:data-source="controller.rows.value"
			:loading="controller.loading.value"
			:pagination="pager"
			:row-selection="rowSelection"
			:row-key="rowKey"
			:scroll="{ x: 'max-content' }"
			size="small"
			@change="change"
		>
			<template v-if="$slots.bodyCell" #bodyCell="context"
				><slot name="bodyCell" v-bind="context">{{ cellText(context.text) }}</slot></template
			>
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
.column-option {
	display: grid;
	grid-template-columns: minmax(120px, 1fr) 28px 28px;
	align-items: center;
	gap: 4px;
	min-height: 32px;
}
</style>
