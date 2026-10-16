<script setup lang="ts">
import type { EchartsUIType, ECOption } from '@vben/plugins/echarts';

import { onActivated, onBeforeUnmount, onDeactivated, onMounted, ref, watch } from 'vue';

import { EchartsUI, useEcharts } from '@vben/plugins/echarts';

import { advanceIncomeDemoSamples, createIncomeDemoSamples, incomeDemoIntervalMs } from './workbench';

const props = defineProps<{ signal: AbortSignal }>();
const chartRef = ref<EchartsUIType>();
const { getChartInstance, isActive, renderEcharts } = useEcharts(chartRef);
const samples = ref(createIncomeDemoSamples());
const chartError = ref('');
const chartVisible = ref(false);
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;
let generation = 0;

function chartOptions(): ECOption {
	return {
		animationDurationUpdate: incomeDemoIntervalMs,
		animationEasingUpdate: 'linear',
		grid: { top: 30, left: 10, right: 10, bottom: 10, containLabel: true },
		tooltip: { trigger: 'axis' },
		xAxis: { type: 'category', boundaryGap: false, data: samples.value.map((item) => item.time) },
		yAxis: { type: 'value', name: '价格', min: 0, max: 100 },
		series: [{ name: '收入', type: 'line', symbol: 'none', data: samples.value.map((item) => item.amount) }],
	};
}

function disposeChart() {
	const chart = getChartInstance();
	if (chart && !chart.isDisposed()) chart.dispose();
}

function stop() {
	running = false;
	generation += 1;
	if (timer !== undefined) clearInterval(timer);
	timer = undefined;
	isActive.value = false;
	chartVisible.value = false;
	disposeChart();
}

async function start() {
	if (running || props.signal.aborted) return;
	running = true;
	const current = ++generation;
	isActive.value = true;
	chartVisible.value = true;
	samples.value = createIncomeDemoSamples();
	chartError.value = '';
	try {
		const options = chartOptions();
		const chart = await renderEcharts(options);
		// 初始化可能晚于离开或会话切换；过期任务不得重新启动刷新。
		if (current !== generation || props.signal.aborted || !running) {
			if (!running && chart && !chart.isDisposed()) chart.dispose();
			return;
		}
		if (!chart || chart.isDisposed()) {
			stop();
			chartError.value = '演示图表暂时不可用';
			return;
		}
		timer = setInterval(() => {
			if (current !== generation || props.signal.aborted || !running) return;
			samples.value = advanceIncomeDemoSamples(samples.value);
			Object.assign(options, chartOptions());
			const activeChart = getChartInstance();
			if (activeChart && !activeChart.isDisposed()) activeChart.setOption(options);
		}, incomeDemoIntervalMs);
	} catch {
		if (current === generation) {
			stop();
			chartError.value = '演示图表暂时不可用';
		}
	}
}

watch(
	() => props.signal,
	(signal, _previous, onCleanup) => {
		signal.addEventListener('abort', stop, { once: true });
		onCleanup(() => signal.removeEventListener('abort', stop));
		if (signal.aborted) stop();
	},
	{ immediate: true, flush: 'sync' }
);
onMounted(start);
onActivated(start);
onDeactivated(stop);
onBeforeUnmount(stop);
</script>

<template>
	<div data-testid="income-demo">
		<p class="text-muted-foreground mb-2 text-sm">随机演示数据，每 2.1 秒更新，不代表实际业务收入。</p>
		<p v-if="chartError" role="alert">{{ chartError }}</p>
		<EchartsUI v-if="chartVisible" ref="chartRef" class="h-[300px] w-full" aria-hidden="true" data-testid="income-demo-chart" />
		<p class="mt-2 text-sm" data-testid="income-demo-latest">最新演示收入：{{ samples.at(-1)?.amount ?? 0 }}</p>
		<details class="mt-2 text-sm">
			<summary class="cursor-pointer">查看演示数据（30 个点）</summary>
			<div class="max-h-48 overflow-y-auto">
				<table class="w-full text-left">
					<caption class="sr-only">
						收入演示最近 30 个采样点
					</caption>
					<thead>
						<tr>
							<th scope="col">时间</th>
							<th scope="col">演示收入</th>
						</tr>
					</thead>
					<tbody>
						<tr v-for="(sample, index) in samples" :key="index">
							<td>{{ sample.time }}</td>
							<td>{{ sample.amount }}</td>
						</tr>
					</tbody>
				</table>
			</div>
		</details>
	</div>
</template>
