<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { TenantRecord, UpdateTenantInput } from '#/api/system/tenant';

import { onBeforeUnmount, ref, watch } from 'vue';

import { Alert, Button, Form, FormItem, Image, Input, InputNumber, InputPassword, message, Modal, RadioGroup, Select, TabPane, Tabs, TextArea, Upload } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { databaseTypes, saveTenant, tenantRegistrationOptions } from '#/api/system/tenant';

import { createTenantDraft, createTenantSaveInput, logoAsDataUrl } from '../tenant-form';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const saving = ref(false);
const readingLogo = ref(false);
const error = ref('');
const activeTab = ref('base');
const value = ref<UpdateTenantInput>(createTenantDraft());
const form = ref<FormInstance>();
const logo = ref<File>();
const copying = ref(false);
const registrationOptions = ref<Array<{ label: string; value: number }>>([]);
const loadingRegistrations = ref(false);
const registrationsLoaded = ref(false);
const registrationError = ref('');
let generation = 0;
let editorSession = sessionBoundary.version;
let editorBoundary: AbortController | undefined;
let disposed = false;

function isCurrent(current: number, version: number) {
	return !disposed && open.value && current === generation && version === sessionBoundary.version && !!editorBoundary && !editorBoundary.signal.aborted;
}

function invalidateEditor() {
	generation += 1;
	const boundary = editorBoundary;
	editorBoundary = undefined;
	if (boundary) {
		boundary.signal.removeEventListener('abort', invalidateEditor);
		sessionBoundary.release(boundary);
		boundary.abort();
	}
	open.value = false;
	saving.value = false;
	readingLogo.value = false;
	loadingRegistrations.value = false;
	registrationsLoaded.value = false;
	registrationOptions.value = [];
	registrationError.value = '';
	error.value = '';
	logo.value = undefined;
	value.value = createTenantDraft();
}

async function validateLogo() {
	if (!value.value.logo && !value.value.logoBase64) throw new Error('请选择应用 Logo');
}

async function validateRegistration() {
	if (value.value.enableReg !== 1) return;
	if (loadingRegistrations.value) throw new Error('注册方案正在加载，请稍后保存');
	if (!registrationsLoaded.value) throw new Error('请重新加载注册方案后保存');
	if (!registrationOptions.value.some((option) => option.value === value.value.regWayId)) throw new Error('请选择可用的注册方案');
}

async function loadRegistrations() {
	if (saving.value || loadingRegistrations.value || !isCurrent(generation, editorSession)) return;
	const current = generation;
	const version = editorSession;
	const signal = editorBoundary!.signal;
	loadingRegistrations.value = true;
	registrationsLoaded.value = false;
	registrationError.value = '';
	try {
		const options = await tenantRegistrationOptions(value.value.id, signal);
		if (!isCurrent(current, version)) return;
		registrationOptions.value = options;
		registrationsLoaded.value = true;
	} catch (cause) {
		if (isCurrent(current, version)) registrationError.value = cause instanceof Error ? cause.message : '注册方案加载失败';
	} finally {
		if (isCurrent(current, version)) loadingRegistrations.value = false;
	}
}

function show(record?: TenantRecord, copy = false) {
	if (saving.value || disposed) return;
	invalidateEditor();
	editorSession = sessionBoundary.version;
	editorBoundary = new AbortController();
	editorBoundary.signal.addEventListener('abort', invalidateEditor);
	sessionBoundary.track(editorBoundary);
	copying.value = copy;
	value.value = createTenantDraft(record, copy);
	activeTab.value = 'base';
	open.value = true;
	form.value?.clearValidate();
	void loadRegistrations();
}

async function chooseLogo(file: File) {
	if (saving.value || readingLogo.value || !isCurrent(generation, editorSession)) return false;
	if (!file.type.startsWith('image/')) {
		message.warning('请选择图片文件');
		return false;
	}
	if (file.size > 5 * 1024 * 1024) {
		message.warning('Logo 不能超过 5 MB');
		return false;
	}
	const current = generation;
	const version = editorSession;
	readingLogo.value = true;
	try {
		const data = await logoAsDataUrl(file);
		if (!isCurrent(current, version)) return false;
		logo.value = file;
		value.value.logoBase64 = data;
		value.value.logoFileName = file.name;
	} catch (cause) {
		if (isCurrent(current, version)) error.value = cause instanceof Error ? cause.message : '图片读取失败';
	} finally {
		if (isCurrent(current, version)) readingLogo.value = false;
	}
	return false;
}

async function save() {
	if (saving.value || readingLogo.value || !form.value || !isCurrent(generation, editorSession)) return;
	const current = generation;
	const version = editorSession;
	const signal = editorBoundary!.signal;
	error.value = '';
	// 在异步校验前锁定草稿，避免重复提交或校验期间修改字段。
	saving.value = true;
	try {
		try {
			await form.value.validate();
		} catch (cause) {
			if (!isCurrent(current, version)) return;
			const fields = (cause as { errorFields?: Array<{ name: string[] }> }).errorFields ?? [];
			activeTab.value = fields.some((field) => ['copyright', 'icpUrl', 'logo', 'title', 'viceDesc', 'viceTitle'].includes(field.name[0] ?? '')) ? 'site' : 'base';
			return;
		}
		if (!isCurrent(current, version)) return;
		await saveTenant(createTenantSaveInput(value.value), signal);
		if (!isCurrent(current, version)) return;
		invalidateEditor();
		emit('saved');
	} catch (cause) {
		if (isCurrent(current, version)) error.value = cause instanceof Error ? cause.message : '租户保存失败';
	} finally {
		if (isCurrent(current, version)) saving.value = false;
	}
}
watch(
	() => value.value.enableReg,
	() => form.value?.clearValidate(['regWayId']),
);
onBeforeUnmount(() => {
	disposed = true;
	invalidateEditor();
});
defineExpose({ show });
</script>

<template>
	<Modal
		:open="open"
		:title="value.id ? '编辑租户' : copying ? '复制租户' : '添加租户'"
		:width="780"
		centered
		:styles="{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }"
		:closable="!saving"
		:keyboard="!saving"
		:cancel-button-props="{ disabled: saving }"
		:mask-closable="false"
		:confirm-loading="saving"
		@ok="save"
		@cancel="invalidateEditor"
	>
		<Alert v-if="error" :message="error" type="error" show-icon class="mb-3" />
		<Form ref="form" name="tenant-editor" :model="value" :disabled="saving" layout="vertical">
			<Tabs v-model:active-key="activeTab">
				<TabPane key="base" tab="基本信息" force-render>
					<FormItem name="tenantType" label="租户类型"
						><RadioGroup
							v-model:value="value.tenantType"
							:disabled="!!value.id"
							:options="[
								{ label: '字段隔离', value: 0 },
								{ label: '数据库隔离', value: 1 },
							]"
					/></FormItem>
					<div class="field-grid">
						<FormItem name="name" label="租户名称" :rules="[{ required: true, message: '请输入租户名称' }]"><Input v-model:value="value.name" /></FormItem>
						<FormItem name="adminAccount" label="租管账号" :rules="[{ required: true, message: '请输入租管账号' }]"><Input v-model:value="value.adminAccount" autocomplete="off" /></FormItem>
						<FormItem name="phone" label="电话" :rules="[{ required: true, message: '请输入电话' }]"><Input v-model:value="value.phone" /></FormItem>
						<FormItem name="dbType" label="数据库类型"
							><Select v-model:value="value.dbType" :options="databaseTypes" :disabled="value.tenantType === 0" show-search option-filter-prop="label" :virtual="false"
						/></FormItem>
						<FormItem name="host" label="主机 Host"><Input v-model:value="value.host" /></FormItem>
						<FormItem name="email" label="邮箱"><Input v-model:value="value.email" /></FormItem>
						<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
					</div>
					<div class="field-grid">
						<FormItem name="enableReg" label="启用注册">
							<RadioGroup v-model:value="value.enableReg" :disabled="saving" :options="[{ label: '启用', value: 1 }, { label: '禁用', value: 2 }]" />
						</FormItem>
						<FormItem name="regWayId" label="注册方案" :rules="[{ required: value.enableReg === 1, message: '请选择注册方案' }, { validator: validateRegistration }]">
							<Select
								v-model:value="value.regWayId"
								:options="registrationOptions"
								:loading="loadingRegistrations"
								:disabled="saving || value.enableReg !== 1 || loadingRegistrations || !registrationsLoaded"
								placeholder="请选择注册方案"
								show-search
								option-filter-prop="label"
								allow-clear
								:virtual="false"
							/>
						</FormItem>
					</div>
					<div v-if="registrationError" class="mb-3">
						<Alert :message="registrationError" type="error" show-icon />
						<Button class="mt-2" :disabled="saving" @click="loadRegistrations">重新加载注册方案</Button>
					</div>
					<Alert v-else-if="value.enableReg === 1 && registrationsLoaded && !registrationOptions.length" message="暂无可用注册方案，请先配置注册方案后重新加载。" type="warning" show-icon class="mb-3" />
					<Button v-if="!registrationError && value.enableReg === 1 && registrationsLoaded" class="mb-3" :disabled="saving" :loading="loadingRegistrations" @click="loadRegistrations">刷新注册方案</Button>
					<FormItem name="connection" label="连接字符串"><InputPassword v-model:value="value.connection" :disabled="value.tenantType === 0" autocomplete="off" /></FormItem>
					<FormItem name="slaveConnections" label="从库连接串"><InputPassword v-model:value="value.slaveConnections" :disabled="value.tenantType === 0" autocomplete="off" /></FormItem>
					<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="2" /></FormItem>
				</TabPane>
				<TabPane v-if="value.host?.trim()" key="site" tab="站点信息" force-render>
					<FormItem name="logo" label="Logo" :rules="[{ validator: validateLogo }]">
						<div class="logo-row">
							<Image v-if="value.logoBase64 || value.logo" :src="value.logoBase64 || value.logo || ''" :width="64" :height="64" />
							<Upload accept="image/*" :show-upload-list="false" :before-upload="chooseLogo"><Button :loading="readingLogo">选择 Logo</Button></Upload
							><span>{{ logo?.name }}</span>
						</div>
					</FormItem>
					<FormItem name="title" label="标题" :rules="[{ required: true, message: '请输入标题' }]"><Input v-model:value="value.title" :maxlength="32" /></FormItem>
					<FormItem name="viceTitle" label="副标题" :rules="[{ required: true, message: '请输入副标题' }]"><Input v-model:value="value.viceTitle" :maxlength="32" /></FormItem>
					<FormItem name="viceDesc" label="副标题描述" :rules="[{ required: true, message: '请输入副标题描述' }]"><Input v-model:value="value.viceDesc" :maxlength="64" /></FormItem>
					<FormItem name="copyright" label="版权信息" :rules="[{ required: true, message: '请输入版权信息' }]"><Input v-model:value="value.copyright" :maxlength="64" /></FormItem>
					<div class="field-grid">
						<FormItem name="icp" label="备案号"><Input v-model:value="value.icp" /></FormItem>
						<FormItem name="icpUrl" label="ICP 地址" :rules="[{ required: !!value.icp, message: '请输入 ICP 地址' }]"><Input v-model:value="value.icpUrl" /></FormItem>
					</div>
					<FormItem name="watermark" label="水印"><Input v-model:value="value.watermark" /></FormItem>
				</TabPane>
			</Tabs>
		</Form>
	</Modal>
</template>

<style scoped>
.field-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0 16px;
}
.logo-row {
	display: flex;
	align-items: center;
	gap: 12px;
	flex-wrap: wrap;
}
@media (max-width: 600px) {
	.field-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
