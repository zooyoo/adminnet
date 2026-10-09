<script lang="ts" setup>
import { computed } from 'vue';

import { AuthPageLayout } from '@vben/layouts';
import { preferences } from '@vben/preferences';

import { siteBrand } from '#/utils/site-brand';

const appName = computed(() => preferences.app.name);
const logo = computed(() => preferences.logo.source);
const logoDark = computed(() => preferences.logo.sourceDark);
</script>

<template>
	<AuthPageLayout :app-name="appName" :logo="logo" :logo-dark="logoDark" :page-description="siteBrand.viceDesc || ''" :page-title="siteBrand.viceTitle || appName">
		<template #copyright>
			<div class="w-full min-w-0 whitespace-normal break-words px-4">
				<a v-if="siteBrand.icp" :href="siteBrand.icpUrl" target="_blank" rel="noopener noreferrer" class="mr-2">{{ siteBrand.icp }}</a>
				<span>{{ siteBrand.copyright }}</span>
			</div>
		</template>
		<!-- 自定义工具栏 -->
		<!-- <template #toolbar></template> -->
	</AuthPageLayout>
</template>
