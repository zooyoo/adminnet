<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { TenantRecord, UpdateTenantInput } from '#/api/system/tenant';

import { ref } from 'vue';

import { Alert, Button, Form, FormItem, Image, Input, InputNumber, InputPassword, message, Modal, RadioGroup, Select, TabPane, Tabs, TextArea, Upload } from 'antdv-next';

import { databaseTypes, saveTenant } from '#/api/system/tenant';

import { createTenantDraft, logoAsDataUrl } from '../tenant-form';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const saving = ref(false);
const readingLogo = ref(false);
const error = ref('');
const activeTab = ref('base');
const value = ref<UpdateTenantInput>(createTenantDraft());
const form = ref<FormInstance>();
const logo = ref<File>();
let generation = 0;

async function validateLogo() {
	if (!value.value.logo && !value.value.logoBase64) throw new Error('请选择应用 Logo');
}

function show(record?: TenantRecord) {
	generation += 1;
	value.value = createTenantDraft(record);
	logo.value = undefined;
	error.value = '';
	activeTab.value = 'base';
	open.value = true;
	form.value?.clearValidate();
}

async function chooseLogo(file: File) {
	if (!file.type.startsWith('image/')) {
		message.warning('请选择图片文件');
		return false;
	}
	if (file.size > 5 * 1024 * 1024) {
		message.warning('Logo 不能超过 5 MB');
		return false;
	}
	const current = generation;
	readingLogo.value = true;
	try {
		const data = await logoAsDataUrl(file);
		if (current !== generation) return false;
		logo.value = file;
		value.value.logoBase64 = data;
		value.value.logoFileName = file.name;
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '图片读取失败';
	} finally {
		readingLogo.value = false;
	}
	return false;
}

async function save() {
	if (saving.value || readingLogo.value) return;
	error.value = '';
	try {
		await form.value?.validate();
	} catch (cause) {
		const fields = (cause as { errorFields?: Array<{ name: string[] }> }).errorFields ?? [];
		activeTab.value = fields.some((field) => ['copyright', 'icpUrl', 'logo', 'title', 'viceDesc', 'viceTitle'].includes(field.name[0] ?? '')) ? 'site' : 'base';
		return;
	}
	saving.value = true;
	try {
		await saveTenant({ ...value.value, regWayId: value.value.enableReg === 1 ? value.value.regWayId : undefined });
		open.value = false;
		emit('saved');
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '租户保存失败';
	} finally {
		saving.value = false;
	}
}
defineExpose({ show });
</script>

<template>
	<Modal v-model:open="open" :title="value.id ? '编辑租户' : '添加租户'" :width="780" :mask-closable="false" :confirm-loading="saving" @ok="save" @cancel="generation++">
		<Alert v-if="error" :message="error" type="error" show-icon class="mb-3" />
		<Form ref="form" name="tenant-editor" :model="value" layout="vertical">
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
