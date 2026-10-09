<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { DictData, DictType, UpdateDictDataInput } from '#/api/system/dict';

import { onBeforeUnmount, ref } from 'vue';

import { Form, FormItem, Input, InputNumber, Modal, Radio, RadioGroup, Tag, TextArea } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { dictTagColor, saveDictData } from '#/api/system/dict';
import MultiLangInput from '#/components/admin/multi-lang-input.vue';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const saving = ref(false);
const title = ref('');
const builtin = ref(false);
const form = ref<FormInstance>();
const value = ref<UpdateDictDataInput>({ label: '', value: '', status: 1, orderNo: 100 });
let generation = 0;
let editorSession = sessionBoundary.version;
const colors = [
	{ label: '主题色', value: 'primary' },
	{ label: '成功', value: 'success' },
	{ label: '信息', value: 'info' },
	{ label: '警告', value: 'warning' },
	{ label: '危险', value: 'danger' },
];
function show(type: DictType, record?: DictData, copy = false) {
	if (saving.value) return;
	generation++;
	editorSession = sessionBoundary.version;
	builtin.value = Boolean(record?.id && !copy && type.sysFlag !== 2);
	title.value = record ? (copy ? '复制字典值' : '编辑字典值') : '添加字典值';
	value.value = {
		id: copy ? undefined : record?.id,
		dictTypeId: type.id,
		label: record?.label ?? '',
		value: record?.value ?? '',
		code: record?.code ?? '',
		tagType: record?.tagType ?? 'primary',
		styleSetting: record?.styleSetting ?? '',
		classSetting: record?.classSetting ?? '',
		orderNo: record?.orderNo ?? 100,
		status: record?.status ?? 1,
		remark: record?.remark ?? '',
		extData: record?.extData ?? '',
	};
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
		await saveDictData(value.value);
		if (current !== generation || version !== sessionBoundary.version) return;
		open.value = false;
		emit('saved');
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
		:title="title"
		:width="640"
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
		<Form ref="form" name="dict-data-editor" :model="value" layout="vertical">
			<FormItem name="label" label="显示文本" html-for="dict-data-label" :rules="[{ required: true, message: '请输入显示文本' }]"
				><MultiLangInput id="dict-data-label" v-model="value.label" entity-name="SysDictData" field-name="Label" :entity-id="value.id"
			/></FormItem>
			<FormItem name="value" label="字典值" :rules="[{ required: true, message: '请输入字典值' }]"><Input v-model:value="value.value" :disabled="builtin" /></FormItem>
			<FormItem name="code" label="编码"><Input v-model:value="value.code" :disabled="builtin" /></FormItem>
			<FormItem name="tagType" label="标签类型"
				><RadioGroup v-model:value="value.tagType"
					><Radio v-for="color in colors" :key="color.value" :value="color.value"
						><Tag :color="dictTagColor(color.value)">{{ color.label }}</Tag></Radio
					></RadioGroup
				></FormItem
			>
			<FormItem name="styleSetting" label="样式 Style"><Input v-model:value="value.styleSetting" /></FormItem>
			<FormItem name="classSetting" label="样式 Class"><Input v-model:value="value.classSetting" /></FormItem>
			<FormItem name="status" label="状态"
				><RadioGroup
					v-model:value="value.status"
					:disabled="builtin"
					:options="[
						{ label: '启用', value: 1 },
						{ label: '禁用', value: 2 },
					]"
			/></FormItem>
			<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
			<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="2" /></FormItem>
			<FormItem name="extData" label="扩展数据"><TextArea v-model:value="value.extData" :rows="4" /></FormItem>
		</Form>
	</Modal>
</template>
