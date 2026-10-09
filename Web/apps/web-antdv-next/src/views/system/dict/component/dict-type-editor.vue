<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { DictType, UpdateDictTypeInput } from '#/api/system/dict';

import { onBeforeUnmount, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Form, FormItem, Input, InputNumber, Modal, RadioGroup, TextArea } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { saveDictType } from '#/api/system/dict';
import MultiLangInput from '#/components/admin/multi-lang-input.vue';

const emit = defineEmits<{ saved: [record: UpdateDictTypeInput] }>();
const user = useUserStore();
const open = ref(false);
const saving = ref(false);
const form = ref<FormInstance>();
const value = ref<UpdateDictTypeInput>({ name: '', code: '', sysFlag: 2, isTenant: 2, status: 1, orderNo: 100 });
const builtin = ref(false);
let generation = 0;
let editorSession = sessionBoundary.version;
function show(record?: DictType) {
	if (saving.value) return;
	generation++;
	editorSession = sessionBoundary.version;
	value.value = {
		id: record?.id,
		name: record?.name ?? '',
		code: record?.code ?? '',
		sysFlag: record?.sysFlag ?? 2,
		isTenant: record?.isTenant ?? 2,
		status: record?.status ?? 1,
		orderNo: record?.orderNo ?? 100,
		remark: record?.remark ?? '',
	};
	builtin.value = Boolean(record?.id && record.sysFlag === 1);
	open.value = true;
	form.value?.clearValidate();
}
async function save() {
	if (saving.value || editorSession !== sessionBoundary.version) return;
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
		await saveDictType(value.value);
		if (current !== generation || version !== sessionBoundary.version) return;
		open.value = false;
		emit('saved', { ...value.value });
	} catch {
		/* 请求层提示错误，保留编辑状态。 */
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
		:title="value.id ? '编辑字典' : '添加字典'"
		:width="600"
		:mask="{ closable: false }"
		:confirm-loading="saving"
		centered
		:styles="{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }"
		:closable="!saving"
		:keyboard="!saving"
		:cancel-button-props="{ disabled: saving }"
		@ok="save"
		@cancel="generation++"
	>
		<Form ref="form" name="dict-type-editor" :model="value" layout="vertical">
			<FormItem name="name" label="字典名称" html-for="dict-type-name" :rules="[{ required: true, message: '请输入字典名称' }]"
				><MultiLangInput id="dict-type-name" v-model="value.name" entity-name="SysDictType" field-name="Name" :entity-id="value.id"
			/></FormItem>
			<FormItem name="code" label="字典编码" :rules="[{ required: true, message: '请输入字典编码' }]"><Input v-model:value="value.code" /></FormItem>
			<FormItem v-if="user.userInfo?.accountType === 999" name="sysFlag" label="系统内置"
				><RadioGroup
					v-model:value="value.sysFlag"
					:disabled="builtin"
					:options="[
						{ label: '是', value: 1 },
						{ label: '否', value: 2 },
					]"
			/></FormItem>
			<FormItem v-if="user.userInfo?.accountType === 999" name="isTenant" label="租户字典"
				><RadioGroup
					v-model:value="value.isTenant"
					:disabled="!!value.id"
					:options="[
						{ label: '是', value: 1 },
						{ label: '否', value: 2 },
					]"
			/></FormItem>
			<FormItem name="status" label="状态"
				><RadioGroup
					v-model:value="value.status"
					:options="[
						{ label: '启用', value: 1 },
						{ label: '禁用', value: 2 },
					]"
			/></FormItem>
			<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
			<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="2" /></FormItem>
		</Form>
	</Modal>
</template>
