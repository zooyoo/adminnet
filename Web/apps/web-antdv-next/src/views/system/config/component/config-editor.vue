<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { ConfigRecord, ConfigScope, UpdateConfigInput } from '#/api/system/config';

import { ref } from 'vue';

import { Alert, AutoComplete, Button, Dropdown, Form, FormItem, Input, InputNumber, Modal, RadioGroup, TextArea } from 'antdv-next';

import { configService } from '#/api/system/config';

const props = defineProps<{ scope: ConfigScope; groups: string[] }>();
const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const saving = ref(false);
const error = ref('');
const builtin = ref(false);
const value = ref<UpdateConfigInput>({ name: '', code: '', value: '', sysFlag: 2, orderNo: 100, groupCode: '', remark: '' });
const form = ref<FormInstance>();
function show(record?: ConfigRecord) {
	value.value = {
		id: record?.id,
		name: record?.name ?? '',
		code: record?.code ?? '',
		value: record?.value ?? '',
		sysFlag: record?.sysFlag ?? 2,
		groupCode: record?.groupCode ?? '',
		orderNo: record?.orderNo ?? 100,
		remark: record?.remark ?? '',
	};
	builtin.value = record?.sysFlag === 1 && !!record.id;
	error.value = '';
	open.value = true;
	form.value?.clearValidate();
}
async function save() {
	if (saving.value) return;
	try {
		await form.value?.validate();
	} catch {
		return;
	}
	saving.value = true;
	try {
		await configService(props.scope).save(value.value);
		open.value = false;
		emit('saved');
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '配置保存失败';
	} finally {
		saving.value = false;
	}
}
defineExpose({ show });
</script>

<template>
	<Modal v-model:open="open" :title="value.id ? '编辑配置' : '添加配置'" :width="640" :mask-closable="false" :confirm-loading="saving" @ok="save">
		<Alert v-if="error" :message="error" type="error" show-icon class="mb-3" />
		<Form ref="form" name="config-editor" :model="value" layout="vertical">
			<FormItem name="name" label="配置名称" :rules="[{ required: true, message: '请输入配置名称' }]"><Input v-model:value="value.name" /></FormItem>
			<FormItem name="code" label="配置编码" :rules="[{ required: true, message: '请输入配置编码' }]"><Input v-model:value="value.code" :disabled="value.sysFlag === 1" /></FormItem>
			<FormItem name="value" label="值" :rules="[{ required: true, message: '请输入值' }]">
				<Input v-model:value="value.value"
					><template #addonAfter
						><Dropdown
							:trigger="['click']"
							:menu="{
								items: [
									{ key: 'True', label: 'True' },
									{ key: 'False', label: 'False' },
								],
							}"
							@menu-click="({ key }) => (value.value = String(key))"
							><Button type="text" size="small">选项</Button></Dropdown
						></template
					></Input
				>
			</FormItem>
			<FormItem name="sysFlag" label="内置参数" :rules="[{ required: true }]"
				><RadioGroup
					v-model:value="value.sysFlag"
					:disabled="builtin"
					:options="[
						{ label: '是', value: 1 },
						{ label: '否', value: 2 },
					]"
			/></FormItem>
			<FormItem name="groupCode" label="分组编码"><AutoComplete v-model:value="value.groupCode" :options="groups.map((item) => ({ value: item }))" :disabled="value.sysFlag === 1" /></FormItem>
			<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
			<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="3" /></FormItem>
		</Form>
	</Modal>
</template>
