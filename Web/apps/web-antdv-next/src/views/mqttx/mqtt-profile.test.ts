import { describe, expect, it } from 'vitest';

import { applyDeviceMessage, createDevicePayload, createDeviceState, createDeviceTopics, createMqttProfile, mqttConnectionUrl, redactMqttText, validateMqttTopic } from './mqtt-profile';

describe('MQTT 配置与旧设备协议', () => {
	it('连接地址仅接受主机和 WebSocket 协议，认证信息不进入 URL', () => {
		const profile = { ...createMqttProfile(), host: 'localhost', username: 'fixture', password: 'secret' };
		expect(mqttConnectionUrl(profile)).toBe('ws://localhost:8083/mqtt');
		for (const host of ['user:secret@localhost', 'localhost/mqtt', 'localhost?token=secret', 'ws://localhost', 'local host']) {
			expect(() => mqttConnectionUrl({ ...profile, host })).toThrow();
		}
		for (const port of [0, 65_536, 1.5]) expect(() => mqttConnectionUrl({ ...profile, port })).toThrow();
	});

	it('保留注册包主题与设备指令封装字段', () => {
		expect(createDeviceTopics('relay', 'sensor')).toEqual({
			subTopic: 'mqtt/admintnet/relay/out',
			willTopic: 'mqtt/admintnet/relay/will',
			dhtTopic: 'mqtt/admintnet/sensor/dht',
			pubTopic: 'mqtt/admintnet/relay/into',
		});
		expect(JSON.parse(createDevicePayload({ clientId: 'fixture-client', mqttToken: 'device-secret' }, '55 AA AA AA AA 91 CF'))).toEqual({
			token: 'device-secret', cmd: '55 AA AA AA AA 91 CF', cmdpara: '', clientid: 'fixture-client',
		});
	});

	it('校验发布与订阅通配符及主题字节数', () => {
		for (const topic of ['fixture/+', 'fixture/#']) expect(() => validateMqttTopic(topic, true)).not.toThrow();
		for (const topic of ['fixture/part+', 'fixture/#/part', '', 'nul\0topic', '中'.repeat(21_846)]) expect(() => validateMqttTopic(topic, true)).toThrow();
		for (const topic of ['fixture/+', 'fixture/#']) expect(() => validateMqttTopic(topic, false)).toThrow();
	});

	it('消息只能更新匹配注册包的设备，传感器坏值不会覆盖已有值', () => {
		const profile = { repacket: 'relay', dhtRegpack: 'sensor' };
		const topics = createDeviceTopics('relay', 'sensor');
		let state = createDeviceState();
		state = applyDeviceMessage(state, profile, topics, topics.subTopic, JSON.stringify({ regpacket: 'relay', redata: '55 AA AA AA AA 82 02 01' }));
		expect(state.channels).toEqual([false, true, false, false]);
		expect(applyDeviceMessage(state, profile, topics, topics.subTopic, JSON.stringify({ regpacket: 'another', redata: '55 AA AA AA AA 82 A4 01' }))).toBe(state);
		expect(applyDeviceMessage(state, profile, topics, 'unrelated/topic', JSON.stringify({ regpacket: 'relay', redata: '55 AA AA AA AA 82 A4 01' }))).toBe(state);
		state = applyDeviceMessage(state, profile, topics, topics.dhtTopic, JSON.stringify({ regpacket: 'sensor', temperature: 23.5, humidity: 60, runsec: 42 }));
		const invalid = applyDeviceMessage(state, profile, topics, topics.dhtTopic, JSON.stringify({ regpacket: 'sensor', temperature: 'bad', humidity: null }));
		expect(invalid).toMatchObject({ temperature: 23.5, humidity: 60, runSeconds: 42 });
	});

	it('共享传感器注册包留空时使用设备注册包接收温湿度', () => {
		const profile = { repacket: 'relay', dhtRegpack: '' };
		const topics = createDeviceTopics('relay', 'relay');
		const state = applyDeviceMessage(createDeviceState(), profile, topics, topics.dhtTopic, JSON.stringify({ regpacket: 'relay', temperature: 23.5, humidity: 60, runsec: 42 }));
		expect(state).toMatchObject({ temperature: 23.5, humidity: 60, runSeconds: 42 });
	});

	it('消息日志隐藏原文、URL 编码与 JSON 转义后的认证信息', () => {
		const secret = 'secret/"\n';
		const result = redactMqttText(`${secret}|${encodeURIComponent(secret)}|${JSON.stringify(secret).slice(1, -1)}`, [secret, '']);
		expect(result).toBe('[已隐藏]|[已隐藏]|[已隐藏]');
	});
});
