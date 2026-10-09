<script setup lang="ts">
import { onScopeDispose, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Button, InputPassword, Modal } from 'antdv-next';

import { useAuthStore } from '#/store';

const auth = useAuthStore();
const user = useUserStore();
const password = ref('');
const error = ref('');
const loading = ref(false);
const leaving = ref(false);
const controller = new AbortController();
onScopeDispose(() => controller.abort());

async function unlock() {
	if (loading.value || leaving.value) return;
	error.value = '';
	if (!password.value) {
		error.value = '请输入账号密码';
		return;
	}
	loading.value = true;
	try {
		await auth.unlockScreen(password.value, controller.signal);
	} catch (cause) {
		if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '解锁失败，请重试';
	} finally {
		password.value = '';
		loading.value = false;
	}
}

async function logout() {
	if (leaving.value) return;
	leaving.value = true;
	controller.abort();
	password.value = '';
	await auth.logout(false);
}
</script>

<template>
	<Modal
		:open="true"
		title="屏幕已锁定"
		:closable="false"
		:mask-closable="false"
		:keyboard="false"
		:footer="null"
		:width="420"
		:z-index="10000"
		:focusable="{ trap: true, focusTriggerAfterClose: false }"
		:styles="{ mask: { background: 'var(--ant-color-bg-layout, #141414)' } }"
		centered
	>
		<p class="mb-4">使用 {{ user.userInfo?.account }} 的账号密码解锁，继续当前工作。</p>
		<Alert v-if="error" class="mb-4" :title="error" type="error" show-icon />
		<form @submit.prevent="unlock">
			<label for="unlock-password" class="mb-2 block">账号密码</label>
			<InputPassword id="unlock-password" v-model:value="password" autocomplete="current-password" :disabled="loading || leaving" autofocus />
			<Button class="mt-4" type="primary" html-type="submit" block :loading="loading" :disabled="leaving">解锁</Button>
		</form>
		<Button class="mt-3" block :loading="leaving" @click="logout">退出登录</Button>
	</Modal>
</template>
