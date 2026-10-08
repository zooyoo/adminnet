<script setup lang="ts">
import type { AuthApi } from '#/api/core/auth';

import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { SliderCaptcha } from '@vben/common-ui';

import { Alert, Button, Form, FormItem, Input, InputPassword, Select, Spin } from 'antdv-next';

import { getCaptchaApi, getSystemInfoApi, getTenantOptionsApi, isEnabled } from '#/api';
import { useAuthStore } from '#/store';

defineOptions({ name: 'Login' });
const store = useAuthStore();
const router = useRouter();
const route = useRoute();
const info = ref<AuthApi.SystemInfo>();
const tenants = ref<AuthApi.TenantOption[]>([]);
const captcha = ref<AuthApi.Captcha>();
const verified = ref(false);
const loading = ref(true);
const errorMessage = ref('');
const form = reactive<AuthApi.LoginParams>({ account: '', password: '', code: '', tenantId: undefined });
const requireCaptcha = computed(() => isEnabled(info.value?.captcha));

async function refreshCaptcha() {
	if (!requireCaptcha.value) return;
	captcha.value = await getCaptchaApi();
	form.code = '';
	form.codeId = captcha.value.id;
}

async function initialize() {
	loading.value = true;
	errorMessage.value = '';
	try {
		info.value = await getSystemInfoApi();
		if (!info.value.hideTenantForLogin) {
			tenants.value = await getTenantOptionsApi();
			const host = window.location.hostname.toLowerCase();
			const matchingTenant = tenants.value.find((item) => item.host === host);
			form.tenantId = matchingTenant?.value ?? tenants.value[0]?.value;
		}
		await refreshCaptcha();
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '无法加载登录配置';
	} finally {
		loading.value = false;
	}
}

async function submit() {
	errorMessage.value = '';
	if (isEnabled(info.value?.secondVer) && !verified.value) {
		errorMessage.value = '请先完成验证';
		return;
	}
	try {
		await store.authLogin({ ...form });
	} catch (error) {
		errorMessage.value = error instanceof Error ? error.message : '登录失败';
		verified.value = false;
		await refreshCaptcha().catch(() => undefined);
	}
}

onMounted(initialize);
</script>

<template>
	<section class="login-form">
		<h1>登录 {{ info?.title || 'Admin.NET' }}</h1>
		<Alert v-if="errorMessage" :message="errorMessage" type="error" show-icon class="mb-4" />
		<Spin :spinning="loading">
			<Form :model="form" layout="vertical" @finish="submit">
				<FormItem v-if="info && !info.hideTenantForLogin" name="tenantId" label="租户" :rules="[{ required: true, message: '请选择租户' }]">
					<Select v-model:value="form.tenantId" :options="tenants" show-search option-filter-prop="label" />
				</FormItem>
				<FormItem name="account" label="账号" :rules="[{ required: true, message: '请输入账号' }]">
					<Input v-model:value="form.account" autocomplete="username" size="large" />
				</FormItem>
				<FormItem name="password" label="密码" :rules="[{ required: true, message: '请输入密码' }]">
					<InputPassword v-model:value="form.password" autocomplete="current-password" size="large" />
				</FormItem>
				<FormItem v-if="requireCaptcha" name="code" label="验证码" html-for="login-code" :rules="[{ required: true, message: '请输入验证码' }]">
					<div class="captcha-row">
						<Input id="login-code" v-model:value="form.code" autocomplete="off" size="large" />
						<button type="button" class="captcha-image" aria-label="刷新验证码" @click="refreshCaptcha">
							<img v-if="captcha" :src="`data:image/png;base64,${captcha.img}`" alt="验证码" width="130" height="38" />
						</button>
					</div>
				</FormItem>
				<SliderCaptcha v-if="isEnabled(info?.secondVer)" v-model="verified" class="mb-6" />
				<Button type="primary" html-type="submit" size="large" block :loading="store.loginLoading" :disabled="loading || !info">登录</Button>
			</Form>
		</Spin>
		<div class="mt-4 flex justify-between">
			<Button type="link" @click="router.push({ path: '/auth/code-login', query: route.query })">手机登录</Button>
			<Button v-if="isEnabled(info?.enableReg)" type="link" @click="router.push({ path: '/auth/register', query: route.query })">注册账号</Button>
			<Button v-if="!info && !loading" type="link" @click="initialize">重新加载</Button>
		</div>
	</section>
</template>

<style scoped>
.login-form {
	width: 100%;
	max-width: 420px;
	margin: auto;
}
h1 {
	margin-bottom: 24px;
	font-size: 24px;
	font-weight: 600;
	letter-spacing: 0;
}
.captcha-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) 130px;
	gap: 12px;
}
.captcha-image {
	height: 40px;
	padding: 0;
	overflow: hidden;
	border: 1px solid var(--ant-color-border);
	border-radius: 4px;
}
</style>
