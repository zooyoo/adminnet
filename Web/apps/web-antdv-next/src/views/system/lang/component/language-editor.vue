<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { LanguageDraft } from '#/api/system/lang';

import { onBeforeUnmount, ref } from 'vue';

import { Alert, Form, FormItem, Input, Modal, Select, Spin, Switch } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { directionOptions, languageDetail, languageDraft, languageFields, saveLanguage, weekOptions } from '#/api/system/lang';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const value = ref<LanguageDraft>(languageDraft());
const form = ref<FormInstance>();
let generation = 0;
let editorSession = sessionBoundary.version;
async function show(id?: number) {
	if (saving.value) return;
	const current = ++generation;
	const version = sessionBoundary.version;
	editorSession = version;
	open.value = true;
	loading.value = true;
	error.value = '';
	value.value = languageDraft();
	try {
		const record = id ? await languageDetail(id) : undefined;
		if (current !== generation || version !== sessionBoundary.version) return;
		value.value = languageDraft(record as Partial<LanguageDraft> | undefined);
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '加载失败';
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
		await saveLanguage(value.value);
		if (current !== generation || version !== sessionBoundary.version) return;
		open.value = false;
		emit('saved');
	} catch {
		/* 请求层提示失败，保留草稿。 */
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
		:title="value.id ? '编辑语言' : '新增语言'"
		:width="720"
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
		<Spin :spinning="loading">
			<Form ref="form" name="language-editor" :model="value" layout="vertical">
				<div class="field-grid">
					<FormItem v-for="field in languageFields" :key="field.key" :name="field.key" :label="field.label" :rules="[{ required: field.required, message: `请输入${field.label}` }]"
						><Input v-model:value="value[field.key]" :maxlength="255"
					/></FormItem>
					<FormItem name="direction" label="书写方向" :rules="[{ required: true }]"><Select v-model:value="value.direction" :options="directionOptions" :virtual="false" /></FormItem>
					<FormItem name="weekStart" label="每周起始日" :rules="[{ required: true }]"><Select v-model:value="value.weekStart" :options="weekOptions" :virtual="false" /></FormItem>
					<FormItem name="active" label="是否启用"><Switch v-model:checked="value.active" /></FormItem>
				</div>
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
@media (max-width: 600px) {
	.field-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
