<script setup lang="ts">
import type { NuGetPackage, SystemRuntimeInfo } from '#/api-services/models';
import type { ServerHardware } from '#/api/system/server';

import { computed, h, onActivated, onDeactivated, onMounted, onScopeDispose, ref, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, Card, Empty, Progress, Spin, Switch, Tag } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { serverHardware, serverPackages, serverRuntime } from '#/api/system/server';

const { hasAccessByCodes } = useAccess();
const allowed = computed(() => hasAccessByCodes(['sysServer:page']));
const hardware = shallowRef<ServerHardware>();
const runtime = shallowRef<SystemRuntimeInfo>();
const packages = shallowRef<NuGetPackage[]>([]);
const errors = ref<string[]>([]);
const loading = ref(false);
const autoRefresh = ref(true);
const sampledAt = ref('');
const refreshIcon = h(createIconifyIcon('lucide:refresh-cw'));
let active = false;
let visible = false;
let generation = 0;
let request: AbortController | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);

function text(value: unknown) {
	return value === null || value === undefined || value === '' ? '未提供' : String(value);
}
function bytes(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? (value >= 1024 ** 3 ? (value / 1024 ** 3).toFixed(2) + ' GB' : (value / 1024 ** 2).toFixed(2) + ' MB') : '未提供';
}
function percent(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : undefined;
}
const cpu = computed(() => percent(hardware.value?.cpuInfo?.usagePercentage));
const gpuNames = computed(() =>
	hardware.value?.gpuInfos
		?.map((gpu) => (gpu.name === 'Error' ? 'GPU 采集失败' : gpu.name))
		.filter(Boolean)
		.join('、')
);
const ram = computed(() => (hardware.value?.ramInfo?.totalBytes ? percent(hardware.value.ramInfo.usagePercentage) : undefined));
const runtimeRows = computed(() => {
	const info = runtime.value?.runtimeInfo;
	return [
		['主机名称', info?.machineName],
		['操作系统', info?.osDescription],
		['系统架构', info?.osArchitecture],
		['进程架构', info?.processArchitecture],
		['运行框架', info?.frameworkDescription],
		['数据库', info?.databaseType],
		['进程 ID', info?.processId],
		['CPU 逻辑核心', info?.processorCount],
		['进程启动时间', info?.processStartTime],
		['进程运行时长', info?.processUptime],
		['系统运行时长', info?.systemUptime],
		['工作目录', info?.currentDirectory],
		['进程工作集', bytes(info?.workingSet)],
		['运行时版本', info?.runtimeVersion],
	];
});
function stop() {
	active = false;
	generation += 1;
	clearTimeout(timer);
	request?.abort();
	loading.value = false;
}
function schedule() {
	clearTimeout(timer);
	if (active && autoRefresh.value && allowed.value && !lifetime.signal.aborted) timer = setTimeout(() => void refresh(false), 10000);
}
async function refresh(includePackages = true) {
	if (!active || !allowed.value || lifetime.signal.aborted || loading.value) return;
	clearTimeout(timer);
	request?.abort();
	request = new AbortController();
	const version = sessionBoundary.version;
	const current = ++generation;
	const valid = () => active && current === generation && version === sessionBoundary.version && !lifetime.signal.aborted;
	const signal = AbortSignal.any([request.signal, lifetime.signal]);
	loading.value = true;
	const operations = [serverRuntime(signal), serverHardware(signal), ...(includePackages ? [serverPackages(signal)] : [])];
	try {
		const results = await Promise.allSettled(operations);
		if (!valid()) return;
		errors.value = [];
		results.forEach((result, index) => {
			if (result.status === 'rejected') {
				errors.value.push(['运行时信息', '硬件信息', '程序集信息'][index] + '：' + (result.reason instanceof Error ? result.reason.message : '加载失败'));
				return;
			}
			if (index === 0) runtime.value = result.value as SystemRuntimeInfo;
			else if (index === 1) hardware.value = result.value as ServerHardware;
			else packages.value = result.value as NuGetPackage[];
		});
		if (results.some((result) => result.status === 'fulfilled')) sampledAt.value = new Date().toLocaleTimeString('zh-CN');
	} finally {
		if (valid()) {
			loading.value = false;
			schedule();
		}
	}
}
function start() {
	if (active || lifetime.signal.aborted) return;
	active = true;
	void refresh(true);
}
function activate() {
	visible = true;
	start();
}
function deactivate() {
	visible = false;
	stop();
}
function clearIdentity() {
	stop();
	hardware.value = undefined;
	runtime.value = undefined;
	packages.value = [];
	errors.value = [];
	sampledAt.value = '';
}
lifetime.signal.addEventListener('abort', clearIdentity);
watch(autoRefresh, schedule);
watch(allowed, (value) => {
	if (!value) clearIdentity();
	else if (visible) start();
});
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onScopeDispose(() => {
	deactivate();
	lifetime.signal.removeEventListener('abort', clearIdentity);
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<main class="server-page">
		<header class="server-header">
			<div>
				<h1>服务器与运行时监控</h1>
				<p>最近刷新：{{ sampledAt || '尚未刷新' }} · 自动刷新间隔 10 秒</p>
			</div>
			<div class="server-actions">
				<label><Switch v-model:checked="autoRefresh" aria-label="自动刷新监控" :disabled="!allowed" /> 自动刷新</label
				><Button :icon="refreshIcon" :loading="loading" :disabled="!allowed" @click="refresh(true)">刷新监控</Button>
			</div>
		</header>
		<Alert v-if="!allowed" type="warning" title="无服务器监控权限" show-icon />
		<template v-else>
			<Alert v-for="error in errors" :key="error" type="error" :title="error" description="保留最近一次成功读取的数据，请恢复服务后刷新。" show-icon class="server-error" />
			<Spin :spinning="loading" :delay="200">
				<div class="server-grid">
					<Card title="系统与运行时"
						><dl class="runtime-list">
							<template v-for="[label, value] in runtimeRows" :key="String(label)"
								><dt>{{ label }}</dt>
								<dd>{{ text(value) }}</dd></template
							>
						</dl></Card
					>
					<Card title="CPU 与内存"
						><div class="usage-grid">
							<section aria-label="CPU 使用率">
								<h2>CPU 使用率</h2>
								<Progress v-if="cpu !== undefined" type="dashboard" :percent="cpu" :format="(value) => `${value?.toFixed(1)}%`" :size="160" /><Empty
									v-else
									description="CPU 使用率未提供"
									:image="Empty.PRESENTED_IMAGE_SIMPLE"
								/>
								<p>{{ text(hardware?.cpuInfo?.processorName) }}</p>
								<p>{{ text(hardware?.cpuInfo?.physicalCoreCount) }} 核心 / {{ text(hardware?.cpuInfo?.logicalCoreCount) }} 线程</p>
							</section>
							<section aria-label="内存使用率">
								<h2>内存使用率</h2>
								<Progress v-if="ram !== undefined" type="dashboard" :percent="ram" :format="(value) => `${value?.toFixed(1)}%`" :size="160" /><Empty
									v-else
									description="内存使用率未提供"
									:image="Empty.PRESENTED_IMAGE_SIMPLE"
								/>
								<p>已用 {{ bytes(hardware?.ramInfo?.usedBytes) }} / 总计 {{ bytes(hardware?.ramInfo?.totalBytes) }}</p>
								<p>可用 {{ bytes(hardware?.ramInfo?.availableBytes) }}</p>
							</section>
						</div></Card
					>
				</div>
				<Card title="磁盘信息" class="server-section"
					><div v-if="hardware?.diskInfos?.length" class="disk-grid">
						<section v-for="disk in hardware.diskInfos" :key="disk.diskName || ''" class="disk-item">
							<h2>{{ text(disk.diskName) }}</h2>
							<Progress v-if="disk.totalSpace && percent(disk.availableRate) !== undefined" type="circle" :percent="disk.availableRate" :format="(value) => `${value?.toFixed(1)}%`" :size="120" />
							<p>可用空间占比</p>
							<p>已用 {{ bytes(disk.usedSpace) }}</p>
							<p>可用 {{ bytes(disk.freeSpace) }} / 总计 {{ bytes(disk.totalSpace) }}</p>
							<Tag>{{ text(disk.typeName) }}</Tag>
						</section>
					</div>
					<Empty v-else description="未提供磁盘信息" :image="Empty.PRESENTED_IMAGE_SIMPLE"
				/></Card>
				<Card title="硬件与网络" class="server-section"
					><dl class="runtime-list">
						<dt>主板</dt>
						<dd>{{ text(hardware?.boardInfo?.manufacturer) }} / {{ text(hardware?.boardInfo?.product) }}</dd>
						<dt>GPU</dt>
						<dd>
							{{ gpuNames || '未提供' }}
						</dd>
						<dt>网络接口</dt>
						<dd>
							{{
								hardware?.networkInfos
									?.map((network) => network.name)
									.filter(Boolean)
									.join('、') || '未提供'
							}}
						</dd>
					</dl></Card
				>
				<Card title="程序集信息" class="server-section"
					><div v-if="packages.length" class="package-list">
						<Tag v-for="item in packages" :key="item.packageName || ''"
							><span
								>{{ item.packageName }} <span>{{ text(item.packageVersion) }}</span></span
							></Tag
						>
					</div>
					<Empty v-else description="未提供程序集信息" :image="Empty.PRESENTED_IMAGE_SIMPLE"
				/></Card>
			</Spin>
		</template>
	</main>
</template>

<style scoped>
.server-page {
	padding: 20px;
}
.server-header {
	display: flex;
	justify-content: space-between;
	align-items: flex-start;
	gap: 20px;
	margin-bottom: 20px;
}
h1 {
	margin: 0;
	font-size: 22px;
}
h2 {
	font-size: 15px;
	margin: 0 0 16px;
}
p {
	color: hsl(var(--muted-foreground));
	margin: 8px 0;
}
.server-actions,
.server-actions label {
	display: flex;
	align-items: center;
	gap: 12px;
}
.server-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 18px;
}
.server-section {
	margin-top: 18px;
}
.server-error {
	margin-bottom: 16px;
}
.runtime-list {
	display: grid;
	grid-template-columns: 130px minmax(0, 1fr);
	margin: 0;
	gap: 12px 16px;
	line-height: 1.5;
}
dt {
	color: hsl(var(--muted-foreground));
}
dd {
	margin: 0;
	overflow-wrap: anywhere;
}
.usage-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 20px;
	text-align: center;
}
.usage-grid section {
	min-width: 0;
}
.disk-grid {
	display: grid;
	grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
	gap: 18px;
}
.disk-item {
	text-align: center;
}
.package-list {
	display: flex;
	flex-wrap: wrap;
	gap: 10px;
}
.package-list span {
	color: hsl(var(--muted-foreground));
	margin-left: 8px;
}
@media (max-width: 1200px) {
	.server-grid {
		grid-template-columns: 1fr;
	}
}
</style>
