<script setup lang="ts">
import type { AddJobDetailInput, SysJobDetail } from '#/api-services/models';

import { computed, onScopeDispose, reactive, ref, watch } from 'vue';

import { Alert, Form, FormItem, Input, Modal, Select, Switch } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { saveJob } from '#/api/system/job';

import CodeEditor from '../../plugin/code-editor.vue';
import { httpFields, jobDraft, jobPayload } from '../job-form';

const props = defineProps<{ record?: SysJobDetail; open: boolean }>();
const emit = defineEmits<{ saved: []; 'update:open': [value: boolean] }>();
const draft = ref<AddJobDetailInput>(jobDraft());
const http = reactive(httpFields());
const error = ref('');
const saving = ref(false);
let generation = 0;
let operation: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
lifetime.signal.addEventListener('abort', () => {
	generation += 1;
	operation?.abort();
	saving.value = false;
	emit('update:open', false);
});
const httpJob = computed(() => draft.value.createType === 2);
watch(
	() => props.open,
	(open) => {
		generation += 1;
		operation?.abort();
		saving.value = false;
		error.value = '';
		if (!open) return;
		draft.value = jobDraft(props.record);
		try {
			Object.assign(http, httpFields(draft.value.properties));
		} catch {
			error.value = '既有任务参数不是有效 JSON，请修正后保存';
		}
	}
);
async function save() {
	if (saving.value || !props.open) return;
	const current = generation;
	const session = sessionBoundary.version;
	const controller = new AbortController();
	operation = controller;
	const valid = () => current === generation && session === sessionBoundary.version && !controller.signal.aborted;
	saving.value = true;
	error.value = '';
	try {
		await saveJob(jobPayload(draft.value, http), controller.signal);
		if (!valid()) return;
		emit('saved');
		emit('update:open', false);
	} catch (cause) {
		if (valid()) error.value = cause instanceof Error ? cause.message : '任务保存失败';
	} finally {
		if (valid()) saving.value = false;
	}
}
onScopeDispose(() => {
	operation?.abort();
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<Modal
		:open="open"
		centered
		:title="record ? '编辑任务' : '新增任务'"
		:width="840"
		:confirm-loading="saving"
		:closable="!saving"
		:keyboard="!saving"
		:mask="{ closable: false }"
		:cancel-button-props="{ disabled: saving }"
		ok-text="保存任务"
		@ok="save"
		@cancel="emit('update:open', false)"
	>
		<div class="job-editor">
			<Alert v-if="error" type="error" :title="error" show-icon />
			<Form :model="draft" layout="vertical" :disabled="saving">
				<div class="job-fields">
					<FormItem label="任务编号" required><Input v-model:value="draft.jobId" aria-label="任务编号" :maxlength="64" :disabled="!!record" /></FormItem>
					<FormItem label="分组"><Input v-model:value="draft.groupName" aria-label="任务分组" :maxlength="128" /></FormItem>
					<FormItem name="createType" label="创建类型"
						><Select
							v-model:value="draft.createType"
							aria-label="创建类型"
							:disabled="!!record"
							:options="
								record?.createType === 0
									? [{ value: 0, label: '内置' }]
									: [
											{ value: 2, label: 'HTTP' },
											{ value: 1, label: '脚本' },
										]
							"
					/></FormItem>
					<FormItem label="描述"><Input v-model:value="draft.description" aria-label="任务描述" :maxlength="128" /></FormItem>
				</div>
				<div v-if="httpJob" class="job-fields">
					<FormItem label="HTTP 地址" required><Input v-model:value="http.uri" aria-label="HTTP 地址" /></FormItem>
					<FormItem name="httpMethod" label="请求方法"
						><Select v-model:value="http.method" aria-label="请求方法" :options="['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((value) => ({ label: value, value }))"
					/></FormItem>
				</div>
				<FormItem v-if="httpJob" label="请求正文"><Input.TextArea v-model:value="http.body" aria-label="请求正文" :rows="3" /></FormItem>
				<FormItem v-if="open && draft.createType === 1" label="C# 脚本" required><CodeEditor :value="draft.scriptCode ?? ''" :disabled="saving" @update:value="draft.scriptCode = $event" /></FormItem>
				<FormItem label="任务参数 JSON"><Input.TextArea v-model:value="draft.properties" aria-label="任务参数 JSON" :rows="4" class="font-mono" /></FormItem>
				<div class="job-fields">
					<FormItem label="允许并行"><Switch v-model:checked="draft.concurrent" aria-label="允许并行" /></FormItem>
					<FormItem label="包含注解触发器"><Switch v-model:checked="draft.includeAnnotation" aria-label="包含注解触发器" /></FormItem>
				</div>
			</Form>
		</div>
	</Modal>
</template>

<style scoped>
.job-editor {
	max-height: 70vh;
	overflow: auto;
	padding-right: 8px;
}
.job-fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}
</style>
