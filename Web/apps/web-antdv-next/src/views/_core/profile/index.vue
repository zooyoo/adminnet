<script setup lang="ts">
import { onScopeDispose, ref, watch } from 'vue';

import { Alert, Button, Spin, Tabs, Tree } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { profileOrganizations } from '#/api/system/profile';

import ProfileBase from './base-setting.vue';
import ProfilePassword from './password-setting.vue';

const tab = ref('basic');
const tabs = [{ key: 'basic', label: '基础信息' }, { key: 'org', label: '组织机构' }, { key: 'password', label: '修改密码' }];
const organizations = ref<Awaited<ReturnType<typeof profileOrganizations>>>([]);
const loading = ref(false);
const error = ref('');
const controller = new AbortController();
onScopeDispose(() => controller.abort());
async function loadOrganizations() {
	const version = sessionBoundary.version;
	loading.value = true;
	error.value = '';
	try {
		const result = await profileOrganizations(controller.signal);
		if (!controller.signal.aborted && version === sessionBoundary.version) organizations.value = result;
	} catch (cause) {
		if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '组织机构加载失败';
	} finally {
		loading.value = false;
	}
}
watch(tab, (value) => { if (value === 'org') void loadOrganizations(); });
</script>

<template>
	<section class="m-4 rounded-lg bg-background p-6">
		<h1 class="mb-4 text-xl font-semibold">个人中心</h1>
		<Tabs v-model:active-key="tab" :items="tabs" />
		<ProfileBase v-if="tab === 'basic'" />
		<ProfilePassword v-else-if="tab === 'password'" />
		<Spin v-else :spinning="loading">
			<Alert v-if="error" :title="error" type="error" show-icon><template #action><Button @click="loadOrganizations">重新加载</Button></template></Alert>
			<Tree v-else :tree-data="organizations" :field-names="{ title: 'name', key: 'id', children: 'children' }" default-expand-all />
		</Spin>
	</section>
</template>
