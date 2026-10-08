<script setup lang="ts">
import type { FormInstance } from 'antdv-next';

import type { UserDraft, UserRecord } from '#/api/system/user';

import { computed, ref } from 'vue';

import { createIconifyIcon, Plus } from '@vben/icons';
import { useUserStore } from '@vben/stores';

import { Alert, Button, DatePicker, Divider, Form, FormItem, Input, InputNumber, Modal, RadioGroup, Select, Spin, TabPane, Tabs, TextArea, Transfer, TreeSelect } from 'antdv-next';

import { saveUser, userAssignments, userEditorOptions } from '#/api/system/user';
import { useReferenceStore } from '#/store/reference';
import { treeOptions } from '#/utils/admin-tree';

import { createUserDraft, validateAssignments } from '../user-form';

const emit = defineEmits<{ saved: [] }>();
const user = useUserStore();
const reference = useReferenceStore();
const Trash = createIconifyIcon('lucide:trash-2');
const open = ref(false);
const loading = ref(false);
const saving = ref(false);
const loadError = ref('');
const validationError = ref('');
const title = ref('');
const activeTab = ref('base');
const form = ref<FormInstance>();
const value = ref<UserDraft>(createUserDraft());
const options = ref<Awaited<ReturnType<typeof userEditorOptions>>>({ orgs: [], positions: [], roles: [], languages: [] });
const orgs = computed(() => treeOptions(options.value.orgs, undefined, value.value.tenantId ?? undefined));
const positions = computed(() => options.value.positions.map((item) => ({ label: item.name, value: item.id })));
const roles = computed(() => options.value.roles.map((item) => ({ key: String(item.id), title: item.name ?? String(item.id) })));
const assigned = computed({
	get: () => (value.value.roleIdList ?? []).map(String),
	set: (keys: Array<number | string>) => {
		value.value.roleIdList = keys.map(Number);
	},
});
const accountTypes = computed(() => reference.options('AccountTypeEnum').filter((item) => item.value !== 999 && (item.value !== 888 || user.userInfo?.accountType === 999)));
let generation = 0;

async function show(record?: UserRecord, copy = false, tenantId?: number, orgId?: number) {
	const current = ++generation;
	value.value = createUserDraft(record, copy, tenantId, orgId);
	title.value = record ? (copy ? '复制账号' : '编辑账号') : '添加账号';
	open.value = true;
	loading.value = true;
	loadError.value = '';
	validationError.value = '';
	activeTab.value = 'base';
	options.value = { orgs: [], positions: [], roles: [], languages: [] };
	try {
		const [loaded, assignments] = await Promise.all([
			userEditorOptions(value.value.tenantId ?? undefined),
			record?.id ? userAssignments(record.id) : Promise.resolve({ roleIdList: [], extOrgIdList: [] }),
			reference.load(),
		]);
		if (current !== generation || !open.value) return;
		options.value = loaded;
		value.value.roleIdList = [...assignments.roleIdList];
		value.value.extOrgIdList = assignments.extOrgIdList.map((item) => ({ orgId: item.orgId, posId: item.posId, jobNum: item.jobNum, posLevel: item.posLevel, joinDate: item.joinDate }));
		if (!value.value.langCode) value.value.langCode = loaded.languages[0]?.code;
		form.value?.clearValidate();
	} catch (cause) {
		if (current === generation) loadError.value = cause instanceof Error ? cause.message : '账号信息加载失败';
	} finally {
		if (current === generation) loading.value = false;
	}
}

async function save() {
	if (loading.value || saving.value || loadError.value) return;
	validationError.value = validateAssignments(value.value);
	if (validationError.value) {
		activeTab.value = 'base';
		return;
	}
	try {
		await form.value?.validate();
	} catch {
		activeTab.value = 'base';
		return;
	}
	saving.value = true;
	try {
		await saveUser(value.value);
		open.value = false;
		emit('saved');
	} catch {
		/* 请求层提示错误，保留编辑内容。 */
	} finally {
		saving.value = false;
	}
}

defineExpose({ show });
</script>

<template>
	<Modal v-model:open="open" :title="title" :width="780" :mask-closable="false" :confirm-loading="saving" :ok-button-props="{ disabled: loading || !!loadError }" @ok="save" @cancel="generation++">
		<Alert v-if="loadError || validationError" :message="loadError || validationError" type="error" show-icon class="mb-3" />
		<Spin :spinning="loading">
			<Form ref="form" name="user-editor" :model="value" layout="vertical">
				<Tabs v-model:active-key="activeTab">
					<TabPane key="base" tab="基础信息" force-render>
						<div class="field-grid">
							<FormItem name="account" label="账号名称" :rules="[{ required: true, message: '请输入账号名称' }]"
								><Input v-model:value="value.account" :disabled="!!value.id" autocomplete="off"
							/></FormItem>
							<FormItem name="nickName" label="昵称"><Input v-model:value="value.nickName" /></FormItem>
							<FormItem name="phone" label="手机号码" :rules="[{ required: true, message: '请输入手机号码' }]"><Input v-model:value="value.phone" /></FormItem>
							<FormItem name="realName" label="真实姓名" :rules="[{ required: true, message: '请输入真实姓名' }]"><Input v-model:value="value.realName" /></FormItem>
							<FormItem name="accountType" label="账号类型" :rules="[{ required: true, message: '请选择账号类型' }]"
								><Select v-model:value="value.accountType" :options="accountTypes" :virtual="false"
							/></FormItem>
							<FormItem name="email" label="邮箱"><Input v-model:value="value.email" /></FormItem>
							<FormItem name="langCode" label="语言" :rules="[{ required: true, message: '请选择语言' }]"
								><Select v-model:value="value.langCode" :options="options.languages.map((item) => ({ label: item.label, value: item.code }))" :virtual="false"
							/></FormItem>
							<FormItem name="homepage" label="个性化首页"><Input v-model:value="value.homepage" /></FormItem>
							<FormItem name="orderNo" label="排序"><InputNumber v-model:value="value.orderNo" class="w-full" /></FormItem>
						</div>
						<Divider>机构组织</Divider>
						<div class="field-grid">
							<FormItem name="orgId" label="所属机构" :rules="[{ required: true, message: '请选择所属机构' }]"
								><TreeSelect v-model:value="value.orgId" :tree-data="orgs" tree-default-expand-all show-search tree-node-filter-prop="title"
							/></FormItem>
							<FormItem name="posId" label="职位" :rules="[{ required: true, message: '请选择职位' }]"
								><Select v-model:value="value.posId" :options="positions" show-search option-filter-prop="label" :virtual="false"
							/></FormItem>
							<FormItem name="jobNum" label="工号"><Input v-model:value="value.jobNum" /></FormItem>
							<FormItem name="domainAccount" label="域账号"><Input v-model:value="value.domainAccount" /></FormItem>
							<FormItem name="joinDate" label="入职日期"><DatePicker v-model:value="value.joinDate" value-format="YYYY-MM-DD" class="w-full" /></FormItem>
						</div>
						<Divider>附属机构</Divider>
						<Button type="dashed" class="mb-4" @click="(value.extOrgIdList ??= []).push({})"><Plus :size="16" />增加附属机构</Button>
						<div v-for="(row, index) in value.extOrgIdList" :key="index" class="extra-org">
							<FormItem :name="['extOrgIdList', index, 'orgId']" :label="`附属机构 ${index + 1}`" :rules="[{ required: true, message: '请选择机构' }]"
								><TreeSelect v-model:value="row.orgId" :tree-data="orgs" tree-default-expand-all
							/></FormItem>
							<FormItem :name="['extOrgIdList', index, 'posId']" :label="`附属职位 ${index + 1}`" :rules="[{ required: true, message: '请选择职位' }]"
								><Select v-model:value="row.posId" :options="positions" :virtual="false"
							/></FormItem>
							<Button danger type="text" :aria-label="`删除附属机构 ${index + 1}`" @click="value.extOrgIdList?.splice(index, 1)"><Trash :size="16" /></Button>
						</div>
					</TabPane>
					<TabPane key="roles" tab="角色授权" force-render>
						<Transfer
							v-model:target-keys="assigned"
							:data-source="roles"
							:titles="['未授权', '已授权']"
							:actions="['授权', '撤销']"
							:styles="{ section: { flex: 1, minWidth: 0, height: 320 } }"
							:render="(item) => item.title"
							show-search
							class="role-transfer"
						/>
					</TabPane>
					<TabPane key="profile" tab="档案信息" force-render>
						<div class="field-grid">
							<FormItem name="cardType" label="证件类型"><Select v-model:value="value.cardType" :options="reference.options('CardTypeEnum')" /></FormItem>
							<FormItem name="idCardNum" label="证件号码"><Input v-model:value="value.idCardNum" /></FormItem>
							<FormItem name="birthday" label="出生日期"><DatePicker v-model:value="value.birthday" value-format="YYYY-MM-DD" class="w-full" /></FormItem>
							<FormItem name="sex" label="性别"><RadioGroup v-model:value="value.sex" :options="reference.options('GenderEnum')" /></FormItem>
							<FormItem name="age" label="年龄"><InputNumber v-model:value="value.age" :min="0" class="w-full" /></FormItem>
							<FormItem name="nation" label="民族"
								><Select v-model:value="value.nation" :options="reference.options('NationEnum').map((item) => ({ ...item, value: String(item.value) }))" allow-clear
							/></FormItem>
							<FormItem name="college" label="毕业学校"><Input v-model:value="value.college" /></FormItem>
							<FormItem name="cultureLevel" label="文化程度"><Select v-model:value="value.cultureLevel" :options="reference.options('CultureLevelEnum')" /></FormItem>
							<FormItem name="politicalOutlook" label="政治面貌"><Input v-model:value="value.politicalOutlook" /></FormItem>
							<FormItem name="officePhone" label="办公电话"><Input v-model:value="value.officePhone" /></FormItem>
							<FormItem name="emergencyContact" label="紧急联系人"><Input v-model:value="value.emergencyContact" /></FormItem>
							<FormItem name="emergencyPhone" label="联系人电话"><Input v-model:value="value.emergencyPhone" /></FormItem>
						</div>
						<FormItem name="address" label="地址"><TextArea v-model:value="value.address" :rows="2" /></FormItem>
						<FormItem name="emergencyAddress" label="联系人地址"><TextArea v-model:value="value.emergencyAddress" :rows="2" /></FormItem>
						<FormItem name="remark" label="备注"><TextArea v-model:value="value.remark" :rows="2" /></FormItem>
					</TabPane>
				</Tabs>
			</Form>
		</Spin>
	</Modal>
</template>

<style scoped>
.field-grid {
	display: grid;
	grid-template-columns: repeat(2, minmax(0, 1fr));
	gap: 0 16px;
}
.extra-org {
	display: grid;
	grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) 32px;
	align-items: center;
	gap: 10px;
}
.role-transfer {
	min-height: 330px;
	padding: 12px 0;
}
@media (max-width: 600px) {
	.field-grid {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
