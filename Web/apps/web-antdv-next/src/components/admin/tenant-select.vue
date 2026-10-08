<script setup lang="ts">
import { onMounted, ref } from 'vue';

import { Select } from 'antdv-next';

import { getTenantOptionsApi } from '#/api/core/auth';

const value = defineModel<number>();
const options = ref<Array<{ label: string; value: number }>>([]);
const loading = ref(false);
onMounted(async () => {
	loading.value = true;
	try {
		options.value = (await getTenantOptionsApi()).map((item) => ({ label: item.label, value: Number(item.value) }));
	} finally {
		loading.value = false;
	}
});
</script>

<template>
	<Select v-model:value="value" :options="options" :loading="loading" show-search option-filter-prop="label" style="min-width: 180px" />
</template>
