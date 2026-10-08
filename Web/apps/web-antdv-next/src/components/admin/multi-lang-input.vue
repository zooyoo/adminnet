<script setup lang="ts">
import { computed, ref } from 'vue';

import { createIconifyIcon } from '@vben/icons';
import { preferences } from '@vben/preferences';

import { Alert, Button, Form, FormItem, Input, message, Modal, Spin, Tooltip } from 'antdv-next';

import { SysLangTextApi } from '#/api-services/apis/sys-lang-text-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

defineOptions({ inheritAttrs: false });
const props = defineProps<{ entityName: string; entityId?: number; fieldName: string }>();
const value = defineModel<string>({ default: '' });
const Globe = createIconifyIcon('lucide:languages');
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const translating = ref(false);
const error = ref('');
const languages = ref<Array<{ code: string; label: string; value: string }>>([]);
const values = ref<Record<string, string>>({});
const current = computed(() => languages.value.find((lang) => [lang.code, lang.value].includes(preferences.app.locale))?.code ?? preferences.app.locale);
let generation = 0;

async function show() {
	if (!props.entityId) {
		message.warning('请先保存数据');
		return;
	}
	const version = ++generation;
	open.value = true;
	loading.value = true;
	error.value = '';
	try {
		const [langs, result] = await Promise.all([
			requestClient.post<Array<{ code: string; label: string; value: string }>>('/api/sysLang/dropdownData'),
			getAPI(SysLangTextApi).apiSysLangTextListPost({ entityName: props.entityName, entityId: props.entityId, fieldName: props.fieldName }),
		]);
		if (version !== generation) return;
		languages.value = langs;
		values.value = Object.fromEntries((result.data.result ?? []).filter((item) => item.langCode).map((item) => [item.langCode!, item.content ?? '']));
		values.value[current.value] = value.value;
	} catch (cause) {
		error.value = cause instanceof Error ? cause.message : '翻译加载失败';
	} finally {
		if (version === generation) loading.value = false;
	}
}

async function translate() {
	translating.value = true;
	const version = generation;
	try {
		for (const lang of languages.value.filter((item) => item.code !== current.value)) {
			const response = await getAPI(SysLangTextApi).apiSysLangTextAiTranslateTextPost({ originalText: value.value, targetLang: lang.code });
			if (version !== generation) return;
			values.value[lang.code] = response.data.result ?? '';
		}
	} catch {
		// 保留已翻译内容，允许用户重试。
	} finally {
		translating.value = false;
	}
}

async function save() {
	if (!props.entityId || loading.value || saving.value || translating.value || error.value) return;
	const data = Object.entries(values.value)
		.filter(([, content]) => content.trim())
		.map(([langCode, content]) => ({ entityName: props.entityName, fieldName: props.fieldName, entityId: props.entityId!, langCode, content }));
	if (!data.length) {
		message.warning('请输入至少一条多语言内容');
		return;
	}
	saving.value = true;
	try {
		await getAPI(SysLangTextApi).apiSysLangTextBatchSavePost(data);
		value.value = values.value[current.value] ?? value.value;
		open.value = false;
		message.success('翻译已保存');
	} catch {
		// 保存失败不关闭弹窗，错误由请求层提示。
	} finally {
		saving.value = false;
	}
}
</script>

<template>
	<div class="translation-input">
		<Input v-bind="$attrs" v-model:value="value">
			<template #addonAfter
				><Tooltip title="多语言设置"
					><Button type="text" size="small" aria-label="多语言设置" @click="show"><Globe :size="16" /></Button></Tooltip
			></template>
		</Input>
		<Modal v-model:open="open" title="多语言设置" :width="600" :mask-closable="false" @cancel="generation++">
			<Alert v-if="error" :message="error" type="error" show-icon />
			<Spin :spinning="loading">
				<Form :model="values" name="translation" layout="vertical">
					<FormItem v-for="lang in languages" :key="lang.code" :name="lang.code" :label="lang.label"><Input v-model:value="values[lang.code]" /></FormItem>
				</Form>
			</Spin>
			<template #footer>
				<Button :loading="translating" :disabled="loading || !!error || saving" @click="translate">AI 翻译</Button>
				<Button
					@click="
						open = false;
						generation++;
					"
					>关闭</Button
				>
				<Button type="primary" :loading="saving" :disabled="loading || translating || !!error" @click="save">确认修改</Button>
			</template>
		</Modal>
	</div>
</template>
