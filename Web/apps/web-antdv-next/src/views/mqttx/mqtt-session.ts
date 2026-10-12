import type { IClientOptions, MqttClient } from 'mqtt';

import type { MqttProfile, MqttQos } from './mqtt-profile';

import { mqttConnectionUrl, validateMqttTopic } from './mqtt-profile';

export type MqttStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
export interface MqttSessionEvents {
	status: (status: MqttStatus) => void;
	message: (topic: string, payload: string) => void;
	error: (message: string) => void;
}
interface ActiveConnection {
	client: MqttClient;
	retries: number;
	pending: Set<(error: Error) => void>;
}

/** 一次只持有一个客户端；所有异步回执必须仍属于当前连接。 */
export class MqttSession {
	private active?: ActiveConnection;

	constructor(
		private readonly create: (url: string, options: IClientOptions) => MqttClient,
		private readonly events: MqttSessionEvents,
		private readonly operationTimeout = 15_000
	) {}

	connect(profile: MqttProfile) {
		const url = mqttConnectionUrl(profile);
		this.disconnect();
		this.events.status('connecting');
		try {
			const client = this.create(url, {
				clientId: profile.clientId,
				username: profile.username || undefined,
				password: profile.password || undefined,
				keepalive: profile.keepalive,
				connectTimeout: profile.connectTimeout,
				reconnectPeriod: profile.reconnectPeriod,
				clean: true,
				resubscribe: true,
				queueQoSZero: false,
			});
			const active: ActiveConnection = { client, retries: 0, pending: new Set() };
			this.active = active;
			const current = () => this.active === active;
			client.on('connect', () => {
				if (!current()) return;
				active.retries = 0;
				this.events.status('connected');
			});
			client.on('reconnect', () => {
				if (!current()) return;
				if (++active.retries > 5) {
					this.disconnect();
					this.events.error('重连超过 5 次，请检查连接配置后重新连接');
				} else this.events.status('reconnecting');
			});
			client.on('close', () => {
				if (!current()) return;
				// 丢线后拒绝未确认操作，避免用户把旧回执当作新连接结果。
				for (const reject of [...active.pending]) reject(new Error('连接已中断，操作未确认'));
				if (!profile.reconnectPeriod) this.disconnect();
				else this.events.status('reconnecting');
			});
			client.on('error', () => {
				if (current()) this.events.error('MQTT 连接或操作失败，请检查地址、认证及 broker 权限');
			});
			client.on('message', (topic, payload) => {
				if (current()) this.events.message(topic, payload.toString());
			});
		} catch {
			this.disconnect();
			this.events.error('无法创建 MQTT 连接，请检查连接配置');
		}
	}

	disconnect() {
		const active = this.active;
		this.active = undefined;
		if (active) {
			const force = !active.client.connected || active.pending.size > 0 || Object.keys(active.client.outgoing).length > 0;
			for (const reject of [...active.pending]) reject(new Error('连接已结束'));
			active.client.options.reconnectPeriod = 0;
			delete active.client.options.username;
			delete active.client.options.password;
			// 空闲连接发送 DISCONNECT 完成关闭握手；离线或未确认操作不能等待回执。
			active.client.end(force, {}, () => active.client.removeAllListeners());
		}
		this.events.status('disconnected');
	}

	publish(topic: string, payload: string, qos: MqttQos, retain: boolean) {
		validateMqttTopic(topic, false);
		return this.operation((client, done) => client.publish(topic, payload, { qos, retain }, (error) => done(error ? new Error('发布失败') : null)));
	}

	subscribe(topics: string[], qos: MqttQos) {
		if (!topics.length) throw new Error('请输入订阅主题');
		for (const topic of topics) validateMqttTopic(topic, true);
		return this.operation((client, done) =>
			client.subscribe([...new Set(topics)], { qos }, (error, grants) => {
				if (error || !grants?.length || grants.some((grant) => Number(grant.qos) > 2)) {
					done(new Error('订阅被拒绝，请检查主题权限'));
					// 部分主题获准时也结束 clean session，避免留下界面未记录的订阅。
					if (this.active?.client === client) this.disconnect();
				} else done();
			})
		);
	}

	unsubscribe(topics: string[]) {
		if (!topics.length) throw new Error('没有可取消的订阅');
		for (const topic of topics) validateMqttTopic(topic, true);
		return this.operation((client, done) => client.unsubscribe(topics, (error) => done(error ? new Error('取消订阅失败') : null)));
	}

	private operation(run: (client: MqttClient, done: (error?: Error | null) => void) => void): Promise<void> {
		const active = this.active;
		if (!active?.client.connected) return Promise.reject(new Error('请先连接 MQTT broker'));
		return new Promise((resolve, reject) => {
			let settled = false;
			const done = (error?: Error | null) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				active.pending.delete(cancel);
				if (error) reject(error);
				else if (this.active !== active) reject(new Error('连接已切换'));
				else resolve();
			};
			const cancel = (error: Error) => done(error);
			const timer = setTimeout(() => {
				done(new Error('操作确认超时，连接已关闭，请重新连接后重试'));
				if (this.active === active) this.disconnect();
			}, this.operationTimeout);
			active.pending.add(cancel);
			try {
				run(active.client, done);
			} catch {
				done(new Error('MQTT 操作失败'));
			}
		});
	}
}
