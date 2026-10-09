<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { LdapDraft } from '#/api/system/ldap';

import { onBeforeUnmount, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Form, FormItem, Input, InputNumber, InputPassword, Modal, Select, Spin } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { ldapDetail, ldapDraft, ldapTextFields, saveLdap } from '#/api/system/ldap';

const emit = defineEmits<{ saved: [] }>();
const user = useUserStore();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const value = ref<LdapDraft>(ldapDraft());
const form = ref<FormInstance>();
let generation = 0;
let editorSession = sessionBoundary.version;
async function show(id?: number, tenantId?: number) {
	if (saving.value) return;
	const current = ++generation;
	const version = sessionBoundary.version;
	editorSession = version;
	open.value = true;
	loading.value = true;
	error.value = '';
	value.value = ldapDraft(undefined, tenantId ?? (Number(user.userInfo?.currentTenantId) || undefined));
	try {
		const result = id ? await ldapDetail(id) : undefined;
		if (current !== generation || version !== sessionBoundary.version) return;
		if (id && !result) throw new Error('域配置不存在');
		value.value = ldapDraft(result, value.value.tenantId ?? undefined);
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '加载域配置失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
async function save() {
	if (loading.value || saving.value || error.value || editorSession !== sessionBoundary.version) return;
	const current = generation;
	try {
		await form.value?.validate();
	} catch {
		return;
	}
	if (current !== generation || editorSession !== sessionBoundary.version || !open.value || saving.value) return;
	saving.value = true;
	try {
		await saveLdap({ ...value.value });
		if (current !== generation || editorSession !== sessionBoundary.version) return;
		value.value.bindPass = '';
		open.value = false;
		emit('saved');
	} catch {
		/* 请求层提示错误，保留草稿。 */
	} finally {
		saving.value = false;
	}
}
function cancel() {
	generation++;
	value.value.bindPass = '';
}
onBeforeUnmount(cancel);
defineExpose({ show });
</script>

<template>
	<Modal
		v-model:open="open"
		:title="value.id ? '编辑域配置' : '新增域配置'"
		:width="760"
		centered
		:mask="{ closable: false }"
		:styles="{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }"
		:closable="!saving"
		:keyboard="!saving"
		:cancel-button-props="{ disabled: saving }"
		:confirm-loading="saving"
		:ok-button-props="{ disabled: loading || !!error }"
		@ok="save"
		@cancel="cancel"
	>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading">
			<Form ref="form" name="ldap-editor" :model="value" layout="vertical" :disabled="loading || saving || !!error">
				<div class="field-grid">
					<FormItem v-for="field in ldapTextFields" :key="field.key" :name="field.key" :label="field.label" :rules="[{ required: true, message: `请输入${field.label}` }]">
						<Input v-model:value="value[field.key]" :maxlength="field.max" />
					</FormItem>
					<FormItem name="port" label="端口" :rules="[{ required: true, type: 'number', min: 1, max: 65535, message: '请输入 1—65535 的端口' }]">
						<InputNumber v-model:value="value.port" :min="1" :max="65535" :precision="0" class="w-full" />
					</FormItem>
					<FormItem name="version" label="LDAP 版本" :rules="[{ required: true }]">
						<Select
							v-model:value="value.version"
							:options="[
								{ label: 'LDAP v3', value: 3 },
								{ label: 'LDAP v2', value: 2 },
							]"
						/>
					</FormItem>
					<FormItem name="status" label="状态"
						><Select
							v-model:value="value.status"
							:options="[
								{ label: '启用', value: 1 },
								{ label: '停用', value: 2 },
							]"
					/></FormItem>
				</div>
				<FormItem name="bindPass" label="绑定密码" :rules="[{ required: !value.id, message: '请输入绑定密码' }]">
					<InputPassword v-model:value="value.bindPass" autocomplete="new-password" :maxlength="128" :placeholder="value.id ? '留空保留原密码' : '请输入绑定密码'" />
				</FormItem>
			</Form>
		</Spin>
	</Modal>
</template>

<style scoped>
.field-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0 16px;
}
@media (max-width: 640px) {
	.field-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
