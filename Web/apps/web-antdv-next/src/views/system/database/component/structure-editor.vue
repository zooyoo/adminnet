<script setup lang="ts">
import type { ColumnDraft } from '../database-form';

import type { DbColumnOutput, DbTableInfo } from '#/api-services/models';
import type { DatabaseTarget } from '#/api/system/database';

import { computed, h, onScopeDispose, ref, watch } from 'vue';

import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, Form, FormItem, Input, Modal, Tooltip } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { databaseActions } from '#/api/system/database';

import { columnDraft, fieldTemplates, moveDraftFields, validateColumns } from '../database-form';
import ColumnFields from './column-fields.vue';

const props = defineProps<{
	open: boolean;
	mode: 'addColumn' | 'addTable' | 'updateColumn' | 'updateTable';
	target: DatabaseTarget;
	connectionTitle: string;
	types: string[];
	column?: DbColumnOutput;
	table?: DbTableInfo;
}>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [tableName: string] }>();
const icons = Object.fromEntries(['plus', 'trash-2', 'arrow-up', 'arrow-down'].map((name) => [name, h(createIconifyIcon(`lucide:${name}`))]));
const title = computed(() => ({ addColumn: '增加字段', addTable: '增加表', updateColumn: '编辑字段', updateTable: '编辑表' })[props.mode]);
const tableName = ref('');
const description = ref('');
const fields = ref<Array<{ key: number; draft: ColumnDraft }>>([]);
const error = ref('');
const saving = ref(false);
const confirmOpen = ref(false);
let generation = 0;
let sequence = 0;
let operation: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
function cancel() {
	generation += 1;
	operation?.abort();
	saving.value = false;
	confirmOpen.value = false;
	emit('update:open', false);
}
lifetime.signal.addEventListener('abort', cancel);
function resetDraft() {
	generation += 1;
	operation?.abort();
	saving.value = false;
	confirmOpen.value = false;
	error.value = '';
	tableName.value = props.mode === 'addTable' ? '' : props.target.tableName;
	description.value = props.table?.description ?? '';
	const draft = columnDraft(props.mode === 'addTable');
	if (props.mode === 'updateColumn' && props.column) {
		Object.assign(draft, {
			dbColumnName: props.column.dbColumnName ?? '',
			dataType: props.column.dataType ?? '',
			length: props.column.length ?? 0,
			decimalDigits: props.column.decimalDigits ?? 0,
			columnDescription: props.column.columnDescription ?? '',
			defaultValue: props.column.defaultValue ?? '',
			isPrimarykey: props.column.isPrimarykey ? 1 : 0,
			isIdentity: props.column.isIdentity ? 1 : 0,
			isNullable: props.column.isNullable ? 1 : 0,
		});
	}
	fields.value = [{ key: ++sequence, draft }];
}
watch(
	[() => props.open, () => props.mode, () => props.target.tableName, () => props.column?.dbColumnName],
	([open]) => {
		if (open) resetDraft();
		else {
			generation += 1;
			operation?.abort();
			saving.value = false;
			confirmOpen.value = false;
			error.value = '';
		}
	},
	{ immediate: true }
);
function addField(primary = false) {
	fields.value.push({ key: ++sequence, draft: columnDraft(primary) });
}
function addTemplate(kind: 'base' | 'delete' | 'org' | 'tenant') {
	for (const draft of fieldTemplates(kind, props.types)) fields.value.push({ key: ++sequence, draft });
}
function move(index: number, delta: number) {
	fields.value = moveDraftFields(fields.value, index, delta);
}
function prepare() {
	if (saving.value) return;
	error.value = '';
	try {
		if (!tableName.value || !/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(tableName.value) || tableName.value.length > 63) throw new Error('表名称无效');
		if (props.mode === 'addTable' || props.mode === 'addColumn')
			validateColumns(
				fields.value.map((item) => item.draft),
				props.types
			);
		confirmOpen.value = true;
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '参数无效';
	}
}
async function save() {
	if (saving.value || !props.open || !confirmOpen.value) return;
	const current = generation;
	const session = sessionBoundary.version;
	operation = new AbortController();
	const signal = operation.signal;
	const valid = () => generation === current && sessionBoundary.version === session && !signal.aborted;
	saving.value = true;
	error.value = '';
	try {
		const target = { ...props.target };
		const name = tableName.value;
		const column = fields.value[0]!.draft;
		switch (props.mode) {
			case 'addTable':
				await databaseActions.addTable({ configId: target.configId, tableName: name, description: description.value, dbColumnInfoList: fields.value.map((item) => ({ ...item.draft })) }, signal);
				break;
			case 'updateTable':
				await databaseActions.updateTable({ ...target, tableName: name, oldTableName: target.tableName, description: description.value }, signal);
				break;
			case 'addColumn':
				await databaseActions.addColumn({ ...target, ...column }, signal);
				break;
			case 'updateColumn':
				await databaseActions.updateColumn(
					{
						...target,
						columnName: column.dbColumnName,
						oldColumnName: props.column!.dbColumnName,
						description: column.columnDescription,
						defaultValue: column.defaultValue === (props.column?.defaultValue ?? '') ? undefined : column.defaultValue,
					},
					signal
				);
				break;
		}
		if (!valid()) return;
		confirmOpen.value = false;
		emit('saved', name);
		emit('update:open', false);
	} catch (cause) {
		if (valid()) {
			confirmOpen.value = false;
			error.value = cause instanceof Error ? cause.message : '结构保存失败';
		}
	} finally {
		if (valid()) saving.value = false;
	}
}
onScopeDispose(() => {
	operation?.abort();
	lifetime.signal.removeEventListener('abort', cancel);
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<Modal
		:open="open"
		:title="title"
		:width="1020"
		:mask-closable="false"
		destroy-on-hidden
		ok-text="保存结构"
		cancel-text="取消"
		:ok-button-props="{ disabled: saving }"
		@ok="prepare"
		@cancel="cancel"
	>
		<div class="structure-editor">
			<p class="target">{{ connectionTitle }} / {{ mode === 'addTable' ? tableName || '新表' : target.tableName }}</p>
			<Alert v-if="error" type="error" :title="error" show-icon class="mb-4" />
			<Form v-if="mode === 'addTable' || mode === 'updateTable'" name="databaseStructure" layout="vertical" :colon="false">
				<FormItem label="表名称" name="tableName" required><Input v-model:value="tableName" aria-label="表名称" :disabled="saving" :maxlength="63" /></FormItem>
				<FormItem label="表描述" name="description"><Input v-model:value="description" :disabled="saving" /></FormItem>
			</Form>
			<template v-if="mode !== 'updateTable'">
				<fieldset v-for="(field, index) in fields" :key="field.key">
					<legend>字段 {{ index + 1 }}</legend>
					<ColumnFields v-model="field.draft" :types="types" :prefix="`字段 ${index + 1} `" :existing="mode === 'updateColumn'" :disabled="saving" />
					<div v-if="mode === 'addTable'" class="field-actions">
						<Tooltip title="上移字段"><Button :icon="icons['arrow-up']" :aria-label="`上移字段 ${index + 1}`" :disabled="saving || fields.length < 2" @click="move(index, -1)" /></Tooltip>
						<Tooltip title="下移字段"><Button :icon="icons['arrow-down']" :aria-label="`下移字段 ${index + 1}`" :disabled="saving || fields.length < 2" @click="move(index, 1)" /></Tooltip>
						<Tooltip title="移除字段"><Button :icon="icons['trash-2']" :aria-label="`移除字段 ${index + 1}`" :disabled="saving" danger @click="fields.splice(index, 1)" /></Tooltip>
					</div>
				</fieldset>
				<div v-if="mode === 'addTable'" class="field-actions">
					<Button :icon="icons.plus" :disabled="saving" @click="addField(true)">新增主键字段</Button>
					<Button :icon="icons.plus" :disabled="saving" @click="addField()">新增普通字段</Button>
					<Button :icon="icons.plus" :disabled="saving" @click="addTemplate('tenant')">新增租户字段</Button>
					<Button :icon="icons.plus" :disabled="saving" @click="addTemplate('org')">新增机构字段</Button>
					<Button :icon="icons.plus" :disabled="saving" @click="addTemplate('base')">新增基础字段</Button>
					<Button :icon="icons.plus" :disabled="saving" @click="addTemplate('delete')">新增软删除字段</Button>
				</div>
			</template>
		</div>
	</Modal>
	<Modal :open="confirmOpen" title="确认保存结构" ok-text="确认执行" cancel-text="返回编辑" :mask-closable="false" :ok-button-props="{ loading: saving }" @ok="save" @cancel="confirmOpen = false">
		<p>{{ connectionTitle }} / {{ target.tableName || tableName }}</p>
		<p>{{ title }}：{{ mode.includes('Column') ? fields[0]?.draft.dbColumnName : tableName }}</p>
	</Modal>
</template>

<style scoped>
.structure-editor {
	max-height: 65vh;
	overflow: auto;
	padding: 0 8px;
}
.target {
	margin-bottom: 16px;
	overflow-wrap: anywhere;
	font-weight: 600;
}
fieldset {
	padding: 12px 0;
	border-top: 1px solid hsl(var(--border));
}
legend {
	font-size: 14px;
}
.field-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 12px;
}
</style>
