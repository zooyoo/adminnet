<script setup lang="ts">
import type { FormProps, TableProps } from 'antdv-next';

import type { OpenAccessId, OpenAccessMethod, OpenAccessRow } from '#/api/system/open-access';

import { computed, h, onActivated, onDeactivated, onMounted, onScopeDispose, reactive, watch } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Card, Form, FormItem, Input, Modal, Select, Table } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { openAccessApi } from '#/api/system/open-access';

import HelpView from './help-view.vue';
import { createOpenAccessState, OPEN_ACCESS_METHODS, OpenAccessSession, randomNonce, timestampSeconds } from './open-access';

const { hasAccessByCodes } = useAccess();
const userStore = useUserStore();
const permissions = computed(() => ({
	page: hasAccessByCodes(['sysOpenAccess:page']),
	add: hasAccessByCodes(['sysOpenAccess:add']),
	update: hasAccessByCodes(['sysOpenAccess:update']),
	delete: hasAccessByCodes(['sysOpenAccess:delete']),
}));
const identity = computed(() => {
	const user = userStore.userInfo;
	return [user?.userId, user?.tenantId, user?.currentTenantId, user?.accountType].join(':');
});
const state = reactive(createOpenAccessState());
const session = new OpenAccessSession(state, { api: openAccessApi, boundary: sessionBoundary, identity: () => identity.value, permissions: () => permissions.value });
let visible = false;
function activate() {
	visible = true;
	session.activate();
}
function deactivate() {
	visible = false;
	session.deactivate();
}
watch([identity, permissions], () => session.contextChanged(visible), { flush: 'sync' });
onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onScopeDispose(() => session.dispose());

const columns: TableProps<OpenAccessRow>['columns'] = [
	{ title: '序号', key: 'sequence', width: 70 },
	{ title: '身份标识', dataIndex: 'accessKey', key: 'accessKey', width: 220 },
	{ title: '密钥', dataIndex: 'accessSecret', key: 'accessSecret', width: 230 },
	{ title: '绑定用户', dataIndex: 'bindUserAccount', key: 'bindUserAccount', width: 150 },
	{ title: '绑定租户', dataIndex: 'bindTenantName', key: 'bindTenantName', width: 150 },
	{ title: '修改记录', key: 'modification', width: 210 },
	{ title: '操作', key: 'actions', width: 240, fixed: 'right' },
];
const pagination = computed(() => ({
	current: state.page,
	pageSize: state.pageSize,
	total: state.total,
	showSizeChanger: true,
	pageSizeOptions: [10, 20, 50, 100],
	showTotal: (total: number) => `共 ${total} 条`,
}));
const tenantOptions = computed(() => state.tenants.map((tenant) => ({ label: tenant.name, value: tenant.id })));
const userOptions = computed(() => state.users.map((user) => ({ label: user.realName ? `${user.account}（${user.realName}）` : user.account, value: user.id })));
const methodOptions = OPEN_ACCESS_METHODS.map((method, value) => ({ label: method, value }));
const editTitle = computed(() => (state.draft.id === undefined ? '添加开放接口身份' : '编辑开放接口身份'));
const saveDisabled = computed(() => state.tenantsBusy || state.usersBusy || state.secretBusy || state.saveBusy);
const renderRequiredMark: NonNullable<FormProps['requiredMark']> = (label, { required }) =>
	h('span', [required ? h('span', { 'aria-hidden': true, style: { color: 'var(--ant-color-error, #ff4d4f)', marginInlineEnd: '4px' } }, '*') : null, label]);
const getText = (event: Event) => (event.target as HTMLInputElement).value;
function changePage(value: { current?: number; pageSize?: number }) {
	state.page = value.current ?? 1;
	state.pageSize = value.pageSize ?? 50;
	void session.loadPage();
}
function chooseTenant(value: unknown) {
	session.chooseTenant(value as OpenAccessId | undefined);
}
function chooseUser(value: unknown) {
	session.updateDraft({ bindUserId: value as OpenAccessId | undefined });
}
function chooseMethod(value: unknown) {
	session.updateSignature({ method: value as OpenAccessMethod });
}
function getNonce() {
	try {
		session.updateSignature({ nonce: randomNonce() });
	} catch {
		state.signatureError = '随机数生成失败，请重试';
	}
}
function modification(row: OpenAccessRow) {
	const parts = [row.updateUserName || row.createUserName, row.updateTime || row.createTime].filter(Boolean);
	return parts.join(' / ') || '—';
}
</script>

<template>
	<Page class="open-access-page" title="开放接口身份" description="管理开放接口身份、租户用户绑定及请求签名。">
		<Alert v-if="!permissions.page" type="warning" title="暂无开放接口身份查看权限" show-icon />
		<Card v-else>
			<Form name="open-access-filter" :colon="false" layout="inline" :model="state" @finish="session.search()">
				<FormItem name="filter" label="筛选身份标识">
					<Input v-model:value="state.filter" allow-clear placeholder="请输入身份标识" autocomplete="off" />
				</FormItem>
				<FormItem>
					<div class="open-access-toolbar">
						<Button type="primary" html-type="submit" :auto-insert-space="false" :loading="state.listBusy">查询</Button>
						<Button :auto-insert-space="false" @click="session.search(true)">重置</Button>
						<Button v-if="permissions.add" type="primary" :auto-insert-space="false" @click="session.openEditor()">新增</Button>
						<Button :auto-insert-space="false" @click="state.helpOpen = true">说明</Button>
					</div>
				</FormItem>
			</Form>
			<Alert v-if="state.listError" class="open-access-status" type="error" :title="state.listError" show-icon />
			<Alert v-if="state.notice" class="open-access-status" type="success" :title="state.notice" show-icon />
			<Table :columns="columns" :data-source="state.items" row-key="id" :loading="state.listBusy" :pagination="pagination" :scroll="{ x: 1270 }" @change="changePage">
				<template #bodyCell="{ column, record, index }">
					<template v-if="column.key === 'sequence'">{{ (state.page - 1) * state.pageSize + index + 1 }}</template>
					<template v-else-if="column.key === 'modification'">{{ modification(record) }}</template>
					<template v-else-if="column.key === 'actions'">
						<div class="open-access-actions">
							<Button v-if="permissions.update" type="link" size="small" :auto-insert-space="false" :disabled="record.status === 1" @click="session.openEditor(record)">编辑</Button>
							<Button v-if="permissions.delete" type="link" size="small" danger :auto-insert-space="false" :disabled="record.status === 1" @click="session.requestDelete(record)">删除</Button>
							<Button type="link" size="small" :auto-insert-space="false" @click="session.openSignature(record)">生成签名</Button>
						</div>
					</template>
				</template>
			</Table>
		</Card>

		<Modal :open="state.editorOpen" :title="editTitle" :width="620" :mask-closable="false" :closable="!state.saveBusy" destroy-on-hidden @cancel="session.closeEditor()">
			<Alert v-if="state.editorError" class="open-access-status" type="error" :title="state.editorError" show-icon />
			<Form name="open-access-editor" :colon="false" :required-mark="renderRequiredMark" layout="vertical" :model="state.draft" :disabled="state.saveBusy" autocomplete="off" @finish="session.save()">
				<FormItem name="accessKey" label="身份标识" required :help="state.draftErrors.accessKey" :validate-status="state.draftErrors.accessKey ? 'error' : undefined">
					<Input :value="state.draft.accessKey" autocomplete="off" @change="session.updateDraft({ accessKey: getText($event) })" />
				</FormItem>
				<FormItem name="accessSecret" label="密钥" required :help="state.draftErrors.accessSecret" :validate-status="state.draftErrors.accessSecret ? 'error' : undefined">
					<Input :value="state.draft.accessSecret" autocomplete="off" @change="session.updateDraft({ accessSecret: getText($event) })">
						<template #suffix>
							<Button type="link" size="small" :auto-insert-space="false" :loading="state.secretBusy" :disabled="state.saveBusy" @click="session.generateSecret()">生成密钥</Button>
						</template>
					</Input>
				</FormItem>
				<FormItem name="bindTenantId" label="绑定租户" required :help="state.draftErrors.bindTenantId" :validate-status="state.draftErrors.bindTenantId ? 'error' : undefined">
					<Select
						:value="state.draft.bindTenantId"
						:options="tenantOptions"
						:show-search="{ optionFilterProp: 'label' }"
						:loading="state.tenantsBusy"
						:disabled="state.tenantsBusy || state.saveBusy"
						allow-clear
						@change="chooseTenant"
					/>
				</FormItem>
				<FormItem name="bindUserId" label="绑定用户" required :help="state.draftErrors.bindUserId" :validate-status="state.draftErrors.bindUserId ? 'error' : undefined">
					<Select
						:value="state.draft.bindUserId"
						:options="userOptions"
						:show-search="{ optionFilterProp: 'label' }"
						:loading="state.usersBusy"
						:disabled="state.draft.bindTenantId === undefined || state.usersBusy || state.saveBusy"
						allow-clear
						@change="chooseUser"
					/>
				</FormItem>
			</Form>
			<template #footer>
				<Button :auto-insert-space="false" :disabled="state.saveBusy" @click="session.closeEditor()">取消</Button>
				<Button type="primary" :auto-insert-space="false" :loading="state.saveBusy" :disabled="saveDisabled" @click="session.save()">保存</Button>
			</template>
		</Modal>

		<Modal :open="state.signatureOpen" title="生成签名" :width="700" :mask-closable="false" destroy-on-hidden @cancel="session.closeSignature()">
			<Alert v-if="state.signatureError" class="open-access-status" type="error" :title="state.signatureError" show-icon />
			<Form name="open-access-signature" :colon="false" layout="vertical" :model="state.signature" autocomplete="off">
				<FormItem name="accessKey" label="身份标识"><Input :value="state.signature.accessKey" readonly autocomplete="off" /></FormItem>
				<FormItem name="accessSecret" label="密钥"><Input :value="state.signature.accessSecret" readonly autocomplete="off" /></FormItem>
				<FormItem name="method" label="请求方式" :help="state.signatureErrors.method" :validate-status="state.signatureErrors.method ? 'error' : undefined">
					<Select :value="state.signature.method" :options="methodOptions" @change="chooseMethod" />
				</FormItem>
				<FormItem name="url" label="接口请求地址" :help="state.signatureErrors.url" :validate-status="state.signatureErrors.url ? 'error' : undefined">
					<Input :value="state.signature.url" placeholder="/api/example/action" autocomplete="off" @change="session.updateSignature({ url: getText($event) })" />
				</FormItem>
				<FormItem name="timestamp" label="时间戳" :help="state.signatureErrors.timestamp" :validate-status="state.signatureErrors.timestamp ? 'error' : undefined">
					<Input :value="state.signature.timestamp" inputmode="numeric" autocomplete="off" @change="session.updateSignature({ timestamp: getText($event) })">
						<template #suffix>
							<Button type="link" size="small" :auto-insert-space="false" @click="session.updateSignature({ timestamp: timestampSeconds() })">获取时间戳</Button>
						</template>
					</Input>
				</FormItem>
				<FormItem name="nonce" label="随机数" :help="state.signatureErrors.nonce" :validate-status="state.signatureErrors.nonce ? 'error' : undefined">
					<Input :value="state.signature.nonce" inputmode="numeric" autocomplete="off" @change="session.updateSignature({ nonce: getText($event) })">
						<template #suffix>
							<Button type="link" size="small" :auto-insert-space="false" @click="getNonce">获取随机数</Button>
						</template>
					</Input>
				</FormItem>
				<FormItem name="sign" label="签名"><Input :value="state.sign" readonly autocomplete="off" /></FormItem>
				<p class="open-access-hint" aria-live="polite">{{ state.signatureBusy ? '正在生成签名…' : '参数填写完整后自动生成；修改任一参数会立即清除旧签名。' }}</p>
			</Form>
			<template #footer>
				<Button :auto-insert-space="false" @click="session.closeSignature()">关闭</Button>
				<Button type="primary" :auto-insert-space="false" :loading="state.signatureBusy" :disabled="Object.keys(state.signatureErrors).length > 0" @click="session.generateSignature()"
					>生成签名</Button
				>
			</template>
		</Modal>

		<Modal :open="state.deleteId !== undefined" title="删除开放接口身份" :mask-closable="false" :closable="!state.deleteBusy" destroy-on-hidden @cancel="session.cancelDelete()">
			<p>确定删除这条开放接口身份吗？</p>
			<Alert v-if="state.deleteError" type="error" :title="state.deleteError" show-icon />
			<template #footer>
				<Button :auto-insert-space="false" :disabled="state.deleteBusy" @click="session.cancelDelete()">取消</Button>
				<Button type="primary" danger :auto-insert-space="false" :loading="state.deleteBusy" @click="session.confirmDelete()">删除</Button>
			</template>
		</Modal>
		<HelpView :open="state.helpOpen" @close="state.helpOpen = false" />
	</Page>
</template>

<style scoped>
.open-access-toolbar,
.open-access-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
}
.open-access-status {
	margin-bottom: 16px;
}
.open-access-hint {
	color: hsl(var(--muted-foreground));
}
</style>
