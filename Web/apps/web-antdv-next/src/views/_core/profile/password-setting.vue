<script setup lang="ts">
import { onScopeDispose, reactive, ref } from 'vue';

import { useAccess } from '@vben/access';

import { Alert, Button, Form, FormItem, InputPassword } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { changeOwnPassword } from '#/api/system/profile';
import { useAuthStore } from '#/store';

const { hasAccessByCodes } = useAccess();
const auth = useAuthStore();
const form = reactive({ passwordOld: '', passwordNew: '', confirm: '' });
const saving = ref(false);
const error = ref('');
const controller = new AbortController();
onScopeDispose(() => controller.abort());

async function save() {
	if (saving.value || !hasAccessByCodes(['sysUser:changePwd'])) return;
	error.value = '';
	if (form.passwordNew !== form.confirm) {
		error.value = '两次输入的密码不一致';
		return;
	}
	const version = sessionBoundary.version;
	saving.value = true;
	try {
		const changed = await changeOwnPassword(form.passwordOld, form.passwordNew, controller.signal);
		if (controller.signal.aborted || version !== sessionBoundary.version) return;
		if (!changed) throw new Error('密码未修改，请重试');
		form.passwordOld = form.passwordNew = form.confirm = '';
		await auth.logout(false);
	} catch (cause) {
		if (!controller.signal.aborted && version === sessionBoundary.version) error.value = cause instanceof Error ? cause.message : '密码修改失败';
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<div class="max-w-lg">
		<Alert class="mb-4" title="修改成功后将退出登录，请使用新密码重新登录。" type="info" show-icon />
		<Alert v-if="error" class="mb-4" :title="error" type="error" show-icon />
		<Form :model="form" layout="vertical" @finish="save">
			<FormItem label="当前密码" name="passwordOld" :rules="[{ required: true, message: '请输入当前密码' }]">
				<InputPassword v-model:value="form.passwordOld" autocomplete="current-password" :disabled="saving" />
			</FormItem>
			<FormItem label="新密码" name="passwordNew" :rules="[{ required: true, message: '请输入新密码' }]">
				<InputPassword v-model:value="form.passwordNew" autocomplete="new-password" :disabled="saving" />
			</FormItem>
			<FormItem label="确认密码" name="confirm" :rules="[{ required: true, message: '请再次输入新密码' }]">
				<InputPassword v-model:value="form.confirm" autocomplete="new-password" :disabled="saving" />
			</FormItem>
			<Button v-if="hasAccessByCodes(['sysUser:changePwd'])" type="primary" html-type="submit" :loading="saving">修改密码</Button>
		</Form>
	</div>
</template>
