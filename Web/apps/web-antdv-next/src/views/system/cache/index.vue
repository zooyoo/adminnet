<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';

import { useAccess } from '@vben/access';
import { JsonViewer } from '@vben/common-ui';
import { createIconifyIcon } from '@vben/icons';
import { usePreferences } from '@vben/preferences';

import { Alert, Button, Empty, Input, Modal, Spin, Splitter, SplitterPanel, Tooltip, Tree } from 'antdv-next';
import { isCancel } from 'axios';

import { cacheKeys, cacheValue, clearCache, removeCache } from '#/api/system/cache';

import { buildCacheTree, displayCacheValue } from './cache-tree';

defineOptions({ name: 'SysCache' });
const { hasAccessByCodes } = useAccess();
const { isDark } = usePreferences();
const can = (action: string) => hasAccessByCodes([`sysCache:${action}`]);
const Refresh = createIconifyIcon('lucide:refresh-cw');
const Trash = createIconifyIcon('lucide:trash-2');
const loading = ref(false);
const detailLoading = ref(false);
const error = ref('');
const detailError = ref('');
const keys = ref<string[]>([]);
const search = ref('');
const selected = ref<string[]>([]);
const selectedKey = ref<string>();
const content = ref<unknown>();
const expanded = ref<string[]>([]);
const confirmation = ref<{ key?: string }>();
const saving = ref(false);
const confirmationOpen = computed({
	get: () => confirmation.value !== undefined,
	set: (open) => {
		if (!open && !saving.value) confirmation.value = undefined;
	},
});
let generation = 0;
let listGeneration = 0;
let controller: AbortController | undefined;
const tree = computed(() => buildCacheTree(keys.value.filter((key) => key.includes(search.value))));

function clearDetail() {
	generation += 1;
	controller?.abort();
	content.value = undefined;
	selectedKey.value = undefined;
	selected.value = [];
	detailError.value = '';
	detailLoading.value = false;
}
async function reload() {
	const current = ++listGeneration;
	clearDetail();
	loading.value = true;
	error.value = '';
	try {
		const data = await cacheKeys();
		if (current !== listGeneration) return;
		keys.value = data;
		expanded.value = buildCacheTree(data)
			.filter((node) => node.children)
			.map((node) => node.key);
	} catch (cause) {
		if (current === listGeneration && !isCancel(cause)) error.value = cause instanceof Error ? cause.message : '缓存列表加载失败';
	} finally {
		if (current === listGeneration) loading.value = false;
	}
}
async function select(values: Array<number | string>) {
	const node = values[0];
	if (typeof node !== 'string' || !node.startsWith('value:')) return;
	clearDetail();
	const key = node.slice('value:'.length);
	if (!keys.value.includes(key)) return;
	selected.value = [node];
	selectedKey.value = key;
	detailLoading.value = true;
	const current = generation;
	controller = new AbortController();
	try {
		const value = await cacheValue(key, controller.signal);
		if (current === generation) content.value = displayCacheValue(value);
	} catch (cause) {
		if (current === generation && !isCancel(cause)) detailError.value = cause instanceof Error ? cause.message : '缓存读取失败';
	} finally {
		if (current === generation) detailLoading.value = false;
	}
}
function remove() {
	const key = selectedKey.value;
	if (key === undefined || !can('delete')) return;
	confirmation.value = { key };
}
function clear() {
	if (!can('clear')) return;
	confirmation.value = {};
}
async function confirmMutation() {
	const operation = confirmation.value;
	if (!operation || saving.value || !can(operation.key === undefined ? 'clear' : 'delete')) return;
	saving.value = true;
	try {
		if (operation.key === undefined) await clearCache();
		else await removeCache(operation.key);
		confirmation.value = undefined;
		await reload();
	} catch {
		// 请求层统一提示错误，保留确认框与选中数据以便重试。
	} finally {
		saving.value = false;
	}
}
onMounted(() => {
	if (can('keyList')) void reload();
});
onBeforeUnmount(() => {
	listGeneration += 1;
	clearDetail();
});
</script>

<template>
	<div class="cache-page">
		<Splitter class="cache-splitter" aria-label="缓存面板分隔" style="min-height: 480px"><SplitterPanel default-size="20%" :min="200"><aside class="cache-navigation">
			<header>
				<h1>缓存列表</h1>
				<div class="actions">
					<Tooltip v-if="can('keyList')" title="刷新"
						><Button aria-label="刷新缓存列表" :loading="loading" @click="reload"><Refresh :size="16" /></Button
					></Tooltip>
					<Button v-if="can('clear')" danger title="清空全部缓存" aria-label="清空全部缓存" @click="clear"><Trash :size="16" /></Button>
				</div>
			</header>
			<Input v-model:value="search" placeholder="缓存键" aria-label="筛选缓存键" allow-clear />
			<Alert v-if="error" :message="error" type="error" show-icon />
			<Spin :spinning="loading"><Tree v-model:expanded-keys="expanded" :tree-data="tree" :selected-keys="selected" block-node @select="select" /></Spin>
		</aside></SplitterPanel><SplitterPanel :min="200">
		<main class="cache-detail">
			<header>
				<h2>{{ selectedKey === undefined ? '缓存数据' : selectedKey }}</h2>
				<Button v-if="can('delete')" danger :disabled="selectedKey === undefined" @click="remove"><Trash :size="16" />删除缓存</Button>
			</header>
			<Alert v-if="detailError" :message="detailError" type="error" show-icon />
			<Spin :spinning="detailLoading">
				<template v-if="selectedKey !== undefined && !detailError && !detailLoading">
					<JsonViewer v-if="content !== null && typeof content === 'object'" :value="content" :theme="isDark ? 'dark' : 'light'" :expand-depth="3" :show-line-number="true" :show-select-controller="true" copyable :show-double-quotes="true" />
					<pre v-else class="cache-scalar">{{ content === undefined ? '' : String(content) }}</pre>
				</template>
				<Empty v-else-if="selectedKey === undefined" description="未选择缓存" />
			</Spin>
		</main></SplitterPanel></Splitter>
		<Modal
			v-model:open="confirmationOpen"
			:title="confirmation?.key === undefined ? '确定清空所有缓存？' : `确定删除缓存“${confirmation.key}”？`"
			:confirm-loading="saving"
			:ok-button-props="{ danger: true }"
			:cancel-button-props="{ disabled: saving }"
			:closable="!saving"
			:keyboard="!saving"
			:mask-closable="!saving"
			@ok="confirmMutation"
		/>
	</div>
</template>

<style scoped>
.cache-page {
	display: block;
}
.cache-navigation {
	border-right: 1px solid var(--ant-color-border);
	display: flex;
	flex-direction: column;
	gap: 14px;
}
.cache-navigation,
.cache-detail {
	padding: 16px;
	min-width: 0;
}
header,
.actions {
	display: flex;
	align-items: center;
	gap: 8px;
}
header {
	justify-content: space-between;
	margin-bottom: 16px;
}
header > :deep(button) {
	flex-shrink: 0;
}
h1,
h2 {
	font-size: 16px;
	font-weight: 600;
	overflow-wrap: anywhere;
	min-width: 0;
}
.cache-detail :deep(.vben-json-viewer) {
	overflow: auto;
}
.cache-scalar {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
@media (max-width: 750px) {
	.cache-page {
		grid-template-columns: minmax(0, 1fr);
	}
	.cache-navigation {
		border-right: 0;
		border-bottom: 1px solid var(--ant-color-border);
		max-height: 340px;
		overflow: auto;
	}
}
</style>
