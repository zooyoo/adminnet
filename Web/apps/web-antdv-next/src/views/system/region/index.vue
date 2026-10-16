<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { RegionRow } from '#/api/system/region';

import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, watch } from 'vue';

import { useAccess } from '@vben/access';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Card, Empty, Form, FormItem, Input, InputNumber, message, Modal, Spin, Table, Tree } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { regionApi } from '#/api/system/region';

import { createRegionSession, createRegionState, findRegionPath, regionTreeKeys, regionTreeNodes } from './region-session';

defineOptions({ name: 'SystemRegion' });

const userStore = useUserStore();
const { hasAccessByCodes } = useAccess();
const permissions = computed(() => ({
	page: hasAccessByCodes(['sysRegion:page']),
	add: hasAccessByCodes(['sysRegion:add']),
	update: hasAccessByCodes(['sysRegion:update']),
	delete: hasAccessByCodes(['sysRegion:delete']),
	sync: hasAccessByCodes(['sysRegion:sync']),
}));
const identity = computed(() => {
	const user = userStore.userInfo;
	return [user?.userId, user?.tenantId, user?.currentTenantId, user?.accountType].join(':');
});
const state = reactive(createRegionState());
const session = createRegionSession(state, {
	api: regionApi,
	boundary: sessionBoundary,
	identity: () => identity.value,
	permissions: () => permissions.value,
	notify: (text) => message.success(text),
});
let visible = false;
function activate() {
	visible = true;
	session.activate();
}
onMounted(activate);
onActivated(activate);
onDeactivated(() => {
	visible = false;
	session.deactivate();
});
onScopeDispose(() => {
	visible = false;
	session.dispose();
});
watch([identity, permissions], () => session.contextChanged(visible), { flush: 'sync' });

const treeNodes = computed(() => regionTreeNodes(state.tree, state.treeFilter));
const expandedKeys = computed(() => (state.treeFilter.trim() ? regionTreeKeys(treeNodes.value) : state.expandedKeys));
const selectedKeys = computed(() => (state.selectedId === undefined ? [] : [String(state.selectedId)]));
const currentPath = computed(() =>
	state.selectedId === undefined
		? '根节点（全部区域）'
		: findRegionPath(state.tree, state.selectedId)
				.map((row) => row.name)
				.join(' / ')
);
const writeBusy = computed(() => state.saveBusy || state.deleteBusy || state.syncBusy);
// 分页接口返回的是平铺记录；树 children 仍保存在会话中供无损编辑使用。
const tableRows = computed(() => state.items.map((row) => ({ ...row, children: undefined })));
const columns = computed<TableProps<RegionRow>['columns']>(() => [
	{ title: '行政名称', dataIndex: 'name', key: 'name', width: 160 },
	{ title: '行政代码', dataIndex: 'code', key: 'code', width: 140 },
	{ title: '区号', dataIndex: 'cityCode', key: 'cityCode', width: 80 },
	{ title: '排序', dataIndex: 'orderNo', key: 'orderNo', width: 70 },
	{ title: '备注', dataIndex: 'remark', key: 'remark' },
	...(permissions.value.update || permissions.value.delete ? [{ title: '操作', key: 'action', width: 135 }] : []),
]);
const pagination = computed(() => ({
	current: state.page,
	pageSize: state.pageSize,
	total: state.total,
	showSizeChanger: true,
	pageSizeOptions: ['10', '20', '50', '100'],
	showTotal: (total: number) => '共 ' + total + ' 条',
}));
const onTableChange = (page: { current?: number; pageSize?: number }) => session.changePage(page.current ?? 1, page.pageSize ?? 50);
function onTreeSelect(keys: readonly (number | string)[]) {
	session.selectRegion(keys[0]);
}
function onTreeExpand(keys: readonly (number | string)[]) {
	state.expandedKeys = keys.map(String);
}
</script>

<template>
	<div class="region-page p-4">
		<Alert v-if="!permissions.page" title="无区域管理查看权限" type="warning" show-icon />
		<div v-else class="region-layout">
			<Card title="区域导航" class="region-navigation" :bordered="false">
				<Input v-model:value="state.treeFilter" aria-label="筛选区域树" placeholder="按行政名称或代码筛选" allow-clear :disabled="writeBusy" />
				<div class="region-tree-toolbar">
					<Button :auto-insert-space="false" :disabled="writeBusy" @click="session.selectRegion(undefined)">根节点</Button>
					<Button :auto-insert-space="false" :loading="state.treeBusy" :disabled="writeBusy" @click="session.loadTree">刷新区域树</Button>
					<Button :auto-insert-space="false" :disabled="writeBusy || !treeNodes.length" @click="state.expandedKeys = regionTreeKeys(treeNodes)">全部展开</Button>
					<Button :auto-insert-space="false" :disabled="writeBusy || !!state.treeFilter.trim()" @click="state.expandedKeys = []">全部折叠</Button>
				</div>
				<Alert v-if="state.treeError" :title="state.treeError" type="error" show-icon class="mb-3" />
				<Spin :spinning="state.treeBusy" description="正在加载区域树">
					<Tree
						v-if="treeNodes.length"
						aria-label="区域导航"
						:tree-data="treeNodes"
						:expanded-keys="expandedKeys"
						:selected-keys="selectedKeys"
						:virtual="false"
						:disabled="writeBusy"
						block-node
						@select="onTreeSelect"
						@expand="onTreeExpand"
					>
						<template #titleRender="node">
							<span class="region-tree-name">{{ node.name }}</span>
							<span class="region-tree-code">{{ node.code }}</span>
						</template>
					</Tree>
					<Empty v-else-if="!state.treeBusy && !state.treeError" :description="state.treeFilter.trim() ? '没有匹配的行政区域' : '暂无行政区域'" />
				</Spin>
			</Card>
			<Card title="区域管理" class="region-content" :bordered="false">
				<p class="region-current-path">当前范围：{{ currentPath }}<span v-if="state.selectedId !== undefined">（当前节点及直接子级）</span></p>
				<Form name="region-query" layout="inline" :model="state.query" :colon="false" :required-mark="false" class="region-query" @finish="session.query">
					<FormItem name="name" label="行政名称"><Input v-model:value="state.query.name" aria-label="查询行政名称" placeholder="行政名称" allow-clear /></FormItem>
					<FormItem name="code" label="行政代码"><Input v-model:value="state.query.code" aria-label="查询行政代码" placeholder="行政代码" allow-clear /></FormItem>
					<div class="region-query-actions">
						<Button type="primary" html-type="submit" :auto-insert-space="false" :loading="state.pageBusy">查询</Button>
						<Button :auto-insert-space="false" :disabled="writeBusy" @click="session.reset">重置</Button>
					</div>
				</Form>
				<div class="region-list-toolbar">
					<Button v-if="permissions.sync" :auto-insert-space="false" :disabled="writeBusy || state.editorOpen || !!state.deleteTarget" :loading="state.syncBusy" @click="session.requestSync"
						>同步国家统计局</Button
					>
					<Button v-if="permissions.add" type="primary" :auto-insert-space="false" :disabled="writeBusy" @click="session.openAdd">新增区域</Button>
					<Button :auto-insert-space="false" :loading="state.pageBusy" :disabled="writeBusy" @click="session.loadPage">刷新区域列表</Button>
				</div>
				<Alert v-if="state.pageError" :title="state.pageError" type="error" show-icon class="mb-3" />
				<section aria-label="区域列表">
					<Table
						:columns="columns"
						:data-source="tableRows"
						:row-key="(row: RegionRow) => String(row.id)"
						:pagination="pagination"
						:loading="state.pageBusy"
						:locale="{ emptyText: state.pageError ? '区域列表加载失败' : '暂无行政区域' }"
						@change="onTableChange"
					>
						<template #bodyCell="{ column, record }">
							<div v-if="column.key === 'action'" class="region-row-actions">
								<Button v-if="permissions.update" type="link" size="small" :auto-insert-space="false" :disabled="writeBusy" @click="session.openEdit(record)">编辑</Button>
								<Button v-if="permissions.delete" type="link" size="small" danger :auto-insert-space="false" :disabled="writeBusy" @click="session.requestDelete(record)">删除</Button>
							</div>
							<span v-else-if="column.key === 'remark'" class="region-remark">{{ record.remark || '—' }}</span>
						</template>
					</Table>
				</section>
			</Card>
		</div>

		<Modal :open="state.syncOpen" title="同步国家统计局" :mask="{ closable: false }" :closable="!state.syncBusy" :keyboard="!state.syncBusy" destroy-on-hidden @cancel="session.cancelSync">
			<p>同步将替换现有行政区域数据。是否确认同步国家统计局数据？</p>
			<Alert v-if="state.syncError" :title="state.syncError" type="error" show-icon class="mt-4" />
			<template #footer>
				<Button :auto-insert-space="false" :disabled="state.syncBusy" @click="session.cancelSync">取消</Button>
				<Button type="primary" :auto-insert-space="false" :loading="state.syncBusy" :disabled="state.syncBusy" @click="session.confirmSync">确认同步</Button>
			</template>
		</Modal>

		<Modal
			:open="state.editorOpen"
			:title="state.editorKind === 'add' ? '添加行政区域' : '编辑行政区域'"
			:width="600"
			:mask-closable="false"
			:closable="!state.saveBusy"
			:keyboard="!state.saveBusy"
			destroy-on-hidden
			@cancel="session.closeEditor"
		>
			<Alert v-if="state.editorError" :title="state.editorError" type="error" show-icon class="mb-4" />
			<Form name="region-editor" :model="state.draft" :colon="false" :required-mark="false" :label-col="{ span: 5 }" :wrapper-col="{ span: 19 }" @finish="session.save">
				<FormItem name="parent" label="上级行政"><Input :value="state.editorParent" readonly /></FormItem>
				<FormItem name="name" label="行政名称"><Input v-model:value="state.draft.name" :disabled="state.saveBusy" /></FormItem>
				<FormItem name="code" label="行政代码"><Input v-model:value="state.draft.code" :disabled="state.saveBusy" placeholder="长度为 6、9 或 12 位" /></FormItem>
				<FormItem name="cityCode" label="区号"><Input v-model:value="state.draft.cityCode" :disabled="state.saveBusy" /></FormItem>
				<FormItem name="orderNo" label="排序"><InputNumber v-model:value="state.draft.orderNo" :step="1" :disabled="state.saveBusy" class="w-full" /></FormItem>
				<FormItem name="remark" label="备注"><Input.TextArea v-model:value="state.draft.remark" :rows="4" :disabled="state.saveBusy" /></FormItem>
			</Form>
			<template #footer>
				<Button :auto-insert-space="false" :disabled="state.saveBusy" @click="session.closeEditor">取消</Button>
				<Button type="primary" :auto-insert-space="false" :loading="state.saveBusy" @click="session.save">保存</Button>
			</template>
		</Modal>
		<Modal :open="!!state.deleteTarget" title="删除行政区域" :mask-closable="false" :closable="!state.deleteBusy" :keyboard="!state.deleteBusy" destroy-on-hidden @cancel="session.cancelDelete">
			<p>确认删除“{{ state.deleteTarget?.name }}”及其所有子孙区域？</p>
			<Alert v-if="state.deleteError" :title="state.deleteError" type="error" show-icon class="mt-4" />
			<template #footer>
				<Button :auto-insert-space="false" :disabled="state.deleteBusy" @click="session.cancelDelete">取消</Button>
				<Button type="primary" danger :auto-insert-space="false" :loading="state.deleteBusy" @click="session.confirmDelete">确认删除</Button>
			</template>
		</Modal>
	</div>
</template>

<style scoped>
.region-layout {
	display: grid;
	grid-template-columns: 320px minmax(0, 1fr);
	gap: 16px;
	align-items: start;
}
.region-navigation,
.region-content {
	min-width: 0;
}
.region-tree-toolbar,
.region-list-toolbar,
.region-query-actions,
.region-row-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.region-tree-toolbar {
	margin: 12px 0 16px;
}
.region-tree-name {
	white-space: normal;
	overflow-wrap: anywhere;
}
.region-tree-code {
	margin-left: 8px;
	color: hsl(var(--muted-foreground));
	font-size: 12px;
}
.region-current-path {
	margin-bottom: 16px;
	color: hsl(var(--muted-foreground));
	overflow-wrap: anywhere;
}
.region-query {
	gap: 12px 0;
	margin-bottom: 16px;
}
.region-list-toolbar {
	margin-bottom: 16px;
}
.region-row-actions {
	flex-wrap: nowrap;
	gap: 0;
}
.region-remark {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
}
@media (max-width: 1100px) {
	.region-layout {
		grid-template-columns: 280px minmax(0, 1fr);
	}
}
@media (max-width: 850px) {
	.region-layout {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
