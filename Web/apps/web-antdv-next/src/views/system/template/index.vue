<script setup lang="ts">
import type { TableProps } from 'antdv-next';

import type { TemplateRow } from '#/api/system/template';

import { computed, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { useUserStore } from '@vben/stores';

import { Alert, AutoComplete, Button, Form, FormItem, Input, InputNumber, message, Modal, RadioGroup, Select, Table, Tabs } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { templateApi } from '#/api/system/template';
import TemplateEditor from '#/components/template-editor/index.vue';
import { templatePreviewDocument } from '#/components/template-editor/template-display';

import { createTemplateSession, createTemplateState, TEMPLATE_TYPES } from './template-session';

defineOptions({ name: 'SysTemplate' });
const user = useUserStore();
const { hasAccessByCodes } = useAccess();
const permissions = computed(() => ({
	page: hasAccessByCodes(['sysTemplate:page']),
	add: hasAccessByCodes(['sysTemplate:add']),
	update: hasAccessByCodes(['sysTemplate:update']),
	delete: hasAccessByCodes(['sysTemplate:delete']),
	preview: hasAccessByCodes(['sysTemplate:preview']),
}));
const identity = computed(() => [user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId, user.userInfo?.accountType].join(':'));
const state = reactive(createTemplateState());
const session = createTemplateSession(state, {
	api: templateApi,
	boundary: sessionBoundary,
	identity: () => identity.value,
	permissions: () => permissions.value,
	tenantId: () => user.userInfo?.currentTenantId ?? user.userInfo?.tenantId,
	notify: (text) => {
		void message.success(text);
	},
});
let visible = false;
const activeTab = shallowRef('basic');
const richEditor = shallowRef<InstanceType<typeof TemplateEditor>>();
const parameterToInsert = shallowRef('');
const groupOptions = computed(() => state.groups.map((value) => ({ value })));
const editorReadOnly = computed(() => state.editorKind === 'preview' || state.saveBusy || state.renderBusy);
const title = computed(() => ({ add: '添加模板', update: '编辑模板', preview: '预览模板' })[state.editorKind]);
const showSave = computed(() => state.editorKind !== 'preview' && permissions.value[state.editorKind]);
const renderedDocument = computed(() => templatePreviewDocument(state.rendered ?? ''));
const pagination = computed(() => ({
	current: state.page,
	pageSize: state.pageSize,
	total: state.total,
	showSizeChanger: true,
	pageSizeOptions: ['10', '20', '50', '100'],
	showTotal: (total: number) => '共 ' + String(total) + ' 条',
}));
const columns: NonNullable<TableProps<TemplateRow>['columns']> = [
	{ title: '模板名称', dataIndex: 'name', key: 'name', width: 180 },
	{ title: '模板编码', dataIndex: 'code', key: 'code', width: 180 },
	{ title: '分组', dataIndex: 'groupName', key: 'groupName', width: 130 },
	{ title: '类型', dataIndex: 'type', key: 'type', width: 110 },
	{ title: '排序', dataIndex: 'orderNo', key: 'orderNo', width: 90 },
	{ title: '备注', dataIndex: 'remark', key: 'remark', width: 200 },
	{ title: '操作', key: 'actions', fixed: 'right', width: 235 },
];
const typeName = (value: number) => TEMPLATE_TYPES.find((type) => type.value === value)?.label ?? String(value);
const tableChanged = (page: { current?: number; pageSize?: number }) => {
	session.changePage(page.current ?? 1, page.pageSize ?? 20);
};
function openEditor(kind: 'add' | 'preview' | 'update', row?: TemplateRow) {
	activeTab.value = 'basic';
	parameterToInsert.value = '';
	if (kind === 'add') session.openAdd();
	else if (row) {
		if (kind === 'update') session.openEdit(row);
		else session.openPreview(row);
	}
}
function plainContentChanged(value: number | string | undefined) {
	session.contentChanged(String(value ?? ''));
}
function insertParameter() {
	if (!parameterToInsert.value.trim() || editorReadOnly.value) return;
	const key = parameterToInsert.value;
	if (state.contentType === 1 && richEditor.value) richEditor.value.insertParameter(key);
	else session.contentChanged(state.draft.content + '@(' + key + ')');
}
watch(
	[identity, permissions],
	() => {
		session.contextChanged(visible);
	},
	{ flush: 'sync' }
);
watch(
	() => state.editorOpen,
	() => {
		activeTab.value = 'basic';
		parameterToInsert.value = '';
	}
);
onMounted(() => {
	visible = true;
	session.activate();
});
onActivated(() => {
	visible = true;
	session.activate();
});
onDeactivated(() => {
	visible = false;
	session.deactivate();
});
onScopeDispose(() => {
	visible = false;
	session.dispose();
});
</script>

<template>
	<div class="template-page">
		<Alert v-if="!permissions.page" type="warning" show-icon title="当前账号没有查询模板权限。" />
		<template v-else>
			<Form name="template-query" :model="state.query" layout="inline" :colon="false" :required-mark="false" class="template-query" @finish="session.query">
				<FormItem name="name" label="查询模板名称"><Input v-model:value="state.query.name" allow-clear /></FormItem>
				<FormItem name="code" label="查询模板编码"><Input v-model:value="state.query.code" allow-clear /></FormItem>
				<FormItem name="groupName" label="查询模板分组"><AutoComplete v-model:value="state.query.groupName" :options="groupOptions" allow-clear /></FormItem>
				<FormItem name="type" label="查询模板类型"><Select v-model:value="state.query.type" :options="TEMPLATE_TYPES" allow-clear /></FormItem>
				<div class="template-actions">
					<Button type="primary" html-type="submit" :auto-insert-space="false">查询模板</Button><Button :auto-insert-space="false" @click="session.reset">重置查询</Button>
				</div>
			</Form>
			<Alert v-if="state.pageError" type="error" show-icon aria-label="模板操作错误" :title="state.pageError" />
			<Alert v-if="state.groupsError" type="warning" show-icon aria-label="模板操作错误" :title="state.groupsError" />
			<div class="template-toolbar">
				<Button v-if="permissions.add" type="primary" :auto-insert-space="false" :disabled="state.saveBusy || state.deleteBusy" @click="openEditor('add')">新增模板</Button>
				<Button :auto-insert-space="false" :loading="state.pageBusy || state.groupsBusy" @click="session.refresh">刷新模板列表</Button>
			</div>
			<Table :columns="columns" :data-source="state.items" row-key="id" :loading="state.pageBusy" :pagination="pagination" :scroll="{ x: 1150 }" @change="tableChanged">
				<template #bodyCell="{ column, record }">
					<span v-if="column.key === 'type'">{{ typeName(record.type) }}</span>
					<div v-else-if="column.key === 'actions'" class="template-actions">
						<Button v-if="permissions.update" type="link" size="small" :auto-insert-space="false" @click="openEditor('update', record)">编辑模板</Button>
						<Button v-if="permissions.preview" type="link" size="small" :auto-insert-space="false" @click="openEditor('preview', record)">预览模板</Button>
						<Button v-if="permissions.delete" type="link" danger size="small" :auto-insert-space="false" @click="session.requestDelete(record)">删除模板</Button>
					</div>
				</template>
			</Table>
		</template>

		<Modal
			:open="state.editorOpen"
			:title="title"
			:width="1000"
			:footer="null"
			destroy-on-hidden
			:mask-closable="false"
			:closable="!state.saveBusy"
			:keyboard="!state.saveBusy"
			@cancel="session.closeEditor"
		>
			<Form name="template-editor" :model="state.draft" layout="vertical" :colon="false" :required-mark="false" @finish="session.save">
				<Alert v-if="state.editorError" type="error" show-icon aria-label="模板操作错误" :title="state.editorError" class="template-error" />
				<Tabs
					v-model:active-key="activeTab"
					:items="[
						{ key: 'basic', label: '基础信息' },
						{ key: 'content', label: '模板内容' },
					]"
					:animated="false"
				>
					<template #contentRender="{ item }">
						<div v-if="item.key === 'basic'" class="template-base-grid">
							<FormItem name="name" label="模板名称"><Input v-model:value="state.draft.name" :disabled="editorReadOnly" :maxlength="128" /></FormItem>
							<FormItem name="code" label="模板编码"><Input v-model:value="state.draft.code" :disabled="editorReadOnly" :maxlength="128" /></FormItem>
							<FormItem name="groupName" label="模板分组"><AutoComplete v-model:value="state.draft.groupName" :disabled="editorReadOnly" :options="groupOptions" :maxlength="32" /></FormItem>
							<FormItem name="type" label="模板类型"><Select v-model:value="state.draft.type" :disabled="editorReadOnly" :options="TEMPLATE_TYPES" /></FormItem>
							<FormItem name="orderNo" label="模板排序"><InputNumber v-model:value="state.draft.orderNo" :disabled="editorReadOnly" :precision="0" style="width: 100%" /></FormItem>
							<FormItem name="remark" label="模板备注"><Input v-model:value="state.draft.remark" :disabled="editorReadOnly" :maxlength="128" /></FormItem>
						</div>
						<div v-else class="template-content-panel">
							<FormItem name="contentType" label="内容类型"
								><RadioGroup
									v-model:value="state.contentType"
									:disabled="state.saveBusy || state.renderBusy"
									:options="[
										{ label: '富文本', value: 1 },
										{ label: '纯文本', value: 2 },
									]"
							/></FormItem>
							<FormItem name="content" label="模板内容">
								<TemplateEditor v-if="state.contentType === 1" ref="richEditor" :value="state.draft.content" :disabled="editorReadOnly" @update:value="session.contentChanged" />
								<Input.TextArea v-else :value="state.draft.content" :readonly="editorReadOnly" :auto-size="{ minRows: 10, maxRows: 24 }" @update:value="plainContentChanged" />
							</FormItem>
							<div v-if="state.editorKind !== 'preview'" class="template-insert template-actions">
								<Input v-model:value="parameterToInsert" aria-label="待插入参数名" placeholder="参数名" :disabled="editorReadOnly" />
								<Button :auto-insert-space="false" :disabled="editorReadOnly || !parameterToInsert.trim()" @click="insertParameter">插入参数</Button>
							</div>
							<section v-if="permissions.preview" class="template-preview" aria-label="模板预览参数">
								<div class="template-parameter-heading">
									<h3>预览参数</h3>
									<Button :auto-insert-space="false" :disabled="state.renderBusy || state.saveBusy" @click="session.addParameter">添加预览参数</Button>
								</div>
								<p class="template-help">参数名对应 @(参数名)，参数值按字符串发送。重复占位符共用一个参数。</p>
								<div v-for="(parameter, index) in state.parameters" :key="parameter.id" class="template-parameter-row">
									<Input v-model:value="parameter.key" :aria-label="`预览参数名 ${String(index + 1)}`" :disabled="state.renderBusy || state.saveBusy" placeholder="参数名" />
									<Input v-model:value="parameter.value" :aria-label="`预览参数值 ${String(index + 1)}`" :disabled="state.renderBusy || state.saveBusy" placeholder="字符串参数值" />
									<Button
										danger
										:auto-insert-space="false"
										:aria-label="`删除预览参数 ${String(index + 1)}`"
										:disabled="state.renderBusy || state.saveBusy"
										@click="session.removeParameter(parameter.id)"
										>删除参数</Button
									>
								</div>
								<Alert v-if="state.renderError" type="error" show-icon aria-label="模板渲染错误" :title="state.renderError" class="template-error" />
								<Button type="primary" :auto-insert-space="false" :loading="state.renderBusy" :disabled="state.saveBusy" @click="session.render">渲染模板</Button>
								<div v-if="state.rendered !== undefined" class="template-render-result" aria-label="渲染结果">
									<h3>渲染结果</h3>
									<iframe v-if="state.renderedContentType === 1" title="富文本渲染预览" sandbox="" referrerpolicy="no-referrer" :srcdoc="renderedDocument" />
									<pre v-else aria-label="纯文本渲染预览">{{ state.rendered }}</pre>
									<details>
										<summary>查看原始输出</summary>
										<pre aria-label="原始渲染输出">{{ state.rendered }}</pre>
									</details>
								</div>
							</section>
						</div>
					</template>
				</Tabs>
				<div class="template-editor-footer">
					<Button :auto-insert-space="false" :disabled="state.saveBusy" @click="session.closeEditor">取消</Button
					><Button v-if="showSave" type="primary" html-type="submit" :auto-insert-space="false" :loading="state.saveBusy" :disabled="state.renderBusy">保存模板</Button>
				</div>
			</Form>
		</Modal>

		<Modal
			:open="!!state.deleteTarget"
			title="删除模板"
			:footer="null"
			destroy-on-hidden
			:mask-closable="false"
			:closable="!state.deleteBusy"
			:keyboard="!state.deleteBusy"
			@cancel="session.cancelDelete"
		>
			<p>确认删除模板“{{ state.deleteTarget?.name }}”？</p>
			<Alert v-if="state.deleteError" type="error" show-icon aria-label="模板操作错误" :title="state.deleteError" />
			<div class="template-editor-footer">
				<Button :auto-insert-space="false" :disabled="state.deleteBusy" @click="session.cancelDelete">取消</Button
				><Button type="primary" danger :auto-insert-space="false" :loading="state.deleteBusy" @click="session.confirmDelete">确认删除</Button>
			</div>
		</Modal>
	</div>
</template>

<style scoped>
.template-page {
	padding: 16px;
	min-width: 0;
}
.template-query {
	gap: 12px 0;
	margin-bottom: 16px;
}
.template-query :deep(.ant-input),
.template-query :deep(.ant-select) {
	width: 170px;
}
.template-actions,
.template-toolbar,
.template-parameter-heading {
	display: flex;
	align-items: center;
	gap: 8px;
}
.template-toolbar {
	margin-block: 12px;
}
.template-base-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0 20px;
}
.template-editor-footer {
	display: flex;
	justify-content: flex-end;
	gap: 8px;
	margin-top: 20px;
}
.template-error {
	margin-bottom: 16px;
}
.template-insert {
	margin-bottom: 20px;
}
.template-insert :deep(.ant-input) {
	width: 230px;
}
.template-preview {
	border-top: 1px solid hsl(var(--border));
	padding-top: 16px;
}
.template-parameter-heading {
	justify-content: space-between;
}
.template-parameter-heading h3,
.template-render-result h3 {
	margin: 0;
	font-weight: 600;
}
.template-help {
	color: hsl(var(--muted-foreground));
	margin-block: 8px 12px;
}
.template-parameter-row {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 2fr) auto;
	gap: 8px;
	margin-bottom: 12px;
}
.template-render-result {
	margin-top: 20px;
}
.template-render-result iframe {
	width: 100%;
	min-height: 220px;
	border: 1px solid hsl(var(--border));
	border-radius: 6px;
	margin-top: 12px;
	background: white;
}
.template-render-result pre {
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	padding: 16px;
	background: hsl(var(--muted));
	border-radius: 6px;
	margin-top: 12px;
}
.template-render-result details {
	margin-top: 12px;
}
.template-render-result summary {
	cursor: pointer;
	color: hsl(var(--muted-foreground));
}
@media (max-width: 700px) {
	.template-base-grid {
		grid-template-columns: 1fr;
	}
	.template-parameter-row {
		grid-template-columns: 1fr;
	}
}
</style>
