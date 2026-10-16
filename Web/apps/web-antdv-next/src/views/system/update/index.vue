<script setup lang="ts">
import type { SystemUpdateAction } from './system-update';

import { computed, nextTick, onActivated, onDeactivated, onMounted, onUnmounted, ref, shallowRef, watch } from 'vue';

import { useAccess } from '@vben/access';
import { Page } from '@vben/common-ui';
import { useUserStore } from '@vben/stores';

import { Alert, Button, Card, Form, FormItem, Modal, Select } from 'antdv-next';

import { sessionBoundary } from '#/api/session';
import { clearSystemUpdateLogs, getSystemUpdateBackups, getSystemUpdateLogs, getSystemUpdateStatus, getSystemUpdateWebHookKey, restoreSystemUpdate, runSystemUpdate } from '#/api/system/update';
import { useActionCooldown } from '#/components/admin/action-cooldown';

import { canRunSystemUpdateAction, createSystemUpdateState, SystemUpdateSession } from './system-update';

defineOptions({ name: 'SystemUpdate' });

const { hasAccessByCodes } = useAccess();
const userStore = useUserStore();
const state = shallowRef(createSystemUpdateState());
const cooldown = useActionCooldown<SystemUpdateAction>(5000);
const canView = computed(() => hasAccessByCodes(['sysUpdate:list']) && hasAccessByCodes(['sysUpdate:logs']));
const can = (action: SystemUpdateAction) => hasAccessByCodes([`sysUpdate:${action}`]);
const permissionIdentity = computed(() => ['list', 'logs', 'update', 'restore', 'clear', 'webHookKey'].map((action) => hasAccessByCodes([`sysUpdate:${action}`])).join('|'));
const backupModel = computed(() => ({ fileName: state.value.selectedFileName }));
const backupOptions = computed(() => state.value.backups.map((item) => ({ value: item.fileName, label: `${item.fileName} · ${item.createTime}` })));
const restoreAllowed = computed(() => canView.value && can('restore') && canRunSystemUpdateAction(state.value, 'restore'));
let active = false;
const logElement = ref<HTMLElement>();
watch(
	() => state.value.logs,
	async () => {
		await nextTick();
		if (active && logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight;
	},
	{ flush: 'post' }
);

function createSession() {
	return new SystemUpdateSession({
		boundary: sessionBoundary,
		canView: () => canView.value,
		can,
		fetchStatus: getSystemUpdateStatus,
		fetchBackups: getSystemUpdateBackups,
		fetchLogs: getSystemUpdateLogs,
		update: runSystemUpdate,
		restore: restoreSystemUpdate,
		clear: clearSystemUpdateLogs,
		fetchWebHookKey: getSystemUpdateWebHookKey,
		writeClipboard: (key) => navigator.clipboard.writeText(key),
		onChange: (value) => {
			state.value = value;
		},
	});
}

let session = createSession();
const allowed = (action: SystemUpdateAction) => !cooldown.active.value.includes(action) && canView.value && can(action) && canRunSystemUpdateAction(state.value, action);
async function invoke(action: SystemUpdateAction) {
	if (!allowed(action) || !cooldown.begin(action)) return;
	switch (action) {
		case 'update':
			await session.update();
			break;
		case 'clear':
			await session.clearLogs();
			break;
		case 'webHookKey':
			await session.copyWebHookKey();
			break;
		case 'restore':
			session.requestRestore();
			break;
	}
}
function selectBackup(value: unknown) {
	session.selectBackup(typeof value === 'string' ? value : '');
}
function activate() {
	active = true;
	void session.activate();
}
function deactivate() {
	cooldown.clear();
	active = false;
	session.deactivate();
}

watch(
	[() => userStore.userInfo?.userId, permissionIdentity],
	() => {
		cooldown.clear();
		session.dispose();
		session = createSession();
		if (active) void session.activate();
	},
	{ flush: 'sync' }
);

onMounted(activate);
onActivated(activate);
onDeactivated(deactivate);
onUnmounted(() => {
	active = false;
	session.dispose();
});
</script>

<template>
	<Page class="system-update-page" content-class="system-update-content" title="系统更新" description="查看更新日志和备份记录，执行更新或还原已配置的目标。">
		<Alert v-if="!canView" title="无权查看系统更新" description="需要同时具备备份记录和更新日志的查看权限。" type="warning" show-icon />
		<template v-else>
			<Alert v-if="state.statusError" :title="state.statusError" type="error" show-icon />
			<Alert v-else-if="state.statusPhase !== 'ready'" title="正在读取系统更新状态" type="info" show-icon />
			<Alert v-else-if="!state.status?.enabled" title="系统更新暂不可用" :description="state.status?.reason || '尚未配置可用的更新目标。'" type="warning" show-icon />
			<Alert v-else-if="state.status?.isRunning" title="目标正在执行更新或还原" description="操作完成前仅可查看日志和备份记录。" type="info" show-icon />
			<Alert v-if="state.feedback" :title="state.feedback.message" :type="state.feedback.kind" show-icon role="status" />

			<Card title="更新目标与操作">
				<p class="update-target">
					更新目标：<strong>{{ state.status?.targetName || '暂无可用目标' }}</strong>
				</p>
				<div class="update-actions">
					<Button aria-label="刷新记录" :disabled="!!state.busy || !!state.confirmFileName || state.backupPhase === 'loading'" @click="session.refreshRecords()">刷新记录</Button>
					<Button v-if="can('update')" type="primary" aria-label="更新" :disabled="!allowed('update')" :loading="state.busy === 'update'" @click="invoke('update')">更新</Button>
					<Button v-if="can('clear')" aria-label="清空日志" :disabled="!allowed('clear')" :loading="state.busy === 'clear'" @click="invoke('clear')">清空日志</Button>
					<Button v-if="can('webHookKey')" aria-label="复制 WebHook 密钥" :disabled="!allowed('webHookKey')" :loading="state.busy === 'webHookKey'" @click="invoke('webHookKey')"
						>复制 WebHook 密钥</Button
					>
				</div>
				<p class="update-help">离开页面会停止前端等待；服务端更新或还原可能继续执行，重新打开页面可查看结果。</p>
			</Card>

			<Card title="备份记录">
				<section aria-label="备份记录">
					<Alert v-if="state.backupError" :title="state.backupError" type="error" show-icon />
					<p v-if="state.backupPhase === 'loading'" role="status">正在读取备份记录…</p>
					<p v-else-if="state.backupPhase === 'ready' && state.backups.length === 0" class="update-empty">暂无备份记录</p>
					<Form name="systemUpdateBackupForm" layout="vertical" :model="backupModel" class="backup-form">
						<FormItem label="备份列表" name="fileName">
							<Select
								aria-label="备份列表"
								:value="state.selectedFileName || undefined"
								:options="backupOptions"
								placeholder="请选择需要还原的备份"
								:disabled="!!state.busy || !!state.confirmFileName || state.backupPhase === 'loading'"
								:loading="state.backupPhase === 'loading'"
								allow-clear
								@change="selectBackup"
							/>
						</FormItem>
						<Button
							v-if="can('restore')"
							aria-label="还原"
							danger
							:disabled="!restoreAllowed || cooldown.active.value.includes('restore')"
							:loading="state.busy === 'restore'"
							@click="invoke('restore')"
							>还原</Button
						>
					</Form>
				</section>
			</Card>

			<Card title="更新日志">
				<section aria-label="更新日志" class="update-log-region">
					<Alert v-if="state.logsError" :title="state.logsError" type="error" show-icon />
					<p v-if="state.logsPhase === 'loading' && state.logs.length === 0" role="status">正在读取更新日志…</p>
					<p v-else-if="state.logsPhase === 'ready' && state.logs.length === 0" class="update-empty">暂无更新日志</p>
					<pre v-if="state.logs.length > 0" ref="logElement" class="update-log" tabindex="0">{{ state.logs.join('\n') }}</pre>
				</section>
			</Card>
		</template>

		<Modal
			:open="!!state.confirmFileName"
			title="确认还原备份"
			ok-text="确认还原"
			cancel-text="取消"
			:ok-button-props="{ danger: true, disabled: !restoreAllowed, autoInsertSpace: false }"
			:cancel-button-props="{ autoInsertSpace: false }"
			:mask="{ closable: false }"
			destroy-on-hidden
			@ok="session.confirmRestore()"
			@cancel="session.cancelRestore()"
		>
			<p>
				确认使用备份 <strong class="confirm-backup">{{ state.confirmFileName }}</strong> 还原当前更新目标？
			</p>
			<p>确认后会执行还原操作，请等待结果并查看更新日志。</p>
		</Modal>
	</Page>
</template>

<style scoped>
.system-update-page :deep(.system-update-content) {
	display: flex;
	flex-direction: column;
	gap: 16px;
	min-width: 0;
}
.update-actions {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
}
.update-target {
	margin-bottom: 16px;
	overflow-wrap: anywhere;
}
.update-help,
.update-empty {
	color: hsl(var(--muted-foreground));
}
.update-help {
	margin-top: 16px;
	margin-bottom: 0;
}
.backup-form {
	max-width: 760px;
	margin-top: 12px;
}
.update-log-region {
	min-width: 0;
}
.update-log {
	max-height: 420px;
	overflow: auto;
	margin: 0;
	padding: 16px;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	background: hsl(var(--muted));
	color: hsl(var(--foreground));
	border-radius: 6px;
	line-height: 1.65;
}
.confirm-backup {
	overflow-wrap: anywhere;
}
</style>
