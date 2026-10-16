<script setup lang="ts">
import type { AddJobTriggerInput, SysJobTrigger } from '#/api-services/models';
import type { CronPreview } from '#/api/system/job';

import { computed, onScopeDispose, ref, watch } from 'vue';

import { Alert, Button, Form, FormItem, Input, InputNumber, Modal, Select, Switch } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { previewCron, saveTrigger } from '#/api/system/job';

import { cronArgs, cronFieldTitles, cronFormats, cronType, parseCronArgs, periodType, triggerDraft, wallTime } from '../job-form';

const props = defineProps<{ jobId: string; open: boolean; record?: SysJobTrigger }>();
const emit = defineEmits<{ saved: []; 'update:open': [value: boolean] }>();
const draft = ref<AddJobTriggerInput>(triggerDraft(''));
const expression = ref('0 */5 * * * *');
const format = ref(2);
const fromTime = ref('');
const startTime = ref('');
const endTime = ref('');
const preview = ref<CronPreview>();
const error = ref('');
const previewing = ref(false);
const saving = ref(false);
const busy = computed(() => saving.value || previewing.value);
let operation: AbortController | undefined;
let generation = 0;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
lifetime.signal.addEventListener('abort', () => {
	generation += 1;
	operation?.abort();
	saving.value = false;
	previewing.value = false;
	emit('update:open', false);
});
const isCron = computed(() => draft.value.triggerType === cronType);
const fields = computed(() => (expression.value.startsWith('@') ? [] : expression.value.trim().split(/\s+/)));
const typeOptions = computed(() => [
	{ label: 'Cron', value: cronType },
	{ label: '周期（毫秒）', value: periodType },
	...(draft.value.triggerType && ![cronType, periodType].includes(draft.value.triggerType) ? [{ label: draft.value.triggerType, value: draft.value.triggerType }] : []),
]);
watch(
	() => props.open,
	(open) => {
		generation += 1;
		operation?.abort();
		saving.value = false;
		previewing.value = false;
		error.value = '';
		preview.value = undefined;
		if (!open) return;
		draft.value = triggerDraft(props.jobId, props.record);
		startTime.value = wallTime(props.record?.startTime);
		endTime.value = wallTime(props.record?.endTime);
		fromTime.value = '';
		if (isCron.value) {
			try {
				const parsed = parseCronArgs(draft.value.args);
				expression.value = parsed.expression;
				format.value = parsed.format;
			} catch (cause) {
				error.value = cause instanceof Error ? cause.message : 'Cron 参数无效';
			}
		}
	}
);
watch([expression, format, startTime, endTime, fromTime], () => {
	preview.value = undefined;
	if (!saving.value) {
		operation?.abort();
		generation += 1;
		previewing.value = false;
	}
});
function setField(index: number, value: string) {
	const values = [...fields.value];
	values[index] = value || '*';
	expression.value = values.join(' ');
}
const cronMacros = [{"value":"@secondly","label":"@secondly 每秒 .0000000"},{"value":"@minutely","label":"@minutely 每分钟 00"},{"value":"@hourly","label":"@hourly 每小时 00:00"},{"value":"@daily","label":"@daily 每天 00:00:00"},{"value":"@monthly","label":"@monthly 每月 1 号 00:00:00"},{"value":"@weekly","label":"@weekly 每周日 00:00:00"},{"value":"@yearly","label":"@yearly 每年 1 月 1 号 00:00:00"},{"value":"@workday","label":"@workday 每周一至周五 00:00:00"}];
function selectMacro(value: unknown) {
	if (typeof value !== 'string' || !cronMacros.some((item) => item.value === value)) return;
	format.value = 0;
	expression.value = value;
}
function preset(value: string) {
	format.value = 2;
	expression.value = value;
}
async function execute(save = false) {
	if (busy.value || !props.open) return;
	const current = generation;
	const session = sessionBoundary.version;
	const controller = new AbortController();
	operation = controller;
	const valid = () => current === generation && session === sessionBoundary.version && !controller.signal.aborted;
	error.value = '';
	if (save) saving.value = true;
	else previewing.value = true;
	try {
		if (draft.value.triggerId.trim().length < 2 && save) throw new Error('触发器编号不能少于 2 个字符');
		if (startTime.value && endTime.value && startTime.value >= endTime.value) throw new Error('结束时间必须晚于起始时间');
		if (isCron.value) {
			const result = await previewCron(
				{ expression: expression.value, format: format.value, fromTime: fromTime.value || undefined, startTime: startTime.value || undefined, endTime: endTime.value || undefined },
				controller.signal
			);
			if (!valid()) return;
			preview.value = result;
			draft.value.args = cronArgs(expression.value, format.value);
		}
		if (!save || !valid()) return;
		await saveTrigger({ ...draft.value, triggerId: draft.value.triggerId.trim(), startTime: startTime.value || null, endTime: endTime.value || null }, controller.signal);
		if (!valid()) return;
		emit('saved');
		emit('update:open', false);
	} catch (cause) {
		if (valid()) error.value = cause instanceof Error ? cause.message : '触发器操作失败';
	} finally {
		if (valid()) {
			saving.value = false;
			previewing.value = false;
		}
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
		:title="record ? '编辑触发器' : '新增触发器'"
		:width="900"
		:confirm-loading="saving"
		:closable="!busy"
		:keyboard="!busy"
		:mask="{ closable: false }"
		:cancel-button-props="{ disabled: busy }"
		ok-text="保存触发器"
		@ok="execute(true)"
		@cancel="emit('update:open', false)"
	>
		<div class="trigger-editor">
			<Alert v-if="error" type="error" :title="error" show-icon />
			<Form :model="draft" layout="vertical" :disabled="busy">
				<div class="trigger-fields">
					<FormItem label="所属任务"><Input :value="jobId" disabled /></FormItem>
					<FormItem label="触发器编号" required><Input v-model:value="draft.triggerId" aria-label="触发器编号" :disabled="!!record" :maxlength="64" /></FormItem>
					<FormItem name="triggerType" label="触发器类型"><Select v-model:value="draft.triggerType" aria-label="触发器类型" :options="typeOptions" /></FormItem>
					<FormItem label="程序集"><Input v-model:value="draft.assemblyName" aria-label="触发器程序集" :maxlength="128" /></FormItem>
				</div>
				<template v-if="isCron">
					<FormItem name="cronFormat" label="Cron 格式"><Select v-model:value="format" aria-label="Cron 格式" :options="cronFormats" /></FormItem>
					<FormItem label="Cron 表达式" required><Input v-model:value="expression" aria-label="Cron 表达式" :maxlength="120" class="font-mono" /></FormItem>
					<FormItem name="cronMacro" label="Cron 宏快捷"><Select aria-label="Cron 宏快捷" :value="expression.startsWith('@') ? expression : undefined" :options="cronMacros" :disabled="busy" @select="selectMacro" /></FormItem>
					<div class="cron-presets">
						<Button @click="preset('*/10 * * * * *')">每 10 秒</Button><Button @click="preset('0 */5 * * * *')">每 5 分钟</Button><Button @click="preset('0 0 9 * * *')">每天 9 点</Button
						><Button
							@click="
								expression = '@daily';
								format = 0;
							"
							>每天宏</Button
						>
					</div>
					<div class="cron-fields">
						<FormItem v-for="(label, index) in fields.length ? cronFieldTitles[format] : []" :key="label" :label="label"
							><Input :value="fields[index]" :aria-label="`Cron ${label}`" @update:value="setField(index, $event)"
						/></FormItem>
					</div>
					<FormItem label="预览起点"><Input v-model:value="fromTime" type="datetime-local" step="1" aria-label="预览起点" /></FormItem>
				</template>
				<FormItem v-else :label="draft.triggerType === periodType ? '周期间隔（毫秒）' : '构造参数 JSON'" required
					><Input v-model:value="draft.args" aria-label="触发器参数" :maxlength="128"
				/></FormItem>
				<div class="trigger-fields">
					<FormItem label="起始时间"><Input v-model:value="startTime" type="datetime-local" step="1" aria-label="触发器起始时间" /></FormItem>
					<FormItem label="结束时间"><Input v-model:value="endTime" type="datetime-local" step="1" aria-label="触发器结束时间" /></FormItem>
					<FormItem label="最大运行次数（0 为不限）"><InputNumber v-model:value="draft.maxNumberOfRuns" aria-label="最大运行次数" :min="0" :precision="0" /></FormItem>
					<FormItem label="最大出错次数（0 为不限）"><InputNumber v-model:value="draft.maxNumberOfErrors" aria-label="最大出错次数" :min="0" :precision="0" /></FormItem>
					<FormItem label="重试次数"><InputNumber v-model:value="draft.numRetries" aria-label="重试次数" :min="0" :precision="0" /></FormItem>
					<FormItem label="重试间隔（毫秒）"><InputNumber v-model:value="draft.retryTimeout" aria-label="重试间隔" :min="0" :precision="0" /></FormItem>
				</div>
				<FormItem label="触发器描述"><Input v-model:value="draft.description" aria-label="触发器描述" :maxlength="128" /></FormItem>
				<div class="trigger-options">
					<FormItem label="立即启动"><Switch v-model:checked="draft.startNow" aria-label="立即启动" /></FormItem
					><FormItem label="启动时执行一次"><Switch v-model:checked="draft.runOnStart" aria-label="启动时执行一次" /></FormItem
					><FormItem label="重置单次触发"><Switch v-model:checked="draft.resetOnlyOnce" aria-label="重置单次触发" /></FormItem>
				</div>
			</Form>
			<Button v-if="isCron" :loading="previewing" :disabled="saving" @click="execute()">预览后续 5 次</Button>
			<section v-if="preview" class="cron-preview" aria-label="Cron 运行预览">
				<strong>服务端时区：{{ preview.timeZoneId }}</strong>
				<p>起点（不含）：{{ preview.fromTime }}</p>
				<ol>
					<li v-for="time in preview.occurrences" :key="time">{{ time }}</li>
				</ol>
				<p v-if="preview.occurrences.length < 5">时间窗口内只有 {{ preview.occurrences.length }} 次运行。</p>
			</section>
		</div>
	</Modal>
</template>

<style scoped>
.trigger-editor {
	max-height: 72vh;
	overflow: auto;
	padding-right: 8px;
}
.trigger-fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px 16px;
}
.cron-fields {
	display: grid;
	grid-template-columns: repeat(4, minmax(0, 1fr));
	gap: 12px;
}
.cron-presets,
.trigger-options {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	margin-bottom: 12px;
}
.cron-preview {
	padding: 12px;
	margin-top: 12px;
	background: hsl(var(--muted));
	border-radius: 6px;
}
.cron-preview ol {
	padding-left: 24px;
}
</style>
