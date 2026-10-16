<script setup lang="ts">
import type { LivePhase } from './live-session';

import { computed, onDeactivated, onScopeDispose, reactive, ref, watch } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Button, Input, Tree } from 'antdv-next';

import { sessionBoundary } from '#/api/session';

import { createLivePlayer } from './live-player';
import { LiveSession } from './live-session';

defineOptions({ name: 'Elive' });
const user = useUserStore();
const deviceTree = [
	{ title: '节点A', key: 'live-0', children: [{ title: '菜单A-1', key: 'live-0-0', children: [{ title: '菜单A-1-1', key: 'live-0-0-0' }] }] },
	{
		title: '节点B',
		key: 'live-1',
		children: [
			{ title: '菜单B-1', key: 'live-1-0', children: [{ title: '菜单B-1-1', key: 'live-1-0-0' }] },
			{ title: '菜单B-2', key: 'live-1-1', children: [{ title: '菜单B-2-1', key: 'live-1-1-0' }] },
		],
	},
	{
		title: '节点C',
		key: 'live-2',
		children: [
			{ title: '菜单C-1', key: 'live-2-0', children: [{ title: '菜单C-1-1', key: 'live-2-0-0' }] },
			{ title: '菜单C-2', key: 'live-2-1', children: [{ title: '菜单C-2-1', key: 'live-2-1-0' }] },
		],
	},
];
const selectedDevices = ref<string[]>([]);
const profile = reactive({ accessToken: '', url: '' });
const phase = ref<LivePhase>('idle');
const error = ref('');
const container = ref<HTMLElement>();
const locked = computed(() => phase.value === 'loading' || phase.value === 'playing');
const phaseLabel = computed(() => ({ error: '播放失败', idle: '未播放', loading: '正在打开', playing: '已打开' })[phase.value]);
let boundary: AbortController | undefined;
let resizeObserver: ResizeObserver | undefined;
const session = new LiveSession(
	(snapshot, events, signal) => {
		if (!container.value) return Promise.reject(new Error('播放容器未就绪'));
		return createLivePlayer(container.value, snapshot, events, signal);
	},
	(next, message) => {
		phase.value = next;
		error.value = message;
	}
);

function stop(clear = false) {
	session.stop();
	resizeObserver?.disconnect();
	resizeObserver = undefined;
	if (boundary) sessionBoundary.release(boundary);
	boundary = undefined;
	if (clear) {
		profile.accessToken = '';
		profile.url = '';
	}
}
function start() {
	stop();
	boundary = new AbortController();
	boundary.signal.addEventListener('abort', () => stop(true), { once: true });
	sessionBoundary.track(boundary);
	if (container.value) {
		resizeObserver = new ResizeObserver(() => {
			if (container.value) session.resize(container.value.clientWidth, container.value.clientHeight);
		});
		resizeObserver.observe(container.value);
	}
	void session.start(profile);
}
watch(
	() => [user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId],
	() => stop(true)
);
onDeactivated(() => stop(true));
onScopeDispose(() => stop(true));
</script>

<template>
	<main class="live-page p-4">
		<header class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-xl font-semibold">直播与视频</h1>
				<p class="text-muted-foreground mt-1">输入已授权设备的访问 Token 和 ezopen 地址。播放器保留标准控制栏，离开页面会停止播放并清除输入。</p>
			</div>
			<span role="status" aria-live="polite">播放器状态：{{ phaseLabel }}</span>
		</header>
		<Alert v-if="error" class="mb-4" type="error" show-icon role="alert" :title="error" />
		<aside class="bg-card mb-4 rounded-lg border p-4" aria-label="设备树"><Tree v-model:selected-keys="selectedDevices" :tree-data="deviceTree" /></aside>
		<section class="bg-card mb-4 rounded-lg border p-4" aria-label="直播配置">
			<div class="live-fields">
				<label for="live-token"
					><span class="mb-2 block font-medium">访问 Token</span
					><Input id="live-token" v-model:value="profile.accessToken" @press-enter="start" type="password" autocomplete="off" :disabled="locked" placeholder="输入已授权的访问 Token"
				/></label>
				<label for="live-url"
					><span class="mb-2 block font-medium">视频地址</span
					><Input id="live-url" v-model:value="profile.url" @press-enter="start" autocomplete="off" :disabled="locked" placeholder="ezopen://open.ys7.com/设备序列号/1.live"
				/></label>
			</div>
			<div class="mt-4 flex flex-wrap gap-2">
				<Button type="primary" :auto-insert-space="false" :loading="phase === 'loading'" :disabled="locked" @click="start">{{ phase === 'error' ? '重试播放' : '打开视频' }}</Button>
				<Button :auto-insert-space="false" :disabled="!locked" @click="stop()">停止播放</Button>
				<Button :auto-insert-space="false" @click="stop(true)">退出并清除</Button>
			</div>
		</section>
		<section class="bg-card rounded-lg border p-4" aria-label="视频画面" :aria-busy="phase === 'loading'">
			<div class="live-stage">
				<div ref="container" class="live-container" />
				<p v-if="phase === 'idle'" class="live-placeholder">填写设备信息后打开视频</p>
				<p v-else-if="phase === 'loading'" class="live-loading" role="status">正在加载播放器并连接设备…</p>
			</div>
			<p class="text-muted-foreground mt-3 text-sm">停止、录制和全屏使用播放器的标准控制栏；设备支持的控制以播放器显示为准。</p>
		</section>
	</main>
</template>

<style scoped>
.live-page {
	min-width: 0;
}
.live-fields {
	display: grid;
	grid-template-columns: minmax(220px, 1fr) minmax(300px, 2fr);
	gap: 16px;
}
.live-fields > label {
	min-width: 0;
}
.live-stage {
	position: relative;
	width: 100%;
	height: min(62vh, 640px);
	min-height: 320px;
	overflow: hidden;
	border-radius: 6px;
	background: #111;
}
.live-container {
	width: 100%;
	height: 100%;
}
.live-placeholder {
	position: absolute;
	inset: 0;
	display: grid;
	place-items: center;
	color: #ccc;
	pointer-events: none;
}
.live-loading {
	position: absolute;
	top: 12px;
	left: 12px;
	padding: 6px 12px;
	border-radius: 4px;
	color: #fff;
	background: rgb(0 0 0 / 70%);
	pointer-events: none;
}
@media (width <= 900px) {
	.live-fields {
		grid-template-columns: minmax(0, 1fr);
	}
}
</style>
