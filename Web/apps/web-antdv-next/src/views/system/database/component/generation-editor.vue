<script setup lang="ts">
import type { CreateEntityInput, CreateSeedDataInput } from '#/api-services/models';
import type { DatabaseCodePreview, DatabaseTarget } from '#/api/system/database';

import { computed, onDeactivated, onScopeDispose, reactive, ref, watch } from 'vue';

import { Alert, Button, Form, FormItem, Input, message, Modal, Select, Switch, theme } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { databaseGeneration } from '#/api/system/database';
import { useActionCooldown } from '#/components/admin/action-cooldown';

const props = defineProps<{ open: boolean; kind: 'entity' | 'seed'; target: DatabaseTarget; connectionTitle: string }>();
const emit = defineEmits<{ 'update:open': [open: boolean] }>();
const title = computed(() => (props.kind === 'entity' ? '生成实体' : '生成种子数据'));
const input = reactive<CreateEntityInput & CreateSeedDataInput>({});
const preview = ref<DatabaseCodePreview>();
const error = ref('');
const busy = ref(false);
const confirm = ref(false);
const { token } = theme.useToken();
const generationZIndex = computed(() => token.value.zIndexPopupBase);
const cooldown = useActionCooldown<'entity' | 'seed'>(3000);
const namespaces = ref<string[]>([]);
const baseClasses = ref<string[]>([]);
const optionsLoading = ref(false);
let generation = 0;
let operation: AbortController | undefined;
let optionsOperation: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);
function reset() {
	generation += 1;
	operation?.abort();
	preview.value = undefined;
	error.value = '';
	busy.value = false;
	confirm.value = false;
	Object.assign(input, {
		...props.target,
		entityName: props.target.tableName.replace(/(?:^|_)([a-z])/g, (_match, letter: string) => letter.toUpperCase()),
		baseClassName: '',
		position: 'Admin.NET.Application',
		suffix: '',
		seedDataName: '',
		filterExistingData: false,
		expectedHash: undefined,
	});
	void loadOptions();
}
async function loadOptions() {
	const current = generation;
	optionsOperation?.abort();
	optionsOperation = new AbortController();
	optionsLoading.value = true;
	try {
		const options = await databaseGeneration.options(optionsOperation.signal);
		if (current === generation && props.open) {
			namespaces.value = options.namespaces ?? [];
			baseClasses.value = options.baseClasses ?? [];
			input.position = namespaces.value[0] ?? 'Admin.NET.Application';
		}
	} catch (cause) {
		if (current === generation && props.open) error.value = cause instanceof Error ? cause.message : '生成选项加载失败';
	} finally {
		if (current === generation) optionsLoading.value = false;
	}
}
function close() {
	generation += 1;
	operation?.abort();
	optionsOperation?.abort();
	busy.value = false;
	confirm.value = false;
	emit('update:open', false);
}
function clearPreview() {
	preview.value = undefined;
	input.expectedHash = undefined;
	confirm.value = false;
}
watch(
	() => [props.open, props.kind, props.target.configId, props.target.tableName],
	() => {
		if (props.open) reset();
		else {
			operation?.abort();
			generation += 1;
			busy.value = false;
		}
	},
	{ immediate: true }
);
watch(() => [input.entityName, input.baseClassName, input.position, input.suffix, input.seedDataName, input.filterExistingData], clearPreview);
async function run(write: boolean) {
	if (busy.value || optionsLoading.value || !props.open || (write && cooldown.active.value.includes(props.kind))) return;
	const current = generation;
	const session = sessionBoundary.version;
	operation = new AbortController();
	const signal = operation.signal;
	const valid = () => current === generation && session === sessionBoundary.version && !signal.aborted;
	busy.value = true;
	error.value = '';
	try {
		const value = {
			...input,
			...props.target,
			expectedHash: write ? preview.value?.hash : undefined,
			overwriteExisting: write && preview.value?.fileExists,
			expectedTargetHash: write ? preview.value?.targetHash : undefined,
		};
		if (write) {
			if (!preview.value) throw new Error('请先预览生成结果');
			if (!cooldown.begin(props.kind)) return;
			if (props.kind === 'entity') await databaseGeneration.createEntity(value, signal);
			else await databaseGeneration.createSeed(value, signal);
			if (valid()) {
				confirm.value = false;
				message.success('代码已生成');
				close();
			}
		} else {
			const result = props.kind === 'entity' ? await databaseGeneration.previewEntity(value, signal) : await databaseGeneration.previewSeed(value, signal);
			if (valid()) preview.value = result;
		}
	} catch (cause) {
		if (valid()) error.value = cause instanceof Error ? cause.message : '生成失败';
	} finally {
		if (valid()) busy.value = false;
	}
}
const endSession = () => {
	cooldown.clear();
	close();
};
onDeactivated(cooldown.clear);
lifetime.signal.addEventListener('abort', endSession);
onScopeDispose(() => {
	lifetime.signal.removeEventListener('abort', endSession);
	operation?.abort();
	optionsOperation?.abort();
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<Modal
		:open="open"
		:z-index="generationZIndex"
		:title="title"
		:width="960"
		:footer="null"
		:closable="!busy || !confirm"
		:keyboard="!busy || !confirm"
		destroy-on-hidden
		:mask-closable="false"
		@cancel="close"
	>
		<div class="generation-editor">
			<p>{{ connectionTitle }} / {{ target.tableName }}</p>
			<Form :name="`database-generation-${kind}`" :model="input" layout="vertical">
				<div class="generation-fields">
					<FormItem v-if="kind === 'entity'" label="实体名称" name="entityName"><Input v-model:value="input.entityName" :disabled="busy" /></FormItem>
					<FormItem label="存放位置" name="position"><Select v-model:value="input.position" :disabled="busy" :options="namespaces.map((value) => ({ value, label: value }))" /></FormItem>
					<FormItem v-if="kind === 'entity'" label="基类" name="baseClassName"
						><Select v-model:value="input.baseClassName" :disabled="busy" allow-clear :options="baseClasses.map((value) => ({ value, label: value }))"
					/></FormItem>
					<FormItem v-else label="后缀" name="suffix"><Input v-model:value="input.suffix" :disabled="busy" /></FormItem>
				</div>
				<FormItem v-if="kind === 'seed'" label="过滤已有数据" name="filterExistingData"><Switch v-model:checked="input.filterExistingData" :disabled="busy" /></FormItem>
			</Form>
			<Alert v-if="error" type="error" :title="error" show-icon />
			<template v-if="preview">
				<p class="generation-path">{{ preview.relativePath }}</p>
				<Alert v-if="preview.fileExists" type="warning" title="目标文件已存在，确认生成将覆盖此文件" show-icon />
				<pre class="code-preview" aria-label="生成代码预览">{{ preview.content }}</pre>
			</template>
			<div class="generation-actions">
				<Button :disabled="busy && confirm" @click="close">取消</Button><Button :disabled="optionsLoading || busy" :loading="busy && !confirm" @click="run(false)">预览代码</Button
				><Button type="primary" :disabled="!preview || busy" @click="confirm = true">生成文件</Button>
			</div>
		</div>
	</Modal>
	<Modal
		:z-index="generationZIndex + 1"
		:open="confirm"
		title="确认生成文件"
		ok-text="确认生成"
		:closable="!busy"
		:keyboard="!busy"
		:cancel-button-props="{ disabled: busy }"
		:ok-button-props="{ loading: busy, disabled: cooldown.active.value.includes(kind) }"
		:mask-closable="false"
		@ok="run(true)"
		@cancel="confirm = false"
		><p>{{ connectionTitle }} / {{ target.tableName }}</p>
		<p>{{ preview?.relativePath }}</p>
		<Alert v-if="preview?.fileExists" type="warning" title="确认后覆盖此文件" show-icon /><Alert v-if="error" type="error" :title="error" show-icon
	/></Modal>
</template>

<style scoped>
.generation-editor {
	max-height: 72vh;
	overflow: auto;
}
.generation-fields {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 0 16px;
}
.generation-path {
	margin: 12px 0;
	overflow-wrap: anywhere;
	color: hsl(var(--muted-foreground));
}
.code-preview {
	max-height: 360px;
	margin-top: 12px;
	overflow: auto;
	padding: 16px;
	background: hsl(var(--muted));
	font-size: 12px;
	line-height: 1.6;
	border: 1px solid hsl(var(--border));
	border-radius: 8px;
}
.generation-actions {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 16px;
}
</style>
