<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { OrgRecord, UpdateOrgInput } from '#/api/system/access-admin';
import type { TreeOption } from '#/utils/admin-tree';

import { onBeforeUnmount, ref } from 'vue';

import { Alert, Form, FormItem, Input, InputNumber, Modal, RadioGroup, Select, Spin, TextArea, TreeSelect } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { orgList, saveOrg } from '#/api/system/access-admin';
import { useDraggableModal } from '#/components/admin/draggable-modal';
import { useReferenceStore } from '#/store/reference';
import { treeOptions } from '#/utils/admin-tree';

const emit = defineEmits<{ saved: [] }>();
const reference = useReferenceStore();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const title = ref('');
const drag = useDraggableModal(open, saving);
const form = ref<FormInstance>();
const parents = ref<TreeOption[]>([]);
const value = ref<UpdateOrgInput>({ name: '', code: '', status: 1, orderNo: 100 });
let generation = 0;
let editorSession = sessionBoundary.version;
let editorBoundary: AbortController | undefined;

function invalidateEditor() {
	generation += 1;
	open.value = false;
	loading.value = false;
	saving.value = false;
	if (editorBoundary) {
		editorBoundary.signal.removeEventListener('abort', invalidateEditor);
		sessionBoundary.release(editorBoundary);
		editorBoundary = undefined;
	}
}

function close() {
	if (!saving.value) invalidateEditor();
}

async function show(record?: OrgRecord, tenantId?: number, copy = false, pid = 0) {
	if (saving.value) return;
	invalidateEditor();
	editorBoundary = new AbortController();
	editorBoundary.signal.addEventListener('abort', invalidateEditor);
	sessionBoundary.track(editorBoundary);
	const current = generation;
	const version = sessionBoundary.version;
	editorSession = version;
	title.value = record ? (copy ? '复制机构' : '编辑机构') : '添加机构';
	value.value = record
		? {
				id: copy ? undefined : record.id,
				pid: record.pid,
				name: copy ? '' : record.name,
				code: record.code,
				level: record.level,
				type: record.type,
				directorId: record.directorId,
				status: record.status,
				orderNo: record.orderNo,
				remark: record.remark,
				tenantId: record.tenantId,
			}
		: { name: '', code: '', status: 1, orderNo: 100, level: 1, pid, tenantId };
	parents.value = [];
	error.value = '';
	loading.value = true;
	open.value = true;
	try {
		const [tree] = await Promise.all([orgList(value.value.tenantId ?? tenantId), reference.load()]);
		if (current !== generation || version !== sessionBoundary.version || !open.value) return;
		parents.value = treeOptions(tree, value.value.id, value.value.tenantId ?? undefined);
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation && version === sessionBoundary.version && open.value) error.value = cause instanceof Error ? cause.message : '机构信息加载失败';
	} finally {
		if (current === generation && version === sessionBoundary.version) loading.value = false;
	}
}

async function save() {
	if (loading.value || saving.value || error.value || !open.value || editorSession !== sessionBoundary.version) return;
	const current = generation;
	const version = editorSession;
	const valid = () => current === generation && version === sessionBoundary.version && open.value;
	saving.value = true;
	try {
		await form.value?.validate();
		if (!valid()) return;
		await saveOrg({ ...value.value, pid: value.value.pid ?? 0 });
		if (!valid()) return;
		invalidateEditor();
		emit('saved');
	} catch {
		// 校验错误由表单显示，接口错误由统一请求层显示。
	} finally {
		if (valid()) saving.value = false;
	}
}

onBeforeUnmount(invalidateEditor);
defineExpose({ show });
</script>

<template>
	<Modal
		:open="open"
		:modal-render="drag.render"
		:width="640"
		centered
		:styles="{ body: { maxHeight: 'calc(100dvh - 180px)', overflowY: 'auto' } }"
		:closable="!saving"
		:keyboard="!saving"
		:cancel-button-props="{ disabled: saving }"
		:mask-closable="false"
		:confirm-loading="saving"
		:ok-button-props="{ disabled: loading || saving || !!error }"
		@ok="save"
		@cancel="close"
	>
			<template #title><div role="button" tabindex="0" :aria-label="title" :style="{ cursor: saving ? 'default' : 'move', touchAction: 'none', userSelect: 'none' }" @pointerdown="drag.start" @pointermove="drag.move" @pointerup="drag.finish" @pointercancel="drag.finish" @keydown="drag.keyboard">{{ title }}</div></template>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading">
			<Form ref="form" name="org-editor" :model="value" layout="vertical" :disabled="saving">
				<FormItem name="pid" label="上级机构"
					><TreeSelect v-model:value="value.pid" :tree-data="[{ key: 0, value: 0, title: '根节点', children: parents }]" tree-default-expand-all allow-clear show-search tree-node-filter-prop="title"
						><template #treeTitleRender="node"
							>{{ node.title }}<span v-if="node.children?.length"> ({{ node.children.length }})</span></template
						>
					</TreeSelect></FormItem
				>
				<FormItem name="name" label="机构名称" :rules="[{ required: true, message: '请输入机构名称' }]"><Input v-model:value="value.name" allow-clear /></FormItem>
				<FormItem name="code" label="机构编码" :rules="[{ required: true, message: '请输入机构编码' }]"><Input v-model:value="value.code" allow-clear /></FormItem>
				<div class="grid grid-cols-2 gap-4">
					<FormItem name="level" label="级别"><InputNumber v-model:value="value.level" class="w-full" /></FormItem>
					<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
				</div>
				<FormItem name="type" label="机构类型"><Select v-model:value="value.type" :options="reference.options('org_type')" show-search option-filter-prop="label" allow-clear /></FormItem>
				<FormItem name="status" label="状态"
					><RadioGroup
						v-model:value="value.status"
						:options="[
							{ label: '启用', value: 1 },
							{ label: '禁用', value: 2 },
						]"
				/></FormItem>
				<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="2" allow-clear /></FormItem>
			</Form>
		</Spin>
	</Modal>
</template>
