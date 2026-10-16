<script setup lang="ts">
import type { MqttQos } from './mqtt-profile';
import type { MqttStatus } from './mqtt-session';

import { computed, onDeactivated, onScopeDispose, reactive, ref, watch } from 'vue';

import { useUserStore } from '@vben/stores';

import { Alert, Button, Input, Select } from 'antdv-next';
import mqtt from 'mqtt';

import { sessionBoundary } from '#/api/session';

import { applyDeviceMessage, createDevicePayload, createDeviceState, createDeviceTopics, createMqttProfile, mqttConnectionUrl, redactMqttText } from './mqtt-profile';
import { MqttSession } from './mqtt-session';

defineOptions({ name: 'Mqttx' });
const user = useUserStore();
const profile = reactive(createMqttProfile());
const status = ref<MqttStatus>('disconnected');
const statusLabel = computed(
	() =>
		({
			connected: '已连接',
			connecting: '连接中',
			disconnected: '未连接',
			reconnecting: '重连中',
		})[status.value]
);
const locked = computed(() => status.value !== 'disconnected');
const error = ref('');
const feedback = ref('');
const busy = ref('');
const topicText = ref('');
const publishTopic = ref('');
const payload = ref('55 AA AA AA AA 91 CF');
const raw = ref(false);
const retain = ref(false);
const subQos = ref<MqttQos>(0);
const pubQos = ref<MqttQos>(0);
const subscriptions = ref<string[]>([]);
const messages = ref<string[]>([]);
const messageLog = ref<HTMLElement>();
const received = ref(0);
const device = ref(createDeviceState());
let generation = 0;
let boundary: AbortController | undefined;
let snapshot = createMqttProfile();
let topics = { subTopic: '', willTopic: '', dhtTopic: '', pubTopic: '' };
let generatedTopicText = '';
let generatedPublishTopic = '';
const qosOptions = [0, 1, 2].map((value) => ({ value, label: `QoS ${value}` }));
const textFields = [
	{
		key: 'host',
		label: 'Broker 主机',
		placeholder: '授权 broker 的主机名或 IP',
	},
	{ key: 'clientId', label: 'Client ID', placeholder: '客户端唯一标识' },
	{ key: 'username', label: '账号', placeholder: 'Username' },
	{ key: 'password', label: '密码', placeholder: 'Password' },
	{ key: 'repacket', label: '设备注册包', placeholder: '设备包名' },
	{
		key: 'dhtRegpack',
		label: '共享传感器注册包',
		placeholder: '可与设备包名相同',
	},
	{
		key: 'mqttToken',
		label: '设备指令 Token',
		placeholder: '设备协议授权 Token',
	},
] as const;
const numbers = [
	{ key: 'keepalive', label: '保活（秒）' },
	{ key: 'connectTimeout', label: '连接超时（毫秒）' },
	{ key: 'reconnectPeriod', label: '重连间隔（毫秒，0 为关闭）' },
] as const;
const commandOptions = [
	{ label: '状态查询', value: '55 AA AA AA AA 91 CF' },
	{ label: '全部打开', value: '55 AA AA AA AA 81 A4 01' },
	{ label: '全部关闭', value: '55 AA AA AA AA 81 A4 00' },
	...[1, 2, 3, 4].map((n) => ({
		label: `${n} 路切换`,
		value: `55 AA AA AA AA 81 BA 0${n}`,
	})),
];
function safe(text: string) {
	return redactMqttText(text, [snapshot.password, snapshot.mqttToken, profile.password, profile.mqttToken]);
}
const session = new MqttSession(mqtt.connect, {
	status(value) {
		status.value = value;
		if (value !== 'connected') device.value = { ...device.value, online: null };
		if (value === 'disconnected') subscriptions.value = [];
	},
	error(value) {
		error.value = safe(value);
	},
	message(topic, text) {
		received.value++;
		device.value = applyDeviceMessage(device.value, snapshot, topics, topic, text);
		messages.value = [...messages.value.slice(-199), safe(`${new Date().toLocaleTimeString()}  ${topic}\n${text}`).slice(0, 4096)];
	},
});
const channelCooldown = ref<string[]>([]);
const channelTimers = new Map<string, ReturnType<typeof setTimeout>>();
function disconnect(clear = false) {
	for (const timer of channelTimers.values()) clearTimeout(timer);
	channelTimers.clear();
	channelCooldown.value = [];
	generation++;
	session.disconnect();
	if (boundary) sessionBoundary.release(boundary);
	boundary = undefined;
	snapshot.password = '';
	snapshot.mqttToken = '';
	busy.value = '';
	subscriptions.value = [];
	if (clear) {
		profile.password = '';
		profile.username = '';
		profile.mqttToken = '';
		messages.value = [];
		received.value = 0;
		payload.value = '';
		error.value = '';
		feedback.value = '';
		device.value = createDeviceState();
	}
}
function handleProtocolChange(value: unknown) {
	if (locked.value || (value !== 'ws' && value !== 'wss')) return;
	profile.protocol = value;
	profile.port = value === 'wss' ? 8084 : 8083;
}
function updateTextField(key: (typeof textFields)[number]['key'], value: string) {
	if (locked.value) return;
	if (key === 'repacket' && (!profile.dhtRegpack || profile.dhtRegpack === profile.repacket)) profile.dhtRegpack = value;
	profile[key] = value;
	if (key === 'repacket' || key === 'dhtRegpack') deriveTopics(false);
}
function deriveTopics(overwrite = true) {
	let nextTopicText = '';
	let nextPublishTopic = '';
	try {
		const value = createDeviceTopics(profile.repacket, profile.dhtRegpack || profile.repacket);
		nextTopicText = [value.subTopic, value.willTopic, value.dhtTopic].join('\n');
		nextPublishTopic = value.pubTopic;
		error.value = '';
	} catch (e) {
		if (overwrite) {
			error.value = e instanceof Error ? e.message : '生成主题失败';
			return;
		}
	}
	// 自动衍生只更新上次生成的值，保留用户手写的主题；无效包名清除陈旧生成值。
	if (overwrite || !topicText.value || topicText.value === generatedTopicText) topicText.value = nextTopicText;
	if (overwrite || !publishTopic.value || publishTopic.value === generatedPublishTopic) publishTopic.value = nextPublishTopic;
	generatedTopicText = nextTopicText;
	generatedPublishTopic = nextPublishTopic;
}
function start() {
	if (locked.value) return;
	error.value = '';
	feedback.value = '';
	try {
		mqttConnectionUrl(profile);
		disconnect();
		snapshot = { ...profile };
		topics = snapshot.repacket ? createDeviceTopics(snapshot.repacket, snapshot.dhtRegpack || snapshot.repacket) : { subTopic: '', willTopic: '', dhtTopic: '', pubTopic: '' };
		if (!topicText.value && topics.subTopic) topicText.value = [topics.subTopic, topics.willTopic, topics.dhtTopic].join('\n');
		if (!publishTopic.value) publishTopic.value = topics.pubTopic;
		device.value = createDeviceState();
		messages.value = [];
		received.value = 0;
		boundary = new AbortController();
		boundary.signal.addEventListener('abort', () => disconnect(true), {
			once: true,
		});
		sessionBoundary.track(boundary);
		session.connect(snapshot);
	} catch (e) {
		error.value = safe(e instanceof Error ? e.message : '连接配置无效');
	}
}
async function operation(name: string, run: () => Promise<void>, success: () => Promise<void> | void) {
	if (busy.value || status.value !== 'connected') return;
	const current = generation;
	busy.value = name;
	error.value = '';
	feedback.value = '';
	try {
		await run();
		if (current === generation && status.value === 'connected') {
			await success();
			if (current === generation && status.value === 'connected') feedback.value = `${name}成功`;
		}
	} catch (e) {
		if (current === generation) error.value = safe(e instanceof Error ? e.message : `${name}失败`);
	} finally {
		if (current === generation) busy.value = '';
	}
}
function subscribe() {
	const requested = [
		...new Set(
			topicText.value
				.split('\n')
				.map((value) => value.trim())
				.filter(Boolean)
		),
	];
	const queryTopic = publishTopic.value;
	const queryQos = pubQos.value;
	const queryBody = createDevicePayload(snapshot, '55 AA AA AA AA 91 CF');
	const queryDevice = !!topics.subTopic && requested.includes(topics.subTopic) && !subscriptions.value.includes(topics.subTopic) && queryTopic === topics.pubTopic;
	void operation(
		'订阅',
		() => session.subscribe(requested, subQos.value),
		async () => {
			subscriptions.value = [...new Set([...subscriptions.value, ...requested])];
			if (queryDevice) {
				try {
					// SUBACK 成功后查询当前设备；查询指令不作为保留消息重放。
					await session.publish(queryTopic, queryBody, queryQos, false);
				} catch (e) {
					throw new Error(`订阅已成功，但设备状态查询失败：${e instanceof Error ? e.message : '发布失败'}`);
				}
			}
		}
	);
}
function unsubscribe() {
	const requested = [...subscriptions.value];
	void operation(
		'取消订阅',
		() => session.unsubscribe(requested),
		() => {
			subscriptions.value = [];
		}
	);
}
function publishChannel(command: string) {
	if (device.value.online !== true || status.value !== 'connected' || busy.value || channelCooldown.value.includes(command)) return;
	channelCooldown.value = [...channelCooldown.value, command];
	channelTimers.set(
		command,
		setTimeout(() => {
			channelCooldown.value = channelCooldown.value.filter((value) => value !== command);
			channelTimers.delete(command);
		}, 2000)
	);
	publish(command, true);
}
function publish(command = payload.value, deviceCommand = false) {
	if (deviceCommand && device.value.online !== true) return;
	const body = raw.value && !deviceCommand ? command : createDevicePayload(snapshot, command);
	void operation(
		'发布',
		() => session.publish(publishTopic.value, body, pubQos.value, retain.value),
		() => {}
	);
}
watch(
	messages,
	() => {
		if (messageLog.value) messageLog.value.scrollTop = messageLog.value.scrollHeight;
	},
	{ flush: 'post' }
);
watch(
	() => [user.userInfo?.userId, user.userInfo?.tenantId, user.userInfo?.currentTenantId],
	() => disconnect(true)
);
onDeactivated(() => disconnect(true));
onScopeDispose(() => disconnect(true));
</script>

<template>
	<main class="mqtt-page p-4">
		<header class="mb-4 flex flex-wrap items-center justify-between gap-3">
			<div>
				<h1 class="text-xl font-semibold">MQTT 连接与消息</h1>
				<p class="text-muted-foreground mt-1">连接授权 broker，订阅主题并调试设备消息。离开页面会断开连接并清除凭据。</p>
			</div>
			<span role="status" aria-live="polite">连接状态：{{ statusLabel }}</span>
		</header>
		<Alert v-if="error" class="mb-4" type="error" :title="error" show-icon role="alert" />
		<p v-if="feedback" class="mb-3" role="status">{{ feedback }}</p>
		<div class="mqtt-layout">
			<section class="bg-card rounded-lg border p-4" aria-labelledby="mqtt-config-title">
				<h2 id="mqtt-config-title" class="mb-4 text-lg font-semibold">连接配置</h2>
				<div class="config-grid">
					<label for="mqtt-protocol"
						>协议<Select
							id="mqtt-protocol"
							v-model:value="profile.protocol"
							:disabled="locked"
							@change="handleProtocolChange"
							:options="[
								{ label: 'ws', value: 'ws' },
								{ label: 'wss', value: 'wss' },
							]"
					/></label>
					<label for="mqtt-port">端口<Input id="mqtt-port" :value="profile.port" type="number" :disabled="locked" @update:value="profile.port = Number($event)" /></label>
					<label v-for="field in textFields" :key="field.key" :for="`mqtt-${field.key}`" class="wide"
						>{{ field.label
						}}<Input
							:id="`mqtt-${field.key}`"
							:value="profile[field.key]"
							:type="['password', 'mqttToken'].includes(field.key) ? 'password' : 'text'"
							:placeholder="field.placeholder"
							:disabled="locked"
							autocomplete="off"
							@update:value="updateTextField(field.key, $event)"
					/></label>
				</div>
				<details class="mt-3">
					<summary class="cursor-pointer">高级连接设置</summary>
					<div class="config-grid mt-3">
						<label v-for="field in numbers" :key="field.key" :for="`mqtt-${field.key}`" class="wide"
							>{{ field.label }}<Input :id="`mqtt-${field.key}`" :value="profile[field.key]" type="number" :disabled="locked" @update:value="profile[field.key] = Number($event)"
						/></label>
					</div>
				</details>
				<div class="mt-4 flex flex-wrap gap-2"><Button type="primary" :disabled="locked" @click="start">连接</Button><Button :disabled="!locked" @click="disconnect()">断开连接</Button></div>
				<p class="text-muted-foreground mt-3 text-sm">WebSocket 路径为 /mqtt；切换 broker 前请先断开。</p>
			</section>
			<div class="grid min-w-0 content-start gap-4">
				<section class="bg-card rounded-lg border p-4" aria-labelledby="mqtt-topics-title">
					<h2 id="mqtt-topics-title" class="mb-3 text-lg font-semibold">订阅与发布</h2>
					<div class="mb-3 flex flex-wrap items-center gap-2">
						<Button :disabled="locked" @click="deriveTopics()">按注册包生成主题</Button><span class="text-muted-foreground text-sm">支持共享传感器；也可直接填写自定义主题。</span>
					</div>
					<label for="mqtt-topics">订阅主题（每行一个）<Input.TextArea id="mqtt-topics" v-model:value="topicText" :rows="3" :disabled="!!busy" /></label>
					<div class="my-3 flex flex-wrap items-center gap-2">
						<Select v-model:value="subQos" aria-label="订阅 QoS" :options="qosOptions" class="qos-select" /><Button
							:disabled="status !== 'connected' || !!busy"
							:loading="busy === '订阅'"
							@click="subscribe"
							>订阅</Button
						><Button :disabled="status !== 'connected' || !subscriptions.length || !!busy" @click="unsubscribe">取消订阅</Button><span>已订阅 {{ subscriptions.length }} 个主题</span>
					</div>
					<label for="mqtt-publish-topic">发布主题<Input id="mqtt-publish-topic" v-model:value="publishTopic" /></label>
					<div class="my-3 flex flex-wrap items-center gap-3">
						<Select v-model:value="pubQos" aria-label="发布 QoS" :options="qosOptions" class="qos-select" /><label class="inline-label"
							><input v-model="retain" type="checkbox" /> Retain 保留消息</label
						><label class="inline-label"><input v-model="raw" type="checkbox" /> 原始消息（不封装设备指令）</label>
					</div>
					<label for="mqtt-payload">消息或设备指令<Input.TextArea id="mqtt-payload" v-model:value="payload" :rows="2" /></label>
					<div class="mt-3 flex flex-wrap gap-2">
						<Select v-model:value="payload" aria-label="常用设备指令" :options="commandOptions" class="command-select" /><Button
							:disabled="status !== 'connected' || !!busy"
							:loading="busy === '发布'"
							@click="publish()"
							>发布消息</Button
						>
					</div>
				</section>
				<section class="bg-card rounded-lg border p-4" aria-labelledby="mqtt-device-title">
					<h2 id="mqtt-device-title" class="mb-3 text-lg font-semibold">设备状态</h2>
					<p class="mb-3">
						设备：{{ device.online === null ? '未知' : device.online ? '在线' : '离线' }} · 强电：{{ device.isAC === null ? '未知' : device.isAC ? '是' : '否' }} · 温度
						{{ device.temperature ?? '—' }} ℃ · 湿度 {{ device.humidity ?? '—' }} % · 运行 {{ device.runSeconds ?? '—' }} 秒
					</p>
					<div class="mb-3 flex gap-2" aria-label="设备全部控制">
						<Button :disabled="device.online !== true || status !== 'connected' || !!busy" @click="publish('55 AA AA AA AA 81 A4 01', true)">全开</Button>
						<Button :disabled="device.online !== true || status !== 'connected' || !!busy" @click="publish('55 AA AA AA AA 81 A4 00', true)">全关</Button>
					</div>
					<div class="flex flex-wrap gap-3">
						<div v-for="(channel, index) in device.channels" :key="index" class="flex items-center gap-2">
							<span>{{ index + 1 }} 路：{{ channel ? '开' : '关' }}</span
							><Button
								:disabled="device.online !== true || status !== 'connected' || !!busy || channelCooldown.includes(`55 AA AA AA AA 81 0${index + 1} 01`)"
								@click="publishChannel(`55 AA AA AA AA 81 0${index + 1} 01`)"
								>打开</Button
							><Button
								:disabled="device.online !== true || status !== 'connected' || !!busy || channelCooldown.includes(`55 AA AA AA AA 81 0${index + 1} 00`)"
								@click="publishChannel(`55 AA AA AA AA 81 0${index + 1} 00`)"
								>关闭</Button
							>
						</div>
					</div>
					<p v-if="device.time" class="text-muted-foreground mt-3">更新时间：{{ device.time }}</p>
				</section>
				<section class="bg-card rounded-lg border p-4" aria-labelledby="mqtt-messages-title">
					<div class="mb-3 flex items-center justify-between">
						<h2 id="mqtt-messages-title" class="text-lg font-semibold">接收消息（{{ received }}）</h2>
						<Button
							@click="
								messages = [];
								received = 0;
							"
							>清空消息</Button
						>
					</div>
					<p class="text-muted-foreground mb-2 text-sm">保留最近 200 条，每条最多显示 4096 字符，凭据已隐藏。</p>
					<pre ref="messageLog" class="message-log" aria-label="接收消息内容">{{ messages.length ? messages.join('\n\n') : '暂无消息，连接后订阅主题即可接收。' }}</pre>
				</section>
			</div>
		</div>
	</main>
</template>

<style scoped>
.mqtt-layout {
	display: grid;
	grid-template-columns: minmax(280px, 340px) minmax(0, 1fr);
	gap: 16px;
	align-items: start;
}
.config-grid {
	display: grid;
	grid-template-columns: 1fr 1fr;
	gap: 12px;
}
.wide {
	grid-column: 1 / -1;
}
label {
	display: grid;
	gap: 6px;
}
.inline-label {
	display: flex;
	align-items: center;
	gap: 6px;
}
.qos-select {
	width: 110px;
}
.command-select {
	width: 180px;
}
.message-log {
	min-height: 120px;
	max-height: 280px;
	overflow: auto;
	white-space: pre-wrap;
	overflow-wrap: anywhere;
	font-size: 13px;
}
@media (max-width: 1000px) {
	.mqtt-layout {
		grid-template-columns: 1fr;
	}
}
</style>
