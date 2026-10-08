<script setup lang="ts">
import type { TenantRecord } from '#/api/system/tenant';
import type { TreeOption } from '#/utils/admin-tree';

import { ref } from 'vue';

import { Alert, Modal, Spin, Tree } from 'antdv-next';

import { menuList } from '#/api/system/access-admin';
import { grantTenantMenus, tenantMenuIds } from '#/api/system/tenant';
import { treeOptions } from '#/utils/admin-tree';

const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const id = ref(0);
const name = ref('');
const checked = ref<number[]>([]);
const nodes = ref<TreeOption[]>([]);
let generation = 0;
async function show(record: TenantRecord) {
	if (!record.id) return;
	const current = ++generation;
	id.value = record.id;
	name.value = record.name ?? '';
	open.value = true;
	loading.value = true;
	error.value = '';
	checked.value = [];
	nodes.value = [];
	try {
		const [menus, ids] = await Promise.all([menuList(), tenantMenuIds(record.id)]);
		if (current !== generation || !open.value) return;
		nodes.value = treeOptions(menus);
		checked.value = ids;
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '授权加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}
async function save() {
	if (loading.value || saving.value || error.value) return;
	saving.value = true;
	try {
		await grantTenantMenus(id.value, [...checked.value]);
		open.value = false;
	} catch {
		/* 请求层已提示错误，保留选择。 */
	} finally {
		saving.value = false;
	}
}
defineExpose({ show });
</script>

<template>
	<Modal
		v-model:open="open"
		:title="`授权菜单：${name}`"
		:width="620"
		:mask-closable="false"
		:confirm-loading="saving"
		:ok-button-props="{ disabled: loading || !!error }"
		@ok="save"
		@cancel="generation++"
	>
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading"
			><Tree v-if="!loading" v-model:checked-keys="checked" :tree-data="nodes" checkable :selectable="false" default-expand-all style="max-height: 450px; overflow: auto"
		/></Spin>
	</Modal>
</template>
