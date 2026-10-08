<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { RoleRecord, UpdateRoleInput } from '#/api/system/access-admin';
import type { TreeOption } from '#/utils/admin-tree';

import { ref } from 'vue';

import { Alert, Form, FormItem, Input, InputNumber, Modal, RadioGroup, Spin, TextArea, Tree } from 'antdv-next';

import { menuList, roleMenuIds, saveRole } from '#/api/system/access-admin';
import { treeOptions } from '#/utils/admin-tree';

const emit = defineEmits<{ saved: [] }>();
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const form = ref<FormInstance>();
const value = ref<UpdateRoleInput>({ name: '', code: '', status: 1, orderNo: 100 });
const menus = ref<TreeOption[]>([]);
const checked = ref<number[]>([]);
let generation = 0;

async function show(record?: RoleRecord, tenantId?: number) {
	const current = ++generation;
	value.value = record
		? { id: record.id, name: record.name, code: record.code, status: record.status, orderNo: record.orderNo, remark: record.remark, tenantId: record.tenantId }
		: { name: '', code: '', status: 1, orderNo: 100, tenantId };
	checked.value = [];
	menus.value = [];
	error.value = '';
	open.value = true;
	loading.value = true;
	try {
		const [tree, ids] = await Promise.all([menuList(value.value.tenantId ?? tenantId), record?.id ? roleMenuIds(record.id) : Promise.resolve([])]);
		if (current !== generation || !open.value) return;
		menus.value = treeOptions(tree);
		checked.value = ids;
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '权限加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}

async function save() {
	if (saving.value || loading.value || error.value) return;
	try {
		await form.value?.validate();
	} catch {
		return;
	}
	saving.value = true;
	try {
		// 仅提交完整勾选节点，半选父级由后端补齐，避免授予未勾选兄弟节点。
		await saveRole({ ...value.value, menuIdList: [...checked.value] });
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
	<Modal
		v-model:open="open"
		:title="value.id ? '编辑角色' : '添加角色'"
		:width="700"
		:mask-closable="false"
		:confirm-loading="saving"
		:ok-button-props="{ disabled: loading || !!error }"
		@ok="save"
		@cancel="generation++"
	>
		<Alert v-if="error" :message="error" type="error" show-icon class="mb-3" />
		<Spin :spinning="loading">
			<Form ref="form" name="role-editor" :model="value" layout="vertical">
				<FormItem name="name" label="角色名称" :rules="[{ required: true, message: '请输入角色名称' }]"><Input v-model:value="value.name" /></FormItem>
				<FormItem name="code" label="角色编码" :rules="[{ required: true, message: '请输入角色编码' }]"
					><Input v-model:value="value.code" :disabled="!!value.id && value.code === 'sys_admin'"
				/></FormItem>
				<div class="grid grid-cols-2 gap-4">
					<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
					<FormItem name="status" label="状态"
						><RadioGroup
							v-model:value="value.status"
							:options="[
								{ label: '启用', value: 1 },
								{ label: '禁用', value: 2 },
							]"
					/></FormItem>
				</div>
				<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="2" /></FormItem>
				<FormItem label="菜单权限">
					<Tree v-if="!loading" v-model:checked-keys="checked" :tree-data="menus" :selectable="false" checkable default-expand-all class="permission-tree" />
				</FormItem>
			</Form>
		</Spin>
	</Modal>
</template>

<style scoped>
.permission-tree {
	width: 100%;
	max-height: 350px;
	overflow: auto;
}
</style>
