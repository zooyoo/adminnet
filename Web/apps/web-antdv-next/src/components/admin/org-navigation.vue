<script setup lang="ts">
import type { OrgTreeOutput } from '#/api-services/models';
import type { TreeOption } from '#/utils/admin-tree';

import { computed, onMounted, ref } from 'vue';

import { createIconifyIcon } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Input, Spin, Tooltip, Tree } from 'antdv-next';

import { orgTree } from '#/api/system/access-admin';
import { findTreeNode, treeKeys, treeOptions } from '#/utils/admin-tree';

import TenantSelect from './tenant-select.vue';

const emit = defineEmits<{ select: [value: { id: number; tenantId?: number }] }>();
const user = useUserStore();
const tenantId = ref<number | undefined>(Number(user.userInfo?.currentTenantId) || undefined);
const rows = ref<OrgTreeOutput[]>([]);
const search = ref('');
const selected = ref<number[]>([]);
const expanded = ref<number[]>([]);
const loading = ref(false);
const error = ref('');
let generation = 0;
const Expand = createIconifyIcon('lucide:chevrons-up-down');
const Collapse = createIconifyIcon('lucide:chevrons-down-up');
const Reset = createIconifyIcon('lucide:rotate-ccw');
const Refresh = createIconifyIcon('lucide:refresh-cw');
const nodes = computed(() => treeOptions(rows.value, undefined, tenantId.value));
const filtered = computed(() => {
	function filter(items: TreeOption[]): TreeOption[] {
		return items.flatMap((item) => {
			if (item.title.includes(search.value)) return [item];
			const children = filter(item.children ?? []);
			return children.length ? [{ ...item, children }] : [];
		});
	}
	return search.value ? filter(nodes.value) : nodes.value;
});

async function reload() {
	const current = ++generation;
	loading.value = true;
	error.value = '';
	try {
		const result = await orgTree(tenantId.value);
		if (current !== generation) return;
		rows.value = result;
		expanded.value = treeKeys(treeOptions(result, undefined, tenantId.value));
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '机构树加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
function select(keys: Array<number | string>) {
	const id = Number(keys[0] ?? 0);
	selected.value = id ? [id] : [];
	emit('select', { id, tenantId: findTreeNode(rows.value, id)?.tenantId ?? tenantId.value });
}
function reset() {
	search.value = '';
	select([]);
}
function tenantChanged() {
	rows.value = [];
	reset();
	void reload();
}
defineExpose({ reset, reload });
onMounted(reload);
</script>

<template>
	<aside class="org-navigation">
		<TenantSelect v-if="user.userInfo?.accountType === 999" v-model="tenantId" aria-label="机构树租户" allow-clear @change="tenantChanged" />
		<Input v-model:value="search" aria-label="搜索机构树" placeholder="机构名称" allow-clear />
		<div class="tree-tools">
			<Tooltip title="全部展开"
				><Button aria-label="展开机构树" @click="expanded = treeKeys(nodes)"><Expand :size="16" /></Button
			></Tooltip>
			<Tooltip title="全部折叠"
				><Button aria-label="折叠机构树" @click="expanded = []"><Collapse :size="16" /></Button
			></Tooltip>
			<Tooltip title="根节点"
				><Button aria-label="选择根节点" @click="reset"><Reset :size="16" /></Button
			></Tooltip>
			<Tooltip title="刷新"
				><Button aria-label="刷新机构树" @click="reload"><Refresh :size="16" /></Button
			></Tooltip>
		</div>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading"><Tree v-model:expanded-keys="expanded" :selected-keys="selected" :tree-data="filtered" block-node @select="select" /></Spin>
	</aside>
</template>

<style scoped>
.org-navigation {
	display: flex;
	flex-direction: column;
	gap: 12px;
	padding: 16px;
	min-width: 0;
	border-right: 1px solid var(--ant-color-border);
}
.tree-tools {
	display: flex;
	gap: 6px;
}
@media (max-width: 800px) {
	.org-navigation {
		max-height: 300px;
		overflow: auto;
		border-right: 0;
		border-bottom: 1px solid var(--ant-color-border);
	}
}
</style>
