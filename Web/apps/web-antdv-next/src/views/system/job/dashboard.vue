<script setup lang="ts">
import { computed } from 'vue';

import { useAccess } from '@vben/access';
import { useAppConfig } from '@vben/hooks';

import { Alert, Button } from 'antdv-next';

const { apiURL } = useAppConfig(import.meta.env, import.meta.env.PROD);
const { hasAccessByCodes } = useAccess();
const allowed = computed(() => hasAccessByCodes(['sysJob:pageJobDetail']));
const dashboardUrl = /^https?:\/\//i.test(apiURL) ? `${apiURL.replace(/\/$/, '')}/schedule/` : '/schedule/';
</script>

<template>
	<div class="dashboard-page p-4">
		<template v-if="allowed">
			<Button class="mb-3" :href="dashboardUrl" target="_blank" rel="noopener noreferrer">在新窗口打开调度看板</Button>
			<iframe :src="dashboardUrl" title="独立调度看板" class="schedule-frame" />
		</template>
		<Alert v-else type="warning" title="没有任务查询权限" />
	</div>
</template>

<style scoped>
.schedule-frame {
	width: 100%;
	height: calc(100vh - 240px);
	min-height: 460px;
	border: 1px solid hsl(var(--border));
	border-radius: 6px;
}
</style>
