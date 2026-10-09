<script setup lang="ts">
import type { RelationGraphComponent, RGLine, RGLink, RGNode, RGOptions, RGUserEvent } from 'relation-graph/vue3';

import type { ColumnRelation, VisualColumn, VisualDbTable, VisualTable } from '#/api-services/models';

import { computed, h, nextTick, onActivated, onDeactivated, onScopeDispose, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';

import { useAccess } from '@vben/access';
import { createIconifyIcon } from '@vben/icons';

import { Alert, Button, Empty, Spin, Tooltip } from 'antdv-next';
import RelationGraph from 'relation-graph/vue3';

import { sessionBoundary } from '#/api/session';
import { databaseGraph } from '#/api/system/database';

import { buildVisualGraph, visualAnchorId } from './visual-graph';

defineOptions({ name: 'DatabaseVisual' });

const route = useRoute();
const router = useRouter();
const { hasAccessByCodes } = useAccess();
const canView = computed(() => hasAccessByCodes(['sysDatabase:visualDbTable']));
const configId = computed(() => String(route.query.configId ?? ''));
const tableName = computed(() => String(route.query.tableName ?? ''));
const graphRef = ref<null | RelationGraphComponent>(null);
const graph = ref<VisualDbTable>();
const selectedTable = ref<VisualTable>();
const selectedRelation = ref<ColumnRelation>();
const loading = ref(false);
const error = ref('');
const active = ref(true);
let generation = 0;
let operation: AbortController | undefined;
const lifetime = new AbortController();
sessionBoundary.track(lifetime);

const icons = Object.fromEntries(
	['arrow-left', 'refresh-cw', 'scan-search', 'crosshair'].map((name) => [name, h(createIconifyIcon(`lucide:${name}`))]),
);
const graphOptions: RGOptions = {
	layout: { layoutName: 'fixed' },
	backgroundColor: 'transparent',
	defaultNodeColor: 'transparent',
	defaultNodeBorderWidth: 0,
	defaultJunctionPoint: 'border',
	defaultNodeWidth: 360,
	defaultNodeHeight: 132,
	moveToCenterWhenRefresh: true,
	zoomToFitWhenRefresh: true,
	useAnimationWhenRefresh: false,
};

function clearGraph() {
	graph.value = undefined;
	selectedTable.value = undefined;
	selectedRelation.value = undefined;
	const instance = graphRef.value?.getInstance();
	if (instance) void instance.setJsonData({ nodes: [], lines: [] });
}

async function renderGraph(data: VisualDbTable, selected: string) {
	await nextTick();
	const instance = graphRef.value?.getInstance();
	if (!instance) return;
	await instance.setJsonData(buildVisualGraph(data, selected), true);
	instance.moveToCenter();
	await instance.zoomToFit();
}

async function load() {
	const currentGeneration = ++generation;
	operation?.abort();
	operation = new AbortController();
	const signal = operation.signal;
	const version = sessionBoundary.version;
	const valid = () => active.value && currentGeneration === generation && !signal.aborted && version === sessionBoundary.version;
	clearGraph();
	error.value = '';
	if (!canView.value) return;
	if (!configId.value) {
		error.value = '缺少数据库连接，请从库表管理入口进入';
		return;
	}
	loading.value = true;
	try {
		const data = await databaseGraph({ configId: configId.value, tableName: tableName.value || undefined }, signal);
		if (!valid()) return;
		graph.value = data;
		selectedTable.value = data.visualTableList?.find((table) => table.tableName === tableName.value);
		await renderGraph(data, tableName.value);
	} catch (cause) {
		if (valid() && !(cause instanceof DOMException && cause.name === 'AbortError')) error.value = cause instanceof Error ? cause.message : '关系图加载失败';
	} finally {
		if (valid()) loading.value = false;
	}
}

function reload() {
	void load();
}

function fitGraph() {
	void graphRef.value?.getInstance().zoomToFit();
}

function centerGraph() {
	graphRef.value?.getInstance().moveToCenter();
}

function onNodeClick(node: RGNode, _event: KeyboardEvent | RGUserEvent) {
	for (const item of graphRef.value?.getInstance().getNodes() ?? []) item.selected = item.id === node.id;
	selectedRelation.value = undefined;
	selectedTable.value = graph.value?.visualTableList?.find((table) => table.tableName === node.id);
}

function onLineClick(line: RGLine, _link: RGLink, _event: RGUserEvent) {
	for (const item of graphRef.value?.getInstance().getNodes() ?? []) item.selected = false;
	selectedTable.value = undefined;
	selectedRelation.value = line.data?.relation as ColumnRelation | undefined;
}

function columnsFor(tableNameValue?: null | string): VisualColumn[] {
	return tableNameValue ? (graph.value?.visualColumnList ?? []).filter((column) => column.tableName === tableNameValue) : [];
}

onActivated(() => {
	active.value = true;
	void load();
});
onDeactivated(() => {
	active.value = false;
	operation?.abort();
});
watch(() => [configId.value, tableName.value, canView.value] as const, () => void load(), { immediate: true });
onScopeDispose(() => {
	active.value = false;
	operation?.abort();
	lifetime.abort();
	sessionBoundary.release(lifetime);
});
</script>

<template>
	<main class="database-visual-page">
		<header class="visual-toolbar">
			<div>
				<h1>库表关系图</h1>
				<p>{{ configId }}<span v-if="tableName"> · 定位：{{ tableName }}</span></p>
			</div>
			<div class="visual-actions">
				<Button :icon="icons['arrow-left']" aria-label="返回库表管理" @click="router.back()">返回</Button>
				<Tooltip title="刷新关系图"><Button :icon="icons['refresh-cw']" aria-label="刷新关系图" :loading="loading" @click="reload" /></Tooltip>
				<Tooltip title="适配画布"><Button :icon="icons['scan-search']" aria-label="适配画布" :disabled="!graph" @click="fitGraph" /></Tooltip>
				<Tooltip title="居中画布"><Button :icon="icons.crosshair" aria-label="居中画布" :disabled="!graph" @click="centerGraph" /></Tooltip>
			</div>
		</header>
		<Alert v-if="!canView" type="warning" title="无结构关系图权限" show-icon />
		<Alert v-else-if="error" type="error" :title="error" show-icon />
		<section v-else class="visual-stage">
			<Spin wrapper-class-name="visual-spin" :spinning="loading" description="加载结构关系">
				<Empty v-if="!loading && graph && !(graph.visualTableList?.length)" description="当前数据库没有可展示的表" />
				<RelationGraph
					v-else
					ref="graphRef"
					:options="graphOptions"
					:on-node-click="onNodeClick"
					:on-line-click="onLineClick"
				>
					<template #node="{ node }">
						<article class="graph-node" :class="{ selected: node.selected }" role="button" tabindex="0" :aria-label="`查看表 ${node.id}`" @click="onNodeClick(node, $event)" @keydown.enter.prevent="onNodeClick(node, $event)" @keydown.space.prevent="onNodeClick(node, $event)">
							<header>{{ node.text }} <span>（{{ node.data.columns.length }} 列）</span></header>
							<table>
								<thead><tr><th>列名</th><th>类型</th><th>描述</th></tr></thead>
								<tbody>
									<tr v-for="column in node.data.columns" :key="column.columnName">
										<td :id="visualAnchorId(node.id, column.columnName)">{{ column.columnName }}</td>
										<td>{{ column.dataType }}<span v-if="column.dataLength">（{{ column.dataLength }}）</span></td>
										<td>{{ column.columnDescription || '—' }}</td>
									</tr>
								</tbody>
							</table>
						</article>
					</template>
					<template #graph-plug>
						<div class="graph-legend"><span><i class="many" />外键关系</span><span><i class="one" />一对一（后端明确提供时）</span></div>
					</template>
				</RelationGraph>
			</Spin>
		</section>
		<aside v-if="selectedTable" class="selection-panel">
			<strong>{{ selectedTable.tableName }}</strong>
			<span>{{ selectedTable.tableComents || '无表描述' }}</span>
			<span>{{ columnsFor(selectedTable.tableName).length }} 个字段</span>
		</aside>
		<aside v-else-if="selectedRelation" class="selection-panel">
			<strong>外键关系</strong>
			<span>{{ selectedRelation.sourceTableName }}.{{ selectedRelation.sourceColumnName }}</span>
			<span>→ {{ selectedRelation.targetTableName }}.{{ selectedRelation.targetColumnName }}</span>
		</aside>
	</main>
</template>

<style scoped>
.database-visual-page { display: flex; flex-direction: column; height: calc(100vh - 110px); min-height: 560px; margin: 16px; padding: 20px; background: hsl(var(--card)); }
.visual-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding-bottom: 16px; }
h1 { margin: 0; font-size: 20px; font-weight: 600; }
.visual-toolbar p { margin: 6px 0 0; color: hsl(var(--muted-foreground)); font-size: 13px; }
.visual-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.visual-stage { position: relative; display: flex; flex: 1; min-height: 0; overflow: hidden; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--muted) / 0.28); }
.visual-stage :deep(.visual-spin), .visual-stage :deep(.visual-spin > .ant-spin-container) { display: flex; flex: 1; min-height: 0; height: 100%; width: 100%; }
.visual-stage :deep(.relation-graph) { height: 100%; width: 100%; }
.graph-node { width: 360px; overflow: hidden; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card)); box-shadow: 0 8px 20px hsl(var(--foreground) / 0.12); color: hsl(var(--foreground)); }
.graph-node.selected { border-color: hsl(var(--primary)); box-shadow: 0 0 0 2px hsl(var(--primary) / 0.25); }
.graph-node > header { padding: 10px 12px; background: hsl(var(--primary) / 0.12); font-weight: 600; }
.graph-node > header span { color: hsl(var(--muted-foreground)); font-size: 12px; font-weight: 400; }
.graph-node table { width: 100%; border-collapse: collapse; font-size: 12px; }
.graph-node th, .graph-node td { max-width: 130px; padding: 6px 8px; border-top: 1px solid hsl(var(--border)); text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.graph-node th { color: hsl(var(--muted-foreground)); font-weight: 500; }
.graph-legend { position: absolute; left: 12px; bottom: 12px; display: flex; gap: 12px; padding: 8px 10px; border: 1px solid hsl(var(--border)); border-radius: 8px; background: hsl(var(--card) / 0.92); font-size: 12px; }
.graph-legend span { display: inline-flex; align-items: center; gap: 6px; }
.graph-legend i { display: inline-block; width: 28px; height: 3px; border-radius: 99px; }
.graph-legend .many { background: rgba(70, 180, 100, 0.85); }
.graph-legend .one { background: rgba(255, 80, 80, 0.85); }
.selection-panel { display: flex; flex-wrap: wrap; gap: 10px 16px; margin-top: 12px; padding: 10px 12px; border: 1px solid hsl(var(--border)); border-radius: 8px; color: hsl(var(--muted-foreground)); font-size: 13px; }
.selection-panel strong { color: hsl(var(--foreground)); }
</style>
