import type { IClientOptions, MqttClient } from 'mqtt';

import { Buffer } from 'node:buffer';
import { EventEmitter } from 'node:events';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { createMqttProfile } from './mqtt-profile';
import { MqttSession } from './mqtt-session';

class TestClient extends EventEmitter {
	connected = true;
	end = vi.fn((_force: boolean, _options: object, done: () => void) => done());
	options: IClientOptions = {};
	outgoing: MqttClient['outgoing'] = {};
	publishDone?: (error?: Error | null) => void;
	publish = vi.fn((_topic: string, _payload: string, _options: object, done: (error?: Error | null) => void) => {
		this.publishDone = done;
	});
	removeOutgoingMessage = vi.fn((messageId: number) => {
		const message = this.outgoing[messageId];
		if (message) {
			delete this.outgoing[messageId];
			message.cb(new Error('Message removed'));
		}
		return this;
	});
	subscribeDone?: (error: Error | null, grants?: { qos: number; topic: string }[]) => void;
	subscribe = vi.fn((_topics: string[], _options: object, done: NonNullable<TestClient['subscribeDone']>) => {
		this.subscribeDone = done;
	});
	unsubscribe = vi.fn((_topics: string[], done: (error?: Error | null) => void) => done());
}

function fixture(timeout = 1000) {
	const clients: TestClient[] = [];
	const events = { status: vi.fn(), message: vi.fn(), error: vi.fn() };
	const create = vi.fn((_url: string, options: IClientOptions) => {
		const client = new TestClient();
		client.options = { ...options };
		clients.push(client);
		return client as unknown as MqttClient;
	});
	const profile = { ...createMqttProfile(), host: 'localhost', username: 'fixture', password: 'test-secret' };
	const session = new MqttSession(create, events, timeout);
	session.connect(profile);
	return { session, events, clients, create, profile, client: clients[0]! };
}

afterEach(() => vi.useRealTimers());

describe('MQTT 会话边界', () => {
	it('在线空闲连接发送 DISCONNECT，关闭回执前已移除认证信息', () => {
		const { session, client, events } = fixture();
		client.end.mockImplementationOnce(() => undefined);
		session.disconnect();
		expect(client.end).toHaveBeenCalledWith(false, {}, expect.any(Function));
		expect(client.options.reconnectPeriod).toBe(0);
		expect(client.options).not.toHaveProperty('username');
		expect(client.options).not.toHaveProperty('password');
		expect(events.status).toHaveBeenLastCalledWith('disconnected');
	});

	it('在线未确认发布断开时取消待确认消息并发送 DISCONNECT，旧回执无效', async () => {
		const { session, client } = fixture();
		const pending = session.publish('fixture/probe', 'pending', 1, false);
		client.outgoing[1] = {
			volatile: false,
			cmd: 'publish',
			cb: (error) => client.publishDone?.(error),
		};
		const refusal = expect(pending).rejects.toThrow('连接已结束');
		session.disconnect();
		await refusal;
		client.publishDone?.();
		expect(client.removeOutgoingMessage).toHaveBeenCalledWith(1);
		expect(client.outgoing).toEqual({});
		expect(client.end).toHaveBeenCalledWith(false, {}, expect.any(Function));
	});

	it('取消客户端协议待确认消息后正常结束，避免等待 outgoingEmpty', () => {
		const { session, client } = fixture();
		const callback = vi.fn();
		client.outgoing[1] = { volatile: false, cmd: 'publish', cb: callback };
		session.disconnect();
		expect(callback).toHaveBeenCalledWith(expect.objectContaining({ message: 'Message removed' }));
		expect(client.outgoing).toEqual({});
		expect(client.end).toHaveBeenCalledWith(false, {}, expect.any(Function));
	});

	it('强制结束连接中与离线客户端并移除认证信息和监听器', () => {
		const { session, client, events } = fixture();
		client.connected = false;
		session.disconnect();
		expect(client.end).toHaveBeenCalledWith(true, {}, expect.any(Function));
		expect(client.options.reconnectPeriod).toBe(0);
		expect(client.options).not.toHaveProperty('username');
		expect(client.options).not.toHaveProperty('password');
		expect(client.eventNames()).toEqual([]);
		expect(events.status).toHaveBeenLastCalledWith('disconnected');
	});

	it('切换连接时拒绝未确认发布，旧回执和消息不会影响新连接', async () => {
		const { session, client, clients, events, profile } = fixture();
		const oldMessage = client.listeners('message')[0]!;
		const pending = session.publish('fixture/probe', 'old', 1, false);
		const refusal = expect(pending).rejects.toThrow('连接已结束');
		session.connect({ ...profile, port: 9001 });
		await refusal;
		client.publishDone?.();
		oldMessage('fixture/probe', Buffer.from('late'));
		expect(events.message).not.toHaveBeenCalled();
		clients[1]!.emit('connect');
		expect(events.status).toHaveBeenLastCalledWith('connected');
		session.disconnect();
	});

	it('掉线拒绝待确认操作，保留成熟客户端自动重订阅配置', async () => {
		const { session, client, create, events } = fixture();
		const pending = session.publish('fixture/probe', 'payload', 2, false);
		const refusal = expect(pending).rejects.toThrow('连接已中断');
		client.emit('close');
		await refusal;
		client.publishDone?.();
		expect(events.status).toHaveBeenLastCalledWith('reconnecting');
		expect(create).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ clean: true, resubscribe: true, queueQoSZero: false }));
		session.disconnect();
	});

	it('无重连配置时掉线立即结束连接', () => {
		const { session, clients, profile, events } = fixture();
		session.connect({ ...profile, reconnectPeriod: 0 });
		clients[1]!.emit('close');
		expect(clients[1]!.end).toHaveBeenCalledOnce();
		expect(events.status).toHaveBeenLastCalledWith('disconnected');
	});

	it('重连超过上限后结束客户端，成功连接后重新计算次数', () => {
		const { session, client, events } = fixture();
		for (let attempt = 0; attempt < 5; attempt++) client.emit('reconnect');
		client.emit('connect');
		for (let attempt = 0; attempt < 5; attempt++) client.emit('reconnect');
		expect(client.end).not.toHaveBeenCalled();
		client.emit('reconnect');
		expect(client.end).toHaveBeenCalledOnce();
		expect(events.error).toHaveBeenLastCalledWith(expect.stringContaining('重连超过 5 次'));
		session.disconnect();
	});

	it('确认超时拒绝操作并断开，迟到的发布回执不再成功', async () => {
		vi.useFakeTimers();
		const { session, client, events } = fixture();
		const pending = session.publish('fixture/probe', 'payload', 1, false);
		const refusal = expect(pending).rejects.toThrow('操作确认超时');
		await vi.advanceTimersByTimeAsync(1000);
		await refusal;
		client.publishDone?.();
		expect(client.end).toHaveBeenCalledOnce();
		expect(events.status).toHaveBeenLastCalledWith('disconnected');
		expect(vi.getTimerCount()).toBe(0);
	});

	it('broker 拒绝订阅时返回错误且不当作订阅成功', async () => {
		const { session, client } = fixture();
		const pending = session.subscribe(['fixture/probe', 'fixture/probe'], 1);
		const refusal = expect(pending).rejects.toThrow('订阅被拒绝');
		client.subscribeDone?.(null, [{ topic: 'fixture/probe', qos: 128 }]);
		await refusal;
		expect(client.end).toHaveBeenCalledOnce();
		expect(client.subscribe).toHaveBeenCalledWith(['fixture/probe'], { qos: 1 }, expect.any(Function));
		session.disconnect();
	});

	it('部分主题被拒绝时结束已获准主题所在的 clean session', async () => {
		const { session, client } = fixture();
		const pending = session.subscribe(['fixture/allowed', 'fixture/refused'], 1);
		const refusal = expect(pending).rejects.toThrow('订阅被拒绝');
		client.subscribeDone?.(null, [{ topic: 'fixture/allowed', qos: 1 }, { topic: 'fixture/refused', qos: 128 }]);
		await refusal;
		expect(client.end).toHaveBeenCalledOnce();
		expect(client.listenerCount('message')).toBe(0);
	});

	it('错误对象中的 broker 凭据不会进入界面错误', () => {
		const { session, client, events, profile } = fixture();
		client.emit('error', new Error(`broker rejected ${profile.password}`));
		expect(events.error).toHaveBeenLastCalledWith('MQTT 连接或操作失败，请检查地址、认证及 broker 权限');
		session.disconnect();
	});

	it('相同 QoS 的已确认重复订阅接受 MQTT.js 空授予且保留连接', async () => {
		const { session, client } = fixture();
		const first = session.subscribe(['fixture/known'], 1);
		client.subscribeDone?.(null, [{ topic: 'fixture/known', qos: 1 }]);
		await first;
		const repeat = session.subscribe(['fixture/known'], 1);
		client.subscribeDone?.(null, []);
		await expect(repeat).resolves.toBeUndefined();
		expect(client.end).not.toHaveBeenCalled();
		session.disconnect();
	});

	it('首次空授予不伪造成功且关闭 clean session', async () => {
		const { session, client } = fixture();
		const pending = session.subscribe(['fixture/unknown'], 1);
		const refused = expect(pending).rejects.toThrow('订阅被拒绝');
		client.subscribeDone?.(null, []);
		await refused;
		expect(client.end).toHaveBeenCalledOnce();
	});

	it('有效部分授予不能补齐首次未知主题', async () => {
		const { session, client } = fixture();
		const pending = session.subscribe(['fixture/one', 'fixture/two'], 1);
		const refused = expect(pending).rejects.toThrow('订阅被拒绝');
		client.subscribeDone?.(null, [{ topic: 'fixture/one', qos: 1 }]);
		await refused;
		expect(client.end).toHaveBeenCalledOnce();
	});

	it('已确认的低 QoS 不能补齐更高 QoS 的空回执', async () => {
		const { session, client } = fixture();
		const first = session.subscribe(['fixture/known'], 0);
		client.subscribeDone?.(null, [{ topic: 'fixture/known', qos: 0 }]);
		await first;
		const pending = session.subscribe(['fixture/known'], 1);
		const refused = expect(pending).rejects.toThrow('订阅被拒绝');
		client.subscribeDone?.(null, []);
		await refused;
		expect(client.end).toHaveBeenCalledOnce();
	});

	it('成功取消订阅清除确认缓存，重新空授予被拒绝', async () => {
		const { session, client } = fixture();
		const first = session.subscribe(['fixture/known'], 1);
		client.subscribeDone?.(null, [{ topic: 'fixture/known', qos: 1 }]);
		await first;
		await session.unsubscribe(['fixture/known']);
		const pending = session.subscribe(['fixture/known'], 1);
		const refused = expect(pending).rejects.toThrow('订阅被拒绝');
		client.subscribeDone?.(null, []);
		await refused;
	});

	it('换客户端不继承旧确认缓存', async () => {
		const { session, client, clients, profile } = fixture();
		const first = session.subscribe(['fixture/known'], 1);
		client.subscribeDone?.(null, [{ topic: 'fixture/known', qos: 1 }]);
		await first;
		session.connect({ ...profile, clientId: 'next-client' });
		const pending = session.subscribe(['fixture/known'], 1);
		const refused = expect(pending).rejects.toThrow('订阅被拒绝');
		clients[1]!.subscribeDone?.(null, []);
		await refused;
	});

	it('待确认订阅移除协议消息后发送 DISCONNECT，迟到授予失效', async () => {
		const { session, client } = fixture();
		const pending = session.subscribe(['fixture/pending'], 1);
		const refused = expect(pending).rejects.toThrow('连接已结束');
		client.outgoing[2] = {
			volatile: true,
			cmd: 'subscribe',
			cb: (error) => client.subscribeDone?.(error ?? null),
		};
		session.disconnect();
		await refused;
		client.subscribeDone?.(null, [{ topic: 'fixture/pending', qos: 1 }]);
		expect(client.removeOutgoingMessage).toHaveBeenCalledWith(2);
		expect(client.outgoing).toEqual({});
		expect(client.end).toHaveBeenCalledExactlyOnceWith(false, {}, expect.any(Function));
	});
});
