<script setup lang="ts">
import { onBeforeUnmount, ref } from 'vue';

import { createIconifyIcon } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Form, FormItem, Modal, Select, Tooltip } from 'antdv-next';

import { getTenantOptionsApi } from '#/api/core/auth';
import { sessionBoundary } from '#/api/session';
import { useAuthStore } from '#/store';

const Icon = createIconifyIcon('lucide:building-2');
const auth = useAuthStore();
const user = useUserStore();
const open = ref(false);
const loading = ref(false);
const error = ref('');
const selected = ref<number>();
const options = ref<Array<{ value: number; label: string }>>([]);
let generation = 0;
let pending: AbortController | undefined;
function cancel() {
	generation++;
	pending?.abort();
	open.value = false;
}
onBeforeUnmount(cancel);
async function show() {
	const current = ++generation;
	const version = sessionBoundary.version;
	open.value = true;
	loading.value = true;
	error.value = '';
	selected.value = Number(user.userInfo?.currentTenantId) || undefined;
	try {
		const loaded = await getTenantOptionsApi();
		if (current !== generation || version !== sessionBoundary.version || !open.value) return;
		options.value = loaded.map((item) => ({ value: Number(item.value), label: item.label }));
	} catch (cause) {
		if (current === generation && version === sessionBoundary.version) error.value = cause instanceof Error ? cause.message : '租户加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
async function change() {
	if (!selected.value || loading.value || auth.loginLoading || error.value) return;
	const current = generation;
	const controller = new AbortController();
	pending = controller;
	try {
		await auth.changeTenant(selected.value, false, controller.signal);
		if (current === generation) open.value = false;
	} catch {
		/* 请求层提示错误，原会话保留。 */
	} finally {
		if (pending === controller) pending = undefined;
	}
}
</script>

<template>
	<Tooltip title="切换租户"
		><Button type="text" aria-label="切换租户" @click="show"><Icon :size="18" /></Button
	></Tooltip>
	<Modal
		v-model:open="open"
		title="切换租户"
		:width="420"
		:mask-closable="false"
		:ok-button-props="{ loading: auth.loginLoading, disabled: loading || !selected || !!error }"
		@ok="change"
		@cancel="cancel"
	>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Form layout="vertical"
			><FormItem label="租户" html-for="switch-tenant"
				><Select id="switch-tenant" v-model:value="selected" :options="options" :loading="loading" show-search option-filter-prop="label" :virtual="false" /></FormItem
		></Form>
	</Modal>
</template>
