<script setup lang="ts">
import type { ColumnDraft } from '../database-form';

import { watch } from 'vue';

import { Checkbox, Input, InputNumber, Select } from 'antdv-next';

import { updateColumnType } from '../database-form';

defineProps<{ types: string[]; prefix: string; existing?: boolean; disabled?: boolean }>();
const draft = defineModel<ColumnDraft>({ required: true });
watch(
	() => draft.value.dataType,
	() => updateColumnType(draft.value),
	{ flush: 'sync' }
);
</script>

<template>
	<div class="column-fields">
		<label>字段名<Input v-model:value="draft.dbColumnName" :aria-label="`${prefix}字段名`" :disabled="disabled" :maxlength="63" /></label>
		<label
			>类型<Select
				v-model:value="draft.dataType"
				:aria-label="`${prefix}类型`"
				:options="types.map((value) => ({ label: value, value }))"
				show-search
				option-filter-prop="label"
				:disabled="disabled || existing"
		/></label>
		<label>长度<InputNumber v-model:value="draft.length" :aria-label="`${prefix}长度`" :min="0" :precision="0" :disabled="disabled || existing" /></label>
		<label>小数位<InputNumber v-model:value="draft.decimalDigits" :aria-label="`${prefix}小数位`" :min="0" :precision="0" :disabled="disabled || existing" /></label>
		<label class="description">描述<Input v-model:value="draft.columnDescription" :aria-label="`${prefix}描述`" :disabled="disabled" /></label>
		<label>默认值<Input v-model:value="draft.defaultValue" :aria-label="`${prefix}默认值`" :disabled="disabled" /></label>
		<div class="flags">
			<Checkbox :checked="draft.isPrimarykey === 1" :disabled="disabled || existing" @change="(event) => (draft.isPrimarykey = event.target.checked ? 1 : 0)">主键</Checkbox>
			<Checkbox :checked="draft.isIdentity === 1" :disabled="disabled || existing" @change="(event) => (draft.isIdentity = event.target.checked ? 1 : 0)">自增</Checkbox>
			<Checkbox :checked="draft.isNullable === 1" :disabled="disabled || existing" @change="(event) => (draft.isNullable = event.target.checked ? 1 : 0)">可空</Checkbox>
		</div>
	</div>
</template>

<style scoped>
.column-fields {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12px 16px;
}
label {
	display: flex;
	flex-direction: column;
	gap: 4px;
	font-size: 14px;
}
.column-fields :deep(.ant-input-number),
.column-fields :deep(.ant-select) {
	width: 100%;
}
.description {
	grid-column: span 2;
}
.flags {
	display: flex;
	flex-wrap: wrap;
	align-items: end;
	gap: 8px;
}
@media (max-width: 900px) {
	.column-fields {
		grid-template-columns: repeat(2, minmax(0, 1fr));
	}
}
</style>
