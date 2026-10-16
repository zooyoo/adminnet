<script setup lang="ts">
import type { AdminUserInfo } from '#/api/core/user';

import { computed } from 'vue';

import { useAccessStore, useUserStore } from '@vben/stores';

import { sessionBoundary } from '#/api/session';

import HomeWorkbenchContent from './workbench-content.vue';

defineOptions({ name: 'HomeWorkbench' });
const accessStore = useAccessStore();
const userStore = useUserStore();
// 公开 store 响应式更新驱动代次重读；候选身份验证失败前保留原内容。
const identityKey = computed(() => {
	const signedIn = !!accessStore.accessToken;
	const info = userStore.userInfo as AdminUserInfo | null;
	const userId = info?.userId;
	const tenantId = info?.currentTenantId ?? info?.tenantId;
	if (!signedIn || userId === undefined || userId === null || tenantId === undefined || tenantId === null) return null;
	return String(sessionBoundary.version) + ':' + String(userId) + ':' + String(tenantId);
});
</script>

<template>
	<HomeWorkbenchContent v-if="identityKey" :key="identityKey" :data-workbench-identity="identityKey" />
</template>
