<script setup lang="ts">
import type { ScheduleRecord } from '#/api/system/home';

import { computed, onMounted, onScopeDispose, reactive, ref, shallowRef } from 'vue';

import { Alert, Button, Calendar, Form, FormItem, Input, Modal, Select, Tag } from 'antdv-next';
import dayjs from 'dayjs';

import { sessionBoundary } from '#/api/session';
import { deleteSchedule, listSchedules, saveSchedule, setScheduleStatus } from '#/api/system/home';

import { recentScheduleTimes, scheduleEndTime, scheduleLunarLabel, scheduleTimeOptions, scheduleValidation, sortSchedules } from './workbench';

const date = shallowRef(dayjs());
const lunarFormatter = new Intl.DateTimeFormat('zh-CN-u-ca-chinese', { month: 'long', day: 'numeric' });
const records = ref<ScheduleRecord[]>([]);
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const formError = ref('');
const open = ref(false);
const deleting = ref<ScheduleRecord>();
const draft = reactive<ScheduleRecord>({ content: '', scheduleTime: '', startTime: '', endTime: '', status: 0 });
const endTimeOptions = computed(() => scheduleTimeOptions.map((option) => ({ ...option, disabled: option.value <= draft.startTime })));
const controller = new AbortController();
sessionBoundary.track(controller);
const version = sessionBoundary.version;
let active = true;
let requestId = 0;
const current = () => active && !controller.signal.aborted && version === sessionBoundary.version;
const selected = computed(() => sortSchedules(records.value.filter((item) => item.scheduleTime.slice(0, 10) === date.value.format('YYYY-MM-DD'))));
const counts = computed(() => {
	const result: Record<string, number> = {};
	for (const item of records.value) {
		const key = item.scheduleTime.slice(0, 10);
		result[key] = (result[key] ?? 0) + 1;
	}
	return result;
});
async function load() {
	if (!current()) return;
	const id = ++requestId;
	loading.value = true;
	error.value = '';
	try {
		const result = await listSchedules(
			date.value.startOf('month').subtract(7, 'day').format('YYYY-MM-DDT00:00:00'),
			date.value.endOf('month').add(7, 'day').format('YYYY-MM-DDT23:59:59'),
			controller.signal
		);
		if (current() && id === requestId) records.value = result;
	} catch (cause) {
		if (current() && id === requestId) {
			records.value = [];
			error.value = cause instanceof Error ? cause.message : '日程加载失败';
		}
	} finally {
		if (current() && id === requestId) loading.value = false;
	}
}
function edit(record?: ScheduleRecord) {
	if (busy.value || !current()) return;
	// 编辑回填不触发开始时间联动，仅新建时按弹窗打开时的本地时间生成默认值。
	Object.assign(draft, record ?? { id: undefined, content: '', scheduleTime: date.value.format('YYYY-MM-DD'), ...recentScheduleTimes(), status: 0 });
	draft.scheduleTime = draft.scheduleTime.slice(0, 10);
	formError.value = '';
	open.value = true;
}
function changeStartTime(value: unknown) {
	if (busy.value || !current()) return;
	draft.startTime = typeof value === 'string' ? value : '';
	draft.endTime = scheduleEndTime(draft.startTime);
	formError.value = '';
}
controller.signal.addEventListener(
	'abort',
	() => {
		active = false;
		requestId += 1;
		records.value = [];
		open.value = false;
		deleting.value = undefined;
		Object.assign(draft, { id: undefined, content: '', scheduleTime: '', startTime: '', endTime: '', status: 0 });
		loading.value = false;
		busy.value = false;
		formError.value = '';
		error.value = '会话已切换，请重新打开工作台';
	},
	{ once: true }
);
async function save() {
	if (busy.value || !current()) return;
	formError.value = scheduleValidation(draft);
	if (formError.value) return;
	busy.value = true;
	try {
		await saveSchedule({ ...draft, content: draft.content.trim() }, controller.signal);
		if (!current()) return;
		open.value = false;
		date.value = dayjs(draft.scheduleTime);
		await load();
	} catch (cause) {
		if (current()) formError.value = cause instanceof Error ? cause.message : '日程保存失败';
	} finally {
		if (current()) busy.value = false;
	}
}
async function mutate(record: ScheduleRecord, remove = false) {
	if (busy.value || !current()) return;
	busy.value = true;
	error.value = '';
	try {
		if (remove) await deleteSchedule(record.id, controller.signal);
		else await setScheduleStatus(record.id, record.status === 1 ? 0 : 1, controller.signal);
		if (!current()) return;
		deleting.value = undefined;
		if (remove && draft.id === record.id) {
			open.value = false;
			Object.assign(draft, { id: undefined, content: '', scheduleTime: '', startTime: '', endTime: '', status: 0 });
			formError.value = '';
		}
		await load();
	} catch (cause) {
		if (current()) error.value = cause instanceof Error ? cause.message : '日程操作失败';
	} finally {
		if (current()) busy.value = false;
	}
}
function selectDate(value: ReturnType<typeof dayjs>) {
	if (busy.value || !current()) return;
	date.value = value;
	void load();
}
onMounted(() => void load());
onScopeDispose(() => {
	active = false;
	sessionBoundary.release(controller);
	controller.abort();
});
</script>

<template>
	<div class="schedule">
		<div class="schedule-toolbar">
			<Button type="primary" :disabled="loading || busy || !!error" @click="edit()">添加日程</Button>
			<Button :loading="loading" :disabled="busy" @click="load">刷新日程</Button>
			<Button :disabled="busy" @click="selectDate(date.subtract(1, 'month'))">上个月</Button>
			<Button :disabled="busy" @click="selectDate(dayjs())">今天</Button>
			<Button :disabled="busy" @click="selectDate(date.add(1, 'month'))">下个月</Button>
		</div>
		<Alert v-if="error" type="error" :title="error" show-icon />
		<Calendar :value="date" :fullscreen="false" @select="selectDate">
			<template #cellRender="{ date: cellDate, info }">
				<span v-if="info.type === 'date'" class="schedule-lunar" :aria-label="scheduleLunarLabel(cellDate.format('YYYY-MM-DD'))"
					><span v-for="(part, index) in scheduleLunarLabel(cellDate.format('YYYY-MM-DD')).split('月')" :key="index">{{ part }}{{ index === 0 ? '月' : '' }}</span></span
				>
				<span v-if="info.type === 'date' && counts[cellDate.format('YYYY-MM-DD')]" class="schedule-dot" :aria-label="`${counts[cellDate.format('YYYY-MM-DD')]} 条日程`">•</span>
			</template>
		</Calendar>
		<h3>
			{{ date.format('YYYY-MM-DD') }} 的日程 <small>农历 {{ lunarFormatter.format(date.toDate()) }}</small>
		</h3>
		<p v-if="loading" role="status">正在加载日程……</p>
		<p v-else-if="!error && selected.length === 0">当天暂无日程</p>
		<ul v-else class="schedule-list">
			<li v-for="item in selected" :key="item.id" :data-schedule-id="item.id">
				<div>
					<Tag :color="item.status === 1 ? 'green' : 'blue'">{{ item.status === 1 ? '已完成' : '未完成' }}</Tag
					>{{ item.startTime }} — {{ item.endTime }}
				</div>
				<p class="schedule-content">{{ item.content }}</p>
				<div class="schedule-toolbar">
					<Button size="small" :disabled="busy || item.status === 1" @click="edit(item)">编辑日程</Button>
					<Button size="small" :disabled="busy" @click="mutate(item)">{{ item.status === 1 ? '恢复未完成' : '标记完成' }}</Button>
					<Button size="small" danger :disabled="busy" @click="deleting = item">删除日程</Button>
				</div>
			</li>
		</ul>
		<Modal
			:open="open"
			:title="draft.id ? '编辑日程' : '添加日程'"
			:confirm-loading="busy"
			:closable="!busy"
			:keyboard="!busy"
			:mask-closable="false"
			:cancel-button-props="{ disabled: busy }"
			ok-text="保存日程"
			@ok="save"
			@cancel="open = false"
		>
			<Alert v-if="formError" type="error" :title="formError" show-icon />
			<Form :model="draft" layout="vertical" :disabled="busy">
				<FormItem label="日程日期" required><Input v-model:value="draft.scheduleTime" type="date" aria-label="日程日期" /></FormItem>
				<div class="schedule-times">
					<FormItem label="开始时间" required
						><Select class="schedule-time-select" :value="draft.startTime" :options="scheduleTimeOptions" allow-clear aria-label="开始时间" @change="changeStartTime"
					/></FormItem>
					<FormItem label="结束时间" required
						><Select
							class="schedule-time-select"
							:value="draft.endTime"
							:options="endTimeOptions"
							allow-clear
							aria-label="结束时间"
							@change="(value) => (draft.endTime = typeof value === 'string' ? value : '')"
					/></FormItem>
				</div>
				<FormItem label="日程内容" required><Input.TextArea v-model:value="draft.content" aria-label="日程内容" :maxlength="256" :rows="4" show-count /></FormItem>
			</Form>
			<Button v-if="draft.id" danger :disabled="busy" @click="deleting = { ...draft }">删除日程</Button>
		</Modal>
		<Modal
			:open="!!deleting"
			title="确认删除日程"
			ok-text="删除"
			:confirm-loading="busy"
			:closable="!busy"
			:mask-closable="false"
			:keyboard="!busy"
			:cancel-button-props="{ disabled: busy }"
			@ok="deleting && mutate(deleting, true)"
			@cancel="deleting = undefined"
		>
			<p>{{ deleting?.content }}</p>
			<Alert v-if="error" type="error" :title="error" />
		</Modal>
	</div>
</template>

<style scoped>
.schedule-toolbar {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-bottom: 12px;
}
.schedule-times {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 16px;
}
.schedule-time-select {
	width: 100%;
}
.schedule-list {
	list-style: none;
	padding: 0;
}
.schedule-list li {
	padding: 12px 0;
	border-bottom: 1px solid hsl(var(--border));
}
.schedule-content {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	margin: 10px 0;
}
.schedule-lunar {
	display: flex;
	flex-direction: column;
	align-items: center;
	font-size: 10px;
	line-height: 1.1;
	color: hsl(var(--muted-foreground));
}
.schedule-dot {
	color: hsl(var(--primary));
	font-size: 16px;
	line-height: 8px;
	display: block;
}
</style>
