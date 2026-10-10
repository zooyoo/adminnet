<script setup lang="ts">
import type { StressTestIssue, StressTestState } from './stress-test';

import type { StressTestPair } from '#/api/system/stress-test';

import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, ref, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Card, Empty, Form, FormItem, Input, InputNumber, Select, Tabs, Tag } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { getStressTestTargets, runStressTest } from '#/api/system/stress-test';

import { createStressTestForm, parameterGroups, StressTestSession, validateStressTest } from './stress-test';

const userStore = useUserStore();
const { hasAccessByCodes } = useAccess();
const allowed = computed(() => userStore.userInfo?.accountType === 999 && hasAccessByCodes(['sysCommon:stressTest']));
const identity = computed(() => [userStore.userInfo?.userId, userStore.userInfo?.tenantId, userStore.userInfo?.currentTenantId, userStore.userInfo?.accountType].join(':'));
const form = reactive(createStressTestForm());
const state = shallowRef<StressTestState>({ targetStatus: 'idle', targetError: '', status: 'idle', error: '' });
const targetUri = ref('');
const attempted = ref(false);
const activeParameter = ref<string>('headers');
const executedUri = ref('');
const session = new StressTestSession({
	boundary: sessionBoundary,
	allowed: () => allowed.value,
	fetchTargets: getStressTestTargets,
	run: runStressTest,
	onChange: (value) => {
		state.value = value;
	},
	onClear: () => {
		Object.assign(form, createStressTestForm());
		targetUri.value = '';
		attempted.value = false;
		executedUri.value = '';
	},
});
const running = computed(() => state.value.status === 'running');
const blocked = computed(() => !allowed.value || running.value || state.value.targetStatus !== 'ready');
const targetOptions = computed(() => state.value.policy?.targets.map((target) => ({ label: target.name, value: target.requestUri })) ?? []);
const selectedTarget = computed(() => state.value.policy?.targets.find((target) => target.requestUri === targetUri.value));
const validation = computed(() => validateStressTest(form, state.value.policy, targetUri.value));
const issues = computed(() => (attempted.value ? validation.value.issues : []));
const totalRequests = computed(() => (form.numberOfRequests ?? 0) * (form.numberOfRounds ?? 0));
const group = computed(() => parameterGroups.find((item) => item.key === activeParameter.value) ?? parameterGroups[0]);
const parameterTabs = parameterGroups.map((item) => ({ key: item.key, label: item.label }));
const allFailed = computed(() => !!state.value.result && state.value.result.successfulRequests === 0 && (state.value.result.failedRequests ?? 0) > 0);
const someFailed = computed(() => (state.value.result?.failedRequests ?? 0) > 0);
const counts = [
	{ key: 'totalRequests', label: '总请求数', unit: '次' },
	{ key: 'successfulRequests', label: '成功请求', unit: '次' },
	{ key: 'failedRequests', label: '失败请求', unit: '次' },
	{ key: 'queriesPerSecond', label: 'QPS', unit: '次/秒' },
] as const;
const times = [
	{ key: 'totalTimeInSeconds', label: '总耗时', unit: '秒' },
	{ key: 'minResponseTime', label: '最短响应', unit: '毫秒' },
	{ key: 'averageResponseTime', label: '平均响应', unit: '毫秒' },
	{ key: 'maxResponseTime', label: '最长响应', unit: '毫秒' },
] as const;
const percentiles = [
	{ key: 'percentile10ResponseTime', label: 'P10' },
	{ key: 'percentile25ResponseTime', label: 'P25' },
	{ key: 'percentile50ResponseTime', label: 'P50' },
	{ key: 'percentile75ResponseTime', label: 'P75' },
	{ key: 'percentile90ResponseTime', label: 'P90' },
	{ key: 'percentile99ResponseTime', label: 'P99' },
	{ key: 'percentile999ResponseTime', label: 'P99.9' },
] as const;

function fieldError(field: StressTestIssue['field']) {
	return (
		issues.value
			.filter((issue) => issue.field === field)
			.map((issue) => issue.message)
			.join('；') || undefined
	);
}
function rowInvalid(row: number) {
	return issues.value.some((issue) => issue.field === group.value.key && issue.row === row);
}
function addParameter() {
	if (!blocked.value) form[group.value.key].push({ key: '', value: '' });
}
function removeParameter(row: number) {
	if (!blocked.value) form[group.value.key].splice(row, 1);
}
function selectTarget(value: number | string | undefined) {
	if (blocked.value) return;
	targetUri.value = typeof value === 'string' ? value : '';
	form.requestUri = selectedTarget.value?.requestUri ?? '';
}
function execute() {
	if (blocked.value) return;
	attempted.value = true;
	const request = validation.value.request;
	if (!request) return;
	executedUri.value = validation.value.previewUri;
	void session.execute(request);
}
function formatNumber(value: number | undefined) {
	return value === undefined || !Number.isFinite(value) ? '—' : new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 3 }).format(value);
}
function updateParameter(pair: StressTestPair, field: 'key' | 'value', value: string) {
	if (!blocked.value) pair[field] = value;
}

watch(
	() => state.value.policy,
	(policy) => {
		if (!policy?.targets.length) {
			targetUri.value = '';
			return;
		}
		if (!policy.targets.some((target) => target.requestUri === targetUri.value)) {
			targetUri.value = policy.targets[0]!.requestUri;
			form.requestUri = targetUri.value;
		}
	}
);
watch(identity, () => session.invalidateIdentity());
watch(allowed, (value) => {
	if (!value) session.deactivate();
});
onMounted(() => {
	void session.activate();
});
onActivated(() => {
	void session.activate();
});
onDeactivated(() => session.deactivate());
onScopeDispose(() => session.dispose());
</script>

<template>
	<Page title="受控接口压测" description="仅超级管理员可对服务端授权的目标执行压测。所有限制由服务端最终检查。" class="stress-page" content-class="space-y-4">
		<Alert v-if="!allowed" title="当前账号不可执行压测" description="需要超级管理员身份和 sysCommon:stressTest 权限。" type="warning" show-icon />
		<template v-else>
			<Card title="请求配置" :aria-busy="running" class="stress-config">
				<template #extra>
					<Tag v-if="running" color="processing">执行中</Tag>
					<Tag v-else-if="state.targetStatus === 'ready'" color="blue">已加载授权目标</Tag>
					<Tag v-else>不可执行</Tag>
				</template>
				<Alert v-if="state.targetStatus === 'unavailable'" :title="state.targetError || '授权目标不可用，当前不可执行'" type="warning" show-icon class="mb-4" />
				<div v-if="state.targetStatus === 'loading'" role="status" class="mb-4 text-muted-foreground">正在读取授权目标和执行限制…</div>
				<Form name="stress-test" :model="form" :colon="false" layout="vertical" @finish="execute">
					<div class="grid grid-cols-1 gap-x-5 xl:grid-cols-3">
						<FormItem label="压测目标" name="target" :help="fieldError('target')" :validate-status="fieldError('target') ? 'error' : undefined" required>
							<Select :value="targetUri || undefined" :options="targetOptions" placeholder="请选择服务端授权目标" aria-label="压测目标" :disabled="blocked" @change="selectTarget" />
						</FormItem>
						<FormItem
							label="请求地址"
							name="requestUri"
							:help="fieldError('requestUri')"
							:validate-status="fieldError('requestUri') ? 'error' : undefined"
							required
							class="xl:col-span-2"
						>
							<Input v-model:value="form.requestUri" aria-label="请求地址" :disabled="blocked" placeholder="先选择授权目标，再编辑前缀内路径，例如 /path/{key}" autocomplete="off" />
						</FormItem>
					</div>
					<div v-if="selectedTarget" class="mb-5 rounded-lg border border-border bg-muted/40 px-4 py-3 text-sm">
						<p class="font-medium">当前允许目标：{{ selectedTarget.name }}</p>
						<p class="mt-1 break-all font-mono text-muted-foreground">{{ selectedTarget.requestUri }}</p>
						<p class="mt-2 text-muted-foreground">请求地址和 Path 参数替换后的地址都必须位于该 URI 前缀内。服务端会再次检查目标地址及重定向。</p>
					</div>
					<div class="grid grid-cols-2 gap-x-5 xl:grid-cols-4">
						<FormItem label="请求方式" name="requestMethod" :help="fieldError('requestMethod')" :validate-status="fieldError('requestMethod') ? 'error' : undefined">
							<Select
								v-model:value="form.requestMethod"
								:options="['GET', 'POST', 'PUT', 'DELETE'].map((value) => ({ label: value, value }))"
								aria-label="请求方式"
								:disabled="blocked"
							/>
						</FormItem>
						<FormItem
							label="每轮请求量"
							name="numberOfRequests"
							:help="fieldError('numberOfRequests')"
							:validate-status="fieldError('numberOfRequests') ? 'error' : undefined"
							required
						>
							<InputNumber v-model:value="form.numberOfRequests" :min="1" :max="state.policy?.maxRequestsPerRound" aria-label="每轮请求量" :disabled="blocked" class="w-full" />
						</FormItem>
						<FormItem label="压测轮数" name="numberOfRounds" :help="fieldError('numberOfRounds')" :validate-status="fieldError('numberOfRounds') ? 'error' : undefined" required>
							<InputNumber v-model:value="form.numberOfRounds" :min="1" :max="state.policy?.maxRounds" aria-label="压测轮数" :disabled="blocked" class="w-full" />
						</FormItem>
						<FormItem
							label="最大并行量"
							name="maxDegreeOfParallelism"
							:help="fieldError('maxDegreeOfParallelism')"
							:validate-status="fieldError('maxDegreeOfParallelism') ? 'error' : undefined"
							extra="0 使用服务器默认并行量"
							required
						>
							<InputNumber
								v-model:value="form.maxDegreeOfParallelism"
								:min="0"
								:max="state.policy?.maxConcurrency"
								aria-label="最大并行量"
								name="maxDegreeOfParallelism"
								:disabled="blocked"
								class="w-full"
							/>
						</FormItem>
					</div>
					<div v-if="state.policy" class="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
						<span
							>预计请求 <strong class="font-semibold tabular-nums text-foreground">{{ formatNumber(totalRequests) }}</strong> 次</span
						>
						<span>总量上限 {{ formatNumber(state.policy.maxTotalRequests) }} 次</span>
						<span>每轮 ≤ {{ state.policy.maxRequestsPerRound }}，轮数 ≤ {{ state.policy.maxRounds }}，并行 ≤ {{ state.policy.maxConcurrency }}</span>
						<span>单请求超时 {{ state.policy.requestTimeoutSeconds }} 秒</span>
					</div>
					<Tabs v-model:active-key="activeParameter" :items="parameterTabs" aria-label="请求参数分组" />
					<section :aria-label="`${group.label} 参数编辑`" class="mb-5">
						<div class="mb-3 flex items-center justify-between gap-4">
							<p class="text-sm text-muted-foreground">{{ group.description }}</p>
							<Button :aria-label="`添加 ${group.label} 参数`" :disabled="blocked" @click="addParameter">添加参数</Button>
						</div>
						<div v-if="!form[group.key].length" class="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">暂无 {{ group.label }} 参数。需要时点击“添加参数”。</div>
						<div v-for="(pair, row) in form[group.key]" :key="row" class="mb-3 grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_auto] gap-3">
							<Input
								:value="pair.key"
								:aria-label="`${group.label} 参数名 ${row + 1}`"
								:aria-invalid="rowInvalid(row)"
								:status="rowInvalid(row) ? 'error' : undefined"
								:disabled="blocked"
								placeholder="参数名"
								autocomplete="off"
								@update:value="updateParameter(pair, 'key', $event)"
							/>
							<Input
								:value="pair.value"
								:aria-label="`${group.label} 参数值 ${row + 1}`"
								:disabled="blocked"
								placeholder="参数值（可留空）"
								autocomplete="off"
								@update:value="updateParameter(pair, 'value', $event)"
							/>
							<Button :aria-label="`删除 ${group.label} 参数 ${row + 1}`" :disabled="blocked" danger @click="removeParameter(row)">删除</Button>
						</div>
						<p v-if="fieldError(group.key)" role="alert" class="mt-2 text-sm text-destructive">{{ fieldError(group.key) }}</p>
						<p v-if="issues.some((issue) => parameterGroups.some((item) => item.key === issue.field) && issue.field !== group.key)" role="alert" class="mt-2 text-sm text-destructive">
							其他参数分组存在错误，请切换标签检查。
						</p>
					</section>
					<div class="flex items-center justify-between gap-4 border-t border-border pt-5">
						<Button aria-label="刷新压测目标" :loading="state.targetStatus === 'loading'" :disabled="running" @click="session.refreshTargets()">刷新授权目标</Button>
						<div class="flex items-center gap-3">
							<Button aria-label="取消压测" :disabled="!running" @click="session.cancel()">取消压测</Button>
							<Button type="primary" html-type="submit" aria-label="开始压测" :loading="running" :disabled="blocked">开始压测</Button>
						</div>
					</div>
				</Form>
			</Card>
			<Card title="执行结果" aria-label="执行结果" aria-live="polite" :aria-busy="running">
				<Alert v-if="state.status === 'running'" title="压测正在执行" description="请等待服务端统计；当前请求配置已锁定，可点击“取消压测”。" type="info" show-icon />
				<Alert v-else-if="state.status === 'cancelled'" title="压测请求已取消" description="已中止当前等待并清除结果；服务端是否已停止以连接取消信号为准。" type="info" show-icon />
				<Alert v-else-if="state.status === 'error'" title="压测请求失败" :description="state.error" type="error" show-icon />
				<template v-else-if="state.status === 'completed' && state.result">
					<Alert
						:title="allFailed ? '压测已完成，所有请求均失败' : someFailed ? '压测已完成，存在失败请求' : '压测已完成'"
						:type="someFailed ? 'warning' : 'success'"
						description="HTTP 非 2xx 响应和超时计为失败；完成状态表示统计结束。"
						show-icon
						class="mb-5"
					/>
					<p class="mb-4 break-all text-sm text-muted-foreground">本次请求地址：{{ executedUri }}</p>
					<dl class="mb-5 grid grid-cols-4 gap-4">
						<div v-for="item in counts" :key="item.key" class="rounded-lg border border-border bg-muted/20 p-4">
							<dt class="text-sm text-muted-foreground">{{ item.label }}</dt>
							<dd class="mt-2 text-2xl font-semibold tabular-nums">
								{{ formatNumber(state.result[item.key]) }} <span class="text-xs font-normal text-muted-foreground">{{ item.unit }}</span>
							</dd>
						</div>
					</dl>
					<dl class="mb-5 grid grid-cols-4 gap-4">
						<div v-for="item in times" :key="item.key" class="rounded-lg bg-muted/40 p-4">
							<dt class="text-sm text-muted-foreground">{{ item.label }}</dt>
							<dd class="mt-2 font-medium tabular-nums">
								{{ formatNumber(state.result[item.key]) }} <span class="text-xs font-normal text-muted-foreground">{{ item.unit }}</span>
							</dd>
						</div>
					</dl>
					<p class="mb-3 text-sm font-medium">响应时间分位数 <span class="font-normal text-muted-foreground">（毫秒，仅统计成功请求）</span></p>
					<dl class="grid grid-cols-7 gap-3">
						<div v-for="item in percentiles" :key="item.key" class="rounded-lg border border-border px-3 py-4">
							<dt class="text-xs text-muted-foreground">{{ item.label }}</dt>
							<dd class="mt-2 font-medium tabular-nums">{{ formatNumber(state.result[item.key]) }}</dd>
						</div>
					</dl>
				</template>
				<Empty v-else :image="Empty.PRESENTED_IMAGE_SIMPLE" description="尚未执行压测。请先选择授权目标并配置请求。" />
			</Card>
		</template>
	</Page>
</template>
