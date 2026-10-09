<script setup lang="ts">
import type { ProfileRecord } from '#/api/system/profile';

import { onMounted, onScopeDispose, ref } from 'vue';

import { useAccess } from '@vben/access';

import { Alert, Button, Form, FormItem, Input, Modal, RadioGroup, Select, Spin, TextArea } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { getProfile, profileLanguages, saveProfile } from '#/api/system/profile';
import { useAuthStore } from '#/store';

import ProfileImages from './profile-images.vue';

const auth = useAuthStore();
const { hasAccessByCodes } = useAccess();
const profile = ref<ProfileRecord>();
const languages = ref<Array<{ label: string; value: string }>>([]);
const loading = ref(true);
const saving = ref(false);
const imageBusy = ref(false);
const error = ref('');
const confirmOpen = ref(false);
const controller = new AbortController();
let generation = 0;
onScopeDispose(() => { generation++; controller.abort(); });

async function load() {
	const current = ++generation;
	const version = sessionBoundary.version;
	loading.value = true;
	error.value = '';
	try {
		const [value, options] = await Promise.all([getProfile(controller.signal), profileLanguages(controller.signal)]);
		if (current !== generation || version !== sessionBoundary.version) return;
		profile.value = { ...value, birthday: value.birthday?.slice(0, 10) ?? null };
		languages.value = options.map((item) => ({ label: item.label, value: item.code }));
	} catch (cause) {
		if (current === generation && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '个人资料加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}

async function save() {
	if (!profile.value || saving.value || imageBusy.value || loading.value || !hasAccessByCodes(['sysUser:baseInfo'])) return;
	const current = generation;
	const version = sessionBoundary.version;
	saving.value = true;
	error.value = '';
	try {
		if (!(await saveProfile(profile.value, controller.signal))) throw new Error('个人资料未保存，请重试');
		if (current !== generation || version !== sessionBoundary.version) return;
		await auth.fetchUserInfo();
		if (current !== generation || version !== sessionBoundary.version) return;
		confirmOpen.value = false;
		await load();
	} catch (cause) {
		if (current === generation && !controller.signal.aborted) error.value = cause instanceof Error ? cause.message : '个人资料保存失败';
	} finally {
		saving.value = false;
	}
}
onMounted(load);
</script>

<template>
	<Spin :spinning="loading">
		<Alert v-if="error" class="mb-4" :title="error" type="error" show-icon />
		<Button v-if="!profile && !loading" @click="load">重新加载</Button>
		<template v-if="profile">
			<ProfileImages :profile :disabled="saving || loading" @busy="imageBusy = $event" @updated="(kind, value) => { if (profile) profile[kind] = value; }" />
			<Form :model="profile" layout="vertical" class="mt-6 max-w-4xl" @finish="confirmOpen = true">
				<div class="grid grid-cols-2 gap-x-6">
					<FormItem label="账号" name="account"><Input :value="profile.account" disabled /></FormItem>
					<FormItem label="真实姓名" name="realName" :rules="[{ required: true, whitespace: true, message: '真实姓名不能为空' }]">
						<Input v-model:value="profile.realName" :maxlength="32" :disabled="saving" />
					</FormItem>
					<FormItem label="昵称" name="nickName"><Input v-model:value="profile.nickName" :maxlength="32" :disabled="saving" /></FormItem>
					<FormItem label="手机号码" name="phone" :rules="[{ required: true, message: '手机号码不能为空' }]">
						<Input v-model:value="profile.phone" :maxlength="16" :disabled="saving" />
					</FormItem>
					<FormItem label="邮箱" name="email" :rules="[{ type: 'email', message: '请输入有效邮箱' }]">
						<Input v-model:value="profile.email" :disabled="saving" />
					</FormItem>
					<FormItem label="出生日期" name="birthday" :rules="[{ required: true, message: '出生日期不能为空' }]">
						<Input v-model:value="profile.birthday" type="date" :disabled="saving" />
					</FormItem>
					<FormItem label="性别" name="sex"><RadioGroup v-model:value="profile.sex" :options="[{ label: '男', value: 1 }, { label: '女', value: 2 }]" :disabled="saving" /></FormItem>
					<FormItem label="语言" name="langCode" :rules="[{ required: true, message: '请选择语言' }]">
						<Select v-model:value="profile.langCode" :options="languages" :disabled="saving" />
					</FormItem>
					<FormItem label="个性化首页" name="homepage" class="col-span-2"><Input v-model:value="profile.homepage" :disabled="saving" /></FormItem>
					<FormItem label="地址" name="address" class="col-span-2"><TextArea v-model:value="profile.address" :rows="2" :disabled="saving" /></FormItem>
					<FormItem label="备注" name="remark" class="col-span-2"><TextArea v-model:value="profile.remark" :rows="2" :disabled="saving" /></FormItem>
				</div>
				<Button v-if="hasAccessByCodes(['sysUser:baseInfo'])" type="primary" html-type="submit" :disabled="loading || saving || imageBusy">保存基本信息</Button>
			</Form>
		</template>
	</Spin>
	<Modal v-model:open="confirmOpen" title="确定修改个人基础信息？" :confirm-loading="saving" :closable="!saving" :mask-closable="!saving" :keyboard="!saving" :cancel-button-props="{ disabled: saving }" @ok="save">
		<Alert v-if="error" :title="error" type="error" show-icon />
		<p v-else>保存后将更新当前账号的个人资料。</p>
	</Modal>
</template>
