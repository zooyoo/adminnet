<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { RegistrationDraft, RegistrationRecord } from '#/api/system/registration';

import { computed, onBeforeUnmount, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Form, FormItem, Input, InputNumber, Modal, Select, Spin, TextArea, TreeSelect } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { registrationOptions, saveRegistration } from '#/api/system/registration';
import { useReferenceStore } from '#/store/reference';
import { treeOptions } from '#/utils/admin-tree';

const emit = defineEmits<{ saved: [] }>();
const reference = useReferenceStore();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const form = ref<FormInstance>();
const value = ref<RegistrationDraft>({ name: '', accountType: 777, orderNo: 100 });
const options = ref<Awaited<ReturnType<typeof registrationOptions>>>({ orgs: [], roles: [], positions: [] });
const orgs = computed(() => treeOptions(options.value.orgs, undefined, value.value.tenantId ?? undefined));
const accountTypes = computed(() => reference.options('AccountTypeEnum').filter((item) => item.value !== 888 && item.value !== 999));
let generation = 0;
let editorSession = sessionBoundary.version;
async function show(record?: RegistrationRecord, tenantId?: number) {
	if (saving.value) return;
	const current = ++generation;
	const version = sessionBoundary.version;
	editorSession = version;
	value.value = {
		id: record?.id,
		tenantId: record?.tenantId ?? tenantId ?? (Number(useUserStore().userInfo?.currentTenantId) || undefined),
		name: record?.name ?? '',
		accountType: record?.accountType ?? 777,
		roleId: record?.roleId,
		orgId: record?.orgId,
		posId: record?.posId,
		orderNo: record?.orderNo ?? 100,
		remark: record?.remark ?? '',
	};
	options.value = { orgs: [], roles: [], positions: [] };
	open.value = true;
	loading.value = true;
	error.value = '';
	try {
		const [result] = await Promise.all([registrationOptions(value.value.tenantId ?? undefined), reference.load()]);
		if (current !== generation || version !== sessionBoundary.version) return;
		options.value = result;
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '注册方案选项加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
async function save() {
	if (loading.value || saving.value || error.value || editorSession !== sessionBoundary.version) return;
	const current = generation;
	const version = editorSession;
	try {
		await form.value?.validate();
	} catch {
		return;
	}
	if (current !== generation || version !== sessionBoundary.version || !open.value || saving.value) return;
	saving.value = true;
	try {
		await saveRegistration(value.value);
		if (current !== generation || version !== sessionBoundary.version) return;
		open.value = false;
		emit('saved');
	} catch {
		/* 请求层提示错误，保留草稿。 */
	} finally {
		saving.value = false;
	}
}
onBeforeUnmount(() => generation++);
defineExpose({ show });
</script>

<template>
	<Modal
		v-model:open="open"
		:title="value.id ? '编辑注册方案' : '添加注册方案'"
		:width="640"
		:mask="{ closable: false }"
		centered
		:styles="{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }"
		:closable="!saving"
		:keyboard="!saving"
		:cancel-button-props="{ disabled: saving }"
		:confirm-loading="saving"
		:ok-button-props="{ disabled: loading || !!error }"
		@ok="save"
		@cancel="generation++"
	>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading"
			><Form ref="form" name="registration-editor" :model="value" layout="vertical">
				<FormItem name="name" label="方案名称" :rules="[{ required: true, message: '请输入方案名称' }]"><Input v-model:value="value.name" /></FormItem>
				<FormItem name="accountType" label="账户类型" :rules="[{ required: true, message: '请选择账户类型' }]"
					><Select v-model:value="value.accountType" :options="accountTypes" :virtual="false"
				/></FormItem>
				<FormItem name="roleId" label="绑定角色" :rules="[{ required: true, message: '请选择角色' }]"
					><Select v-model:value="value.roleId" :options="options.roles.map((item) => ({ label: item.name, value: item.id }))" :virtual="false" show-search option-filter-prop="label"
				/></FormItem>
				<FormItem name="orgId" label="绑定机构" :rules="[{ required: true, message: '请选择机构' }]"
					><TreeSelect v-model:value="value.orgId" :tree-data="orgs" tree-default-expand-all show-search tree-node-filter-prop="title"
				/></FormItem>
				<FormItem name="posId" label="绑定职位" :rules="[{ required: true, message: '请选择职位' }]"
					><Select v-model:value="value.posId" :options="options.positions.map((item) => ({ label: item.name, value: item.id }))" :virtual="false" show-search option-filter-prop="label"
				/></FormItem>
				<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
				<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="3" /></FormItem> </Form
		></Spin>
	</Modal>
</template>
