/* eslint-disable vue/one-component-per-file -- 单测使用组件桩复现公开事件契约。 */
import type { IClientOptions, MqttClient } from 'mqtt';

import type { VueWrapper } from '@vue/test-utils';
import type { PropType } from 'vue';

import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

import { enableAutoUnmount, flushPromises, mount } from '@vue/test-utils';
import { nextTick, reactive } from 'vue';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import MqttView from './index.vue';

const { connectMock, identity, track, release } = vi.hoisted(() => ({
	connectMock: vi.fn(),
	identity: {
		userInfo: {
			userId: 'mqtt-fixture-user',
			currentTenantId: 'mqtt-fixture-tenant',
		},
	},
	track: vi.fn(),
	release: vi.fn(),
}));
const user = reactive(identity);
vi.mock('mqtt', () => ({
	default: { connect: connectMock },
	connect: connectMock,
}));
vi.mock('#/api/session', () => ({
	sessionBoundary: { version: 0, track, release },
}));
vi.mock('@vben/stores', async () => {
	const { reactive } = await import('vue');
	return { useUserStore: () => reactive(identity) };
});
vi.mock('antdv-next', async () => {
	const { defineComponent, h } = await import('vue');
	const input = (tag: string) =>
		defineComponent({
			inheritAttrs: false,
			props: {
				value: { type: [String, Number], default: '' },
				disabled: Boolean,
				type: { type: String, default: 'text' },
			},
			emits: ['update:value'],
			setup:
				(props, { attrs, emit }) =>
				() =>
					h(tag, {
						...attrs,
						value: props.value ?? '',
						disabled: props.disabled,
						type: props.type,
						onInput: (event: Event) => emit('update:value', (event.target as HTMLInputElement).value),
					}),
		});
	return {
		Alert: defineComponent({
			props: { title: { type: String, default: '' } },
			setup:
				(props, { attrs }) =>
				() =>
					h('p', attrs, props.title),
		}),
		Button: defineComponent({
			props: { disabled: Boolean, loading: Boolean },
			setup:
				(props, { attrs, slots }) =>
				() =>
					h('button', { ...attrs, disabled: props.disabled }, slots.default?.()),
		}),
		Input: Object.assign(input('input'), { TextArea: input('textarea') }),
		Select: defineComponent({
			inheritAttrs: false,
			props: {
				value: { type: [String, Number], default: '' },
				disabled: Boolean,
				options: {
					type: Array as PropType<{ label: string; value: number | string }[]>,
					default: () => [],
				},
			},
			emits: ['update:value', 'change'],
			setup:
				(props, { attrs, emit }) =>
				() =>
					h(
						'select',
						{
							...attrs,
							value: props.value,
							disabled: props.disabled,
							onChange: (event: Event) => {
								const selected = (event.target as HTMLSelectElement).value;
								const option = props.options.find((item: { value: number | string }) => String(item.value) === selected);
								emit('update:value', option?.value);
								emit('change', option?.value, option);
							},
						},
						props.options.map((item: { label: string; value: number | string }) => h('option', { value: item.value }, item.label))
					),
		}),
		Tag: defineComponent({
			setup:
				(_, { slots }) =>
				() =>
					h('span', slots.default?.()),
		}),
	};
});

class TestClient extends EventEmitter {
	confirmPublish = true;
	connected = false;
	end = vi.fn((_force: boolean, _options: object, done: () => void) => {
		this.connected = false;
		done();
	});
	options: IClientOptions = {};
	outgoing: MqttClient['outgoing'] = {};
	publishDone?: (error?: Error | null) => void;
	publish = vi.fn((_topic: string, _body: string, _options: object, done: (error?: Error | null) => void) => {
		this.publishDone = done;
		if (this.confirmPublish) done();
	});
	subscribeDone?: (error: Error | null, grants?: { qos: number; topic: string }[]) => void;
	subscribe = vi.fn((_topics: string[], _options: object, done: NonNullable<TestClient['subscribeDone']>) => {
		this.subscribeDone = done;
	});
	unsubscribe = vi.fn((_topics: string[], done: (error?: Error | null) => void) => done());
	ack(qos = 0) {
		this.subscribeDone?.(
			null,
			this.subscribe.mock.calls.at(-1)![0].map((topic) => ({ topic, qos }))
		);
	}
	message(topic: string, payload: object | string) {
		this.emit('message', topic, Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload)));
	}
}

const clients: TestClient[] = [];
const button = (view: VueWrapper, text: string) => view.findAll('button').find((item) => item.text() === text)!;
const inputValue = (view: VueWrapper, selector: string) => view.get<HTMLInputElement | HTMLTextAreaElement>(selector).element.value;
const channelButtons = (view: VueWrapper) => view.findAll('button').filter((item) => ['关闭', '打开'].includes(item.text()));
async function connectedView(register = 'relay') {
	const view = mount(MqttView);
	await view.get('#mqtt-host').setValue('fixture.invalid');
	await view.get('#mqtt-repacket').setValue(register);
	await view.get('#mqtt-clientId').setValue('fixture-client');
	await view.get('#mqtt-mqttToken').setValue('fixture-device-token');
	await button(view, '连接').trigger('click');
	const client = clients.at(-1)!;
	client.connected = true;
	client.emit('connect');
	await nextTick();
	return { view, client };
}

beforeEach(() => {
	clients.length = 0;
	connectMock.mockReset();
	track.mockClear();
	release.mockClear();
	user.userInfo.userId = 'mqtt-fixture-user';
	user.userInfo.currentTenantId = 'mqtt-fixture-tenant';
	connectMock.mockImplementation((_url: string, options: IClientOptions) => {
		const client = new TestClient();
		client.options = { ...options };
		clients.push(client);
		return client as unknown as MqttClient;
	});
});
enableAutoUnmount(afterEach);

describe('MQTT 原有交互行为', () => {
	it('协议切换恢复 ws 8083 与 wss 8084，连接期间配置保持锁定', async () => {
		const { view } = await connectedView();
		expect(view.get<HTMLSelectElement>('#mqtt-protocol').element.disabled).toBe(true);
		await button(view, '断开连接').trigger('click');
		await view.get('#mqtt-port').setValue('9001');
		await view.get('#mqtt-protocol').setValue('wss');
		expect(inputValue(view, '#mqtt-port')).toBe('8084');
		await view.get('#mqtt-protocol').setValue('ws');
		expect(inputValue(view, '#mqtt-port')).toBe('8083');
	});

	it('设备包输入同步默认共享传感器并自动衍生主题，独立传感器保留', async () => {
		const view = mount(MqttView);
		await view.get('#mqtt-repacket').setValue('relay');
		expect(inputValue(view, '#mqtt-dhtRegpack')).toBe('relay');
		expect(inputValue(view, '#mqtt-topics')).toBe('mqtt/admintnet/relay/out\nmqtt/admintnet/relay/will\nmqtt/admintnet/relay/dht');
		expect(inputValue(view, '#mqtt-publish-topic')).toBe('mqtt/admintnet/relay/into');
		await view.get('#mqtt-dhtRegpack').setValue('sensor');
		await view.get('#mqtt-repacket').setValue('relay-two');
		expect(inputValue(view, '#mqtt-dhtRegpack')).toBe('sensor');
		expect(inputValue(view, '#mqtt-topics')).toBe('mqtt/admintnet/relay-two/out\nmqtt/admintnet/relay-two/will\nmqtt/admintnet/sensor/dht');
		expect(connectMock).not.toHaveBeenCalled();
	});

	it('自动生成保留手写主题；清空传感器时恢复共享包，手动生成可覆盖主题', async () => {
		const view = mount(MqttView);
		await view.get('#mqtt-repacket').setValue('relay');
		await view.get('#mqtt-topics').setValue('fixture/custom/+');
		await view.get('#mqtt-publish-topic').setValue('fixture/custom/into');
		await view.get('#mqtt-dhtRegpack').setValue('sensor');
		await view.get('#mqtt-repacket').setValue('relay-two');
		expect(inputValue(view, '#mqtt-topics')).toBe('fixture/custom/+');
		expect(inputValue(view, '#mqtt-publish-topic')).toBe('fixture/custom/into');
		await view.get('#mqtt-dhtRegpack').setValue('');
		await button(view, '按注册包生成主题').trigger('click');
		expect(inputValue(view, '#mqtt-topics')).toContain('mqtt/admintnet/relay-two/dht');
		expect(inputValue(view, '#mqtt-publish-topic')).toBe('mqtt/admintnet/relay-two/into');
	});

	it('无效或清空设备包清除陈旧生成主题，不衍生通配符订阅', async () => {
		const view = mount(MqttView);
		await view.get('#mqtt-repacket').setValue('relay');
		await view.get('#mqtt-repacket').setValue('relay/#');
		expect(inputValue(view, '#mqtt-topics')).toBe('');
		expect(inputValue(view, '#mqtt-publish-topic')).toBe('');
		await view.get('#mqtt-repacket').setValue('');
		expect(inputValue(view, '#mqtt-dhtRegpack')).toBe('');
		expect(inputValue(view, '#mqtt-topics')).toBe('');
		await view.get('#mqtt-repacket').setValue('relay-two');
		expect(inputValue(view, '#mqtt-topics')).toContain('mqtt/admintnet/relay-two/out');
	});

	it('获准设备订阅后查询状态，使用设备封装且查询 retain 固定为 false', async () => {
		const { view, client } = await connectedView();
		for (const checkbox of view.findAll('input[type="checkbox"]')) await checkbox.setValue(true);
		await view.get('select[aria-label="发布 QoS"]').setValue('2');
		await button(view, '订阅').trigger('click');
		expect(client.publish).not.toHaveBeenCalled();
		client.ack();
		await flushPromises();
		expect(client.publish).toHaveBeenCalledOnce();
		const [topic, body, options] = client.publish.mock.calls[0]!;
		expect(topic).toBe('mqtt/admintnet/relay/into');
		expect(JSON.parse(body)).toEqual({
			token: 'fixture-device-token',
			cmd: '55 AA AA AA AA 91 CF',
			cmdpara: '',
			clientid: 'fixture-client',
		});
		expect(options).toEqual({ qos: 2, retain: false });
		expect(client.subscribe.mock.calls[0]![0]).toEqual(['mqtt/admintnet/relay/out', 'mqtt/admintnet/relay/will', 'mqtt/admintnet/relay/dht']);
		expect(view.text()).toContain('已订阅 3 个主题');
		expect(view.text()).toContain('设备：未知');
		await view.get('#mqtt-payload').setValue('fixture raw payload');
		await button(view, '发布消息').trigger('click');
		await flushPromises();
		expect(client.publish).toHaveBeenLastCalledWith('mqtt/admintnet/relay/into', 'fixture raw payload', { qos: 2, retain: true }, expect.any(Function));
	});

	it.each(['fixture/custom', 'mqtt/admintnet/relay/#', 'mqtt/admintnet/another/out'])('自定义订阅 %s 不追加订阅或自动发布设备指令', async (topic) => {
		const { view, client } = await connectedView();
		await view.get('#mqtt-topics').setValue(topic);
		await button(view, '订阅').trigger('click');
		client.ack();
		await flushPromises();
		expect(client.subscribe).toHaveBeenCalledOnce();
		expect(client.subscribe.mock.calls[0]![0]).toEqual([topic]);
		expect(client.publish).not.toHaveBeenCalled();
	});

	it('自定义发布主题不自动发送设备状态查询', async () => {
		const { view, client } = await connectedView();
		await view.get('#mqtt-publish-topic').setValue('fixture/another/into');
		await button(view, '订阅').trigger('click');
		client.ack();
		await flushPromises();
		expect(client.publish).not.toHaveBeenCalled();
		expect(view.text()).toContain('已订阅 3 个主题');
	});

	it('部分订阅拒绝不查询、不标订阅成功且结束 clean session', async () => {
		const { view, client } = await connectedView();
		await button(view, '订阅').trigger('click');
		client.subscribeDone?.(null, [
			{ topic: 'mqtt/admintnet/relay/out', qos: 1 },
			{ topic: 'mqtt/admintnet/relay/will', qos: 128 },
		]);
		await flushPromises();
		expect(client.publish).not.toHaveBeenCalled();
		expect(client.end).toHaveBeenCalledOnce();
		expect(view.text()).toContain('已订阅 0 个主题');
		expect(view.text()).not.toContain('订阅成功');
	});

	it('状态查询失败保留 SUBACK 确认的订阅并说明查询失败', async () => {
		const { view, client } = await connectedView();
		client.confirmPublish = false;
		await button(view, '订阅').trigger('click');
		client.ack();
		await flushPromises();
		client.publishDone?.(new Error('fixture publish refused'));
		await flushPromises();
		expect(view.text()).toContain('已订阅 3 个主题');
		expect(view.get('[role="alert"]').text()).toContain('订阅已成功，但设备状态查询失败');
		expect(view.text()).toContain('设备：未知');
	});

	it('混合已订阅主题与新主题的 MQTT.js 回执不重复查询设备', async () => {
		const { view, client } = await connectedView();
		await button(view, '订阅').trigger('click');
		client.ack();
		await flushPromises();
		await view.get('#mqtt-topics').setValue('mqtt/admintnet/relay/out\nfixture/new');
		await button(view, '订阅').trigger('click');
		client.subscribeDone?.(null, [{ topic: 'fixture/new', qos: 1 }]);
		await flushPromises();
		expect(view.text()).toContain('已订阅 4 个主题');
		expect(client.publish).toHaveBeenCalledOnce();
	});

	it('掉线后的迟到 SUBACK 不触发查询；重连仍沿用 MQTT.js 自动重订阅', async () => {
		const { view, client } = await connectedView();
		await button(view, '订阅').trigger('click');
		const late = client.subscribeDone!;
		client.connected = false;
		client.emit('close');
		client.connected = true;
		client.emit('connect');
		late(null, [{ topic: 'mqtt/admintnet/relay/out', qos: 1 }]);
		await flushPromises();
		expect(client.publish).not.toHaveBeenCalled();
		expect(client.options).toMatchObject({
			clean: true,
			resubscribe: true,
			queueQoSZero: false,
		});
		expect(view.text()).not.toContain('订阅成功');
	});

	it('设备未知或离线每路禁用；明确在线才能开关，掉线和重连恢复未知', async () => {
		const { view, client } = await connectedView();
		expect(channelButtons(view)).toHaveLength(8);
		expect(channelButtons(view).every((item) => (item.element as HTMLButtonElement).disabled)).toBe(true);
		client.message('mqtt/admintnet/relay/out', {
			regpacket: 'relay',
			redata: '55 AA AA AA AA 82 01 01',
		});
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'another',
			redata: 'online',
		});
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'unknown',
		});
		await nextTick();
		expect(view.text()).toContain('设备：未知');
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'online',
		});
		await nextTick();
		expect(channelButtons(view).every((item) => !(item.element as HTMLButtonElement).disabled)).toBe(true);
		await channelButtons(view)[0]!.trigger('click');
		await flushPromises();
		expect(client.publish).toHaveBeenCalledOnce();
		expect(JSON.parse(client.publish.mock.calls[0]![1]).cmd).toBe('55 AA AA AA AA 81 01 01');
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'offline',
		});
		await nextTick();
		// 绕过原生 disabled 模拟迟到点击，验证发布入口也拒绝离线控制。
		const offlineButton = channelButtons(view)[0]!;
		(offlineButton.element as HTMLButtonElement).disabled = false;
		await offlineButton.trigger('click');
		(offlineButton.element as HTMLButtonElement).disabled = true;
		expect(client.publish).toHaveBeenCalledOnce();
		expect(channelButtons(view).every((item) => (item.element as HTMLButtonElement).disabled)).toBe(true);
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'online',
		});
		client.connected = false;
		client.emit('close');
		client.connected = true;
		client.emit('connect');
		await nextTick();
		expect(view.text()).toContain('设备：未知');
		expect(channelButtons(view).every((item) => (item.element as HTMLButtonElement).disabled)).toBe(true);
	});

	it('接收后 DOM 更新再滚底，达到 200 条仍滚动且计数和最新状态不丢失', async () => {
		const { view, client } = await connectedView();
		const log = view.get<HTMLElement>('.message-log').element;
		Object.defineProperty(log, 'scrollHeight', {
			configurable: true,
			get: () => 900,
		});
		for (let index = 0; index < 200; index++) client.message('fixture/log', `message-${index}`);
		await nextTick();
		expect(log.scrollTop).toBe(900);
		log.scrollTop = 0;
		client.message('mqtt/admintnet/relay/out', {
			regpacket: 'relay',
			redata: '55 AA AA AA AA 82 04 01',
		});
		await nextTick();
		expect(log.scrollTop).toBe(900);
		expect(view.get('#mqtt-messages-title').text()).toContain('201');
		expect(view.text()).toContain('4 路：开');
		expect(log.textContent).not.toContain('message-0\n');
		expect(log.textContent).toContain('message-199');
	});

	it('租户切换清除日志和设备状态，旧消息与迟到回执不再写入或查询', async () => {
		const { view, client } = await connectedView();
		const lateMessage = client.listeners('message')[0]!;
		client.message('fixture/log', 'before-boundary');
		await button(view, '订阅').trigger('click');
		const lateSuback = client.subscribeDone!;
		user.userInfo.currentTenantId = 'mqtt-fixture-tenant-two';
		await nextTick();
		lateMessage('fixture/log', Buffer.from('after-boundary'));
		lateSuback(null, [{ topic: 'mqtt/admintnet/relay/out', qos: 1 }]);
		await flushPromises();
		expect(client.publish).not.toHaveBeenCalled();
		expect(view.get('.message-log').text()).not.toContain('before-boundary');
		expect(view.get('.message-log').text()).not.toContain('after-boundary');
		expect(view.get('#mqtt-messages-title').text()).toContain('0');
		expect(view.text()).toContain('设备：未知');
		expect(client.options).not.toHaveProperty('password');
	});

	it('查询待确认时断开会取消操作，迟到发布回执不回写订阅成功', async () => {
		const { view, client } = await connectedView();
		client.confirmPublish = false;
		await button(view, '订阅').trigger('click');
		client.ack();
		await flushPromises();
		expect(client.publish).toHaveBeenCalledOnce();
		const latePublish = client.publishDone!;
		await button(view, '断开连接').trigger('click');
		latePublish();
		await flushPromises();
		expect(client.end).toHaveBeenCalledWith(false, {}, expect.any(Function));
		expect(view.text()).toContain('已订阅 0 个主题');
		expect(view.text()).not.toContain('订阅成功');
		expect(view.find('[role="alert"]').exists()).toBe(false);
	});

	it('独立全开全关保持在线门槛并发送原设备封装，无新增冷却', async () => {
		const { view, client } = await connectedView();
		const controls = ['全开', '全关'].map((text) => button(view, text));
		expect(controls.every((item) => (item.element as HTMLButtonElement).disabled)).toBe(true);
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'online',
		});
		await nextTick();
		for (const [index, text] of ['全开', '全关'].entries()) {
			await button(view, text).trigger('click');
			await flushPromises();
			const [topic, body, options] = client.publish.mock.calls[index]!;
			expect(topic).toBe('mqtt/admintnet/relay/into');
			expect(JSON.parse(body)).toEqual({
				token: 'fixture-device-token',
				cmd: index ? '55 AA AA AA AA 81 A4 00' : '55 AA AA AA AA 81 A4 01',
				cmdpara: '',
				clientid: 'fixture-client',
			});
			expect(options).toEqual({ qos: 0, retain: false });
			expect((button(view, text).element as HTMLButtonElement).disabled).toBe(false);
		}
	});

	it('八个单路命令各自冷却两秒，重复入口拒绝且不同命令不互锁', async () => {
		vi.useFakeTimers();
		const { view, client } = await connectedView();
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'online',
		});
		await nextTick();
		for (const [index, control] of channelButtons(view).entries()) {
			expect((control.element as HTMLButtonElement).disabled).toBe(false);
			await control.trigger('click');
			await flushPromises();
			expect((control.element as HTMLButtonElement).disabled).toBe(true);
			(control.element as HTMLButtonElement).disabled = false;
			await control.trigger('click');
			(control.element as HTMLButtonElement).disabled = true;
			expect(client.publish).toHaveBeenCalledTimes(index + 1);
		}
		await vi.advanceTimersByTimeAsync(1999);
		expect(channelButtons(view).every((item) => (item.element as HTMLButtonElement).disabled)).toBe(true);
		await vi.advanceTimersByTimeAsync(1);
		expect(channelButtons(view).every((item) => !(item.element as HTMLButtonElement).disabled)).toBe(true);
		await channelButtons(view)[0]!.trigger('click');
		await flushPromises();
		expect(client.publish).toHaveBeenCalledTimes(9);
		view.unmount();
		vi.useRealTimers();
	});

	it('断开清除单路冷却定时器，新连接不继承冷却', async () => {
		vi.useFakeTimers();
		const { view, client } = await connectedView();
		client.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'online',
		});
		await nextTick();
		await channelButtons(view)[0]!.trigger('click');
		await flushPromises();
		expect((channelButtons(view)[0]!.element as HTMLButtonElement).disabled).toBe(true);
		await button(view, '断开连接').trigger('click');
		expect(vi.getTimerCount()).toBe(0);
		await button(view, '连接').trigger('click');
		const nextClient = clients.at(-1)!;
		nextClient.connected = true;
		nextClient.emit('connect');
		nextClient.message('mqtt/admintnet/relay/will', {
			regpacket: 'relay',
			redata: 'online',
		});
		await nextTick();
		expect((channelButtons(view)[0]!.element as HTMLButtonElement).disabled).toBe(false);
		view.unmount();
		vi.useRealTimers();
	});
});
