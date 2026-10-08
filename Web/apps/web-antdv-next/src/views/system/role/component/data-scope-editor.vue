<script setup lang="ts">
import type { RoleOrgInput, RoleRecord } from '#/api/system/access-admin';
import type { TreeOption } from '#/utils/admin-tree';

import { computed, ref } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Form, FormItem, Modal, Select, Spin, Tree } from 'antdv-next';

import { grantDataScope, orgTree, roleOrgIds } from '#/api/system/access-admin';
import { treeOptions } from '#/utils/admin-tree';

const emit = defineEmits<{ saved: [] }>();
const user = useUserStore();
const options = computed(() => [
	{ label: '全部数据', value: 1, disabled: user.userInfo?.accountType !== 999 },
	{ label: '本部门及以下数据', value: 2 },
	{ label: '本部门数据', value: 3 },
	{ label: '仅本人数据', value: 4 },
	{ label: '自定义数据', value: 5 },
]);
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const error = ref('');
const value = ref<RoleOrgInput>({ id: 0, dataScope: 4 });
const checked = ref<number[]>([]);
const nodes = ref<TreeOption[]>([]);
let generation = 0;

async function show(record: RoleRecord) {
	if (!record.id) return;
	const current = ++generation;
	value.value = { id: record.id, dataScope: record.dataScope ?? 4 };
	checked.value = [];
	nodes.value = [];
	error.value = '';
	open.value = true;
	loading.value = true;
	try {
		const [tree, ids] = await Promise.all([orgTree(record.tenantId ?? undefined), roleOrgIds(record.id)]);
		if (current !== generation || !open.value) return;
		nodes.value = treeOptions(tree);
		checked.value = ids;
	} catch (cause) {
		if (current === generation) error.value = cause instanceof Error ? cause.message : '机构权限加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}

async function save() {
	if (loading.value || saving.value || error.value) return;
	saving.value = true;
	try {
		await grantDataScope({ ...value.value, orgIdList: value.value.dataScope === 5 ? [...checked.value] : [] });
		open.value = false;
		emit('saved');
	} catch {
		// 请求失败时保留当前授权选择。
	} finally {
		saving.value = false;
	}
}

defineExpose({ show });
</script>

<template>
	<Modal v-model:open="open" title="授权数据范围" :width="500" :mask-closable="false" :confirm-loading="saving" :ok-button-props="{ disabled: loading || !!error }" @ok="save" @cancel="generation++">
		<Alert v-if="error" :message="error" type="error" show-icon />
		<Spin :spinning="loading">
			<Form :model="value" layout="vertical" name="data-scope">
				<FormItem label="数据范围" name="dataScope"><Select v-model:value="value.dataScope" :options="options" :virtual="false" /></FormItem>
				<FormItem v-if="value.dataScope === 5" label="机构列表">
					<Tree v-if="!loading" v-model:checked-keys="checked" :tree-data="nodes" checkable :selectable="false" default-expand-all style="max-height: 350px; overflow: auto" />
				</FormItem>
			</Form>
		</Spin>
	</Modal>
</template>
