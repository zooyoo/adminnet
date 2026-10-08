<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { TranslationDraft } from '#/api/system/lang-text';

import { ref } from 'vue';

import { Alert, Form, FormItem, Input, InputNumber, Modal, Spin, TextArea } from 'antdv-next';

import { saveTranslation, translationDetail, translationDraft } from '#/api/system/lang-text';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const form = ref<FormInstance>();
const value = ref<TranslationDraft>(translationDraft());
let generation = 0;
async function show(id?: number) {
	const current = ++generation;
	open.value = true;
	loading.value = true;
	error.value = '';
	value.value = translationDraft();
	try {
		const record = id ? await translationDetail(id) : undefined;
		if (current !== generation) return;
		value.value = translationDraft(record as Partial<TranslationDraft> | undefined);
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '翻译加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
async function save() {
	if (loading.value || saving.value || error.value) return;
	try {
		await form.value?.validate();
	} catch {
		return;
	}
	saving.value = true;
	try {
		await saveTranslation(value.value);
		open.value = false;
		emit('saved');
	} catch {
		/* 请求层提示错误，保留草稿。 */
	} finally {
		saving.value = false;
	}
}
defineExpose({ show });
</script>

<template>
	<Modal
		v-model:open="open"
		:title="value.id ? '编辑翻译' : '新增翻译'"
		:width="600"
		:mask-closable="false"
		:confirm-loading="saving"
		:ok-button-props="{ disabled: loading || !!error }"
		@ok="save"
		@cancel="generation++"
	>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading">
			<Form ref="form" name="translation-editor" :model="value" layout="vertical">
				<FormItem name="entityName" label="所属实体名" :rules="[{ required: true, message: '请输入所属实体名' }]"><Input v-model:value="value.entityName" :maxlength="255" /></FormItem>
				<FormItem name="entityId" label="所属实体 ID" :rules="[{ required: true, message: '请输入所属实体 ID' }]"
					><InputNumber v-model:value="value.entityId" :precision="0" :min="0" class="w-full"
				/></FormItem>
				<FormItem name="fieldName" label="字段名" :rules="[{ required: true, message: '请输入字段名' }]"><Input v-model:value="value.fieldName" :maxlength="255" /></FormItem>
				<FormItem name="langCode" label="语言代码" :rules="[{ required: true, message: '请输入语言代码' }]"><Input v-model:value="value.langCode" :maxlength="255" /></FormItem>
				<FormItem name="content" label="翻译内容" :rules="[{ required: true, message: '请输入翻译内容' }]"><TextArea v-model:value="value.content" :maxlength="255" :rows="3" /></FormItem>
			</Form>
		</Spin>
	</Modal>
</template>
