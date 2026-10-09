<script setup lang="ts">
import { ref, watch } from 'vue';
import { onBeforeRouteLeave, useRoute, useRouter } from 'vue-router';

import { Alert, Button, Spin } from 'antdv-next';

import { takeLegacyToken } from '#/router/legacy-token';
import { safeRedirect } from '#/router/redirect';
import { useAuthStore } from '#/store';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const loading = ref(true);
const error = ref('');
let pending = Promise.resolve();
let activeController: AbortController | undefined;
onBeforeRouteLeave(() => activeController?.abort());
watch(
	() => route.fullPath,
	(_path, _previous, onCleanup) => {
		if (route.path !== '/auth/token') return;
		const controller = new AbortController();
		activeController = controller;
		onCleanup(() => controller.abort());
		const token = takeLegacyToken();
		const redirect = safeRedirect(route.query.redirect);
		loading.value = true;
		error.value = '';
		// 等待被取消的上一轮释放登录状态，再处理同一页面的新令牌。
		pending = pending.then(async () => {
			if (controller.signal.aborted) return;
			try {
				if (!token) throw new Error('登录令牌缺失，请重新登录');
				await auth.authTokenLogin(token, redirect, controller.signal);
			} catch (cause) {
				if (!controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '第三方登录失败，请重新登录';
			} finally {
				if (!controller.signal.aborted) loading.value = false;
			}
		});
	},
	{ immediate: true }
);
</script>

<template>
	<section class="mx-auto w-full max-w-md">
		<h1 class="mb-6 text-2xl font-semibold">第三方登录</h1>
		<Spin v-if="loading" description="正在验证登录身份" class="my-8 block" />
		<Alert v-if="error" :title="error" type="error" show-icon />
		<Button class="mt-6" @click="router.replace('/auth/login')">返回账号登录</Button>
	</section>
</template>
