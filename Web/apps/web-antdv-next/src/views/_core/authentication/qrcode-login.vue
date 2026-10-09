<script setup lang="ts">
import { useRouter } from 'vue-router';

import { Alert, Button } from 'antdv-next';

const router = useRouter();
</script>

<template>
	<section class="mx-auto w-full max-w-md">
		<h1 class="mb-6 text-2xl font-semibold">扫码登录</h1>
		<Alert title="当前站点未开通扫码登录，请使用账号或手机验证码登录。" type="info" show-icon />
		<Button class="mt-6" @click="router.replace('/auth/login')">返回账号登录</Button>
	</section>
</template>
