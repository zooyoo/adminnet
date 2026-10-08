<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { MenuRecord, UpdateMenuInput } from '#/api/system/access-admin';
import type { TreeOption } from '#/utils/admin-tree';

import { ref } from 'vue';

import { IconPicker } from '@vben/common-ui';

import { Alert, Form, FormItem, Input, InputNumber, Modal, RadioGroup, Spin, Switch, TextArea, TreeSelect } from 'antdv-next';

import { menuList, saveMenu } from '#/api/system/access-admin';
import MultiLangInput from '#/components/admin/multi-lang-input.vue';
import { normalizeMenuIcon, treeOptions } from '#/utils/admin-tree';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const title = ref('');
const error = ref('');
const form = ref<FormInstance>();
const parents = ref<TreeOption[]>([]);
const value = ref<UpdateMenuInput>({ title: '', type: 2, status: 1, orderNo: 100, icon: '' });
let generation = 0;

async function show(record?: MenuRecord, tenantId?: number, copy = false) {
	const current = ++generation;
	title.value = record ? (copy ? '复制菜单' : '编辑菜单') : '添加菜单';
	value.value = {
		id: copy ? undefined : record?.id,
		pid: record?.pid ?? 0,
		title: copy ? '' : (record?.title ?? ''),
		type: record?.type ?? 2,
		name: record?.name ?? '',
		path: record?.path ?? '',
		component: record?.component ?? '',
		redirect: record?.redirect ?? '',
		permission: record?.permission ?? '',
		icon: normalizeMenuIcon(record?.icon),
		outLink: record?.outLink ?? '',
		isHide: record?.isHide ?? false,
		isKeepAlive: record?.isKeepAlive ?? true,
		isAffix: record?.isAffix ?? false,
		isIframe: record?.isIframe ?? false,
		status: record?.status ?? 1,
		orderNo: record?.orderNo ?? 100,
		remark: record?.remark ?? '',
		tenantId,
	};
	parents.value = [];
	error.value = '';
	open.value = true;
	loading.value = true;
	try {
		const rows = await menuList(tenantId);
		if (current !== generation || !open.value) return;
		parents.value = treeOptions(rows, value.value.id);
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '菜单树加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}

async function save() {
	if (loading.value || saving.value || error.value) return;
	try {
		await form.value?.validate();
	} catch {
		return;
	}
	saving.value = true;
	try {
		await saveMenu({ ...value.value, pid: value.value.pid ?? 0 });
		open.value = false;
		emit('saved');
	} catch {
		// 请求层已提示错误，保留编辑内容供重试。
	} finally {
		saving.value = false;
	}
}

defineExpose({ show });
</script>

<template>
	<Modal v-model:open="open" :title="title" :width="720" :mask-closable="false" :confirm-loading="saving" :ok-button-props="{ disabled: loading || !!error }" @ok="save" @cancel="generation++">
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading">
			<Form ref="form" :model="value" name="menu-editor" layout="vertical">
				<FormItem label="上级菜单" name="pid"
					><TreeSelect v-model:value="value.pid" :tree-data="[{ key: 0, value: 0, title: '根节点', children: parents }]" allow-clear show-search tree-node-filter-prop="title" tree-default-expand-all
				/></FormItem>
				<FormItem label="菜单类型" name="type" :rules="[{ required: true }]"
					><RadioGroup
						v-model:value="value.type"
						option-type="button"
						:options="[
							{ label: '目录', value: 1 },
							{ label: '菜单', value: 2 },
							{ label: '按钮', value: 3 },
						]"
				/></FormItem>
				<FormItem label="菜单名称" name="title" html-for="menu-title" :rules="[{ required: true, message: '请输入菜单名称' }]">
					<MultiLangInput id="menu-title" v-model="value.title" entity-name="SysMenu" field-name="Title" :entity-id="value.id" />
				</FormItem>
				<div v-if="value.type !== 3" class="menu-grid">
					<FormItem label="路由名称" name="name"><Input v-model:value="value.name" /></FormItem>
					<FormItem label="路由路径" name="path"><Input v-model:value="value.path" /></FormItem>
					<FormItem label="组件路径" name="component"><Input v-model:value="value.component" /></FormItem>
					<FormItem label="菜单图标" name="icon"><IconPicker :model-value="value.icon ?? ''" @update:model-value="value.icon = $event" /></FormItem>
					<FormItem label="重定向" name="redirect"><Input v-model:value="value.redirect" /></FormItem>
					<FormItem label="链接地址" name="outLink"><Input v-model:value="value.outLink" /></FormItem>
					<FormItem label="隐藏菜单" name="isHide"><Switch v-model:checked="value.isHide" /></FormItem>
					<FormItem label="缓存页面" name="isKeepAlive"><Switch v-model:checked="value.isKeepAlive" /></FormItem>
					<FormItem label="固定标签" name="isAffix"><Switch v-model:checked="value.isAffix" /></FormItem>
					<FormItem label="内嵌页面" name="isIframe"><Switch v-model:checked="value.isIframe" /></FormItem>
				</div>
				<FormItem v-else label="权限标识" name="permission"><Input v-model:value="value.permission" /></FormItem>
				<div class="menu-grid">
					<FormItem label="排序" name="orderNo"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
					<FormItem label="状态" name="status"
						><RadioGroup
							v-model:value="value.status"
							:options="[
								{ label: '启用', value: 1 },
								{ label: '禁用', value: 2 },
							]"
					/></FormItem>
				</div>
				<FormItem label="备注" name="remark"><TextArea v-model:value="value.remark" :rows="2" /></FormItem>
			</Form>
		</Spin>
	</Modal>
</template>

<style scoped>
.menu-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0 16px;
}
@media (max-width: 600px) {
	.menu-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
