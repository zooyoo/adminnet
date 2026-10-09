<script setup lang="ts">
import type { DatabaseSelection } from '../use-database-selection';

import { computed } from 'vue';

import { Form, FormItem, Select } from 'antdv-next';

const props = defineProps<{ selection: DatabaseSelection; disabled?: boolean }>();
const connectionOptions = computed(() => props.selection.connections.value.map((item) => ({ value: item.configId, label: `${item.dbNickName || item.configId} (${item.dbType})` })));
const tableOptions = computed(() => props.selection.tables.value.map((item) => ({ value: item.name!, label: `${item.name}${item.description ? ` · ${item.description}` : ''}` })));
</script>

<template>
	<Form name="databaseSelection" layout="inline" :colon="false" class="database-selector">
		<FormItem label="数据库" name="configId">
			<Select
				:value="selection.configId.value || undefined"
				:options="connectionOptions"
				:disabled="disabled"
				show-search
				option-filter-prop="label"
				placeholder="选择数据库"
				@change="(value) => selection.selectConnection(String(value))"
			/>
		</FormItem>
		<FormItem label="数据表" name="tableName">
			<Select
				:value="selection.tableName.value || undefined"
				:options="tableOptions"
				:disabled="disabled || !selection.ready.value"
				:loading="selection.loading.value"
				allow-clear
				show-search
				option-filter-prop="label"
				placeholder="选择数据表"
				@change="(value) => selection.selectTable(value ? String(value) : '')"
			/>
		</FormItem>
	</Form>
</template>

<style scoped>
.database-selector {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.database-selector :deep(.ant-select) {
	width: 300px;
}
</style>
