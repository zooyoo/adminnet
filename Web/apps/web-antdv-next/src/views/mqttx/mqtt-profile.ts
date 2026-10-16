export type MqttQos = 0 | 1 | 2;

export interface MqttProfile {
	protocol: 'ws' | 'wss';
	host: string;
	port: number;
	clientId: string;
	username: string;
	password: string;
	repacket: string;
	dhtRegpack: string;
	mqttToken: string;
	keepalive: number;
	connectTimeout: number;
	reconnectPeriod: number;
}

export interface DeviceTopics {
	subTopic: string;
	willTopic: string;
	dhtTopic: string;
	pubTopic: string;
}

export interface DeviceState {
	channels: boolean[];
	online: boolean | null;
	isAC: boolean | null;
	temperature: null | number;
	humidity: null | number;
	time: string;
	runSeconds: null | number;
}

export function createMqttProfile(): MqttProfile {
	return {
		protocol: 'ws',
		host: '',
		port: 8083,
		clientId: `adminnet_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`,
		username: '',
		password: '',
		repacket: '',
		dhtRegpack: '',
		mqttToken: '',
		keepalive: 30,
		connectTimeout: 30_000,
		reconnectPeriod: 5000,
	};
}

export function mqttConnectionUrl(profile: MqttProfile): string {
	if (!['ws', 'wss'].includes(profile.protocol)) throw new Error('协议必须为 ws 或 wss');
	const host = profile.host.trim();
	if (!host || /[\s/@?#\\]/.test(host)) throw new Error('请输入主机名或 IP，不包含协议、路径或凭据');
	if (!Number.isInteger(profile.port) || profile.port < 1 || profile.port > 65_535) throw new Error('端口必须为 1 至 65535');
	if (!profile.clientId.trim() || profile.clientId.includes('\0')) throw new Error('请输入有效的 Client ID');
	for (const [value, min, max] of [
		[profile.keepalive, 0, 65_535],
		[profile.connectTimeout, 1000, 120_000],
		[profile.reconnectPeriod, 0, 60_000],
	] as const) {
		if (!Number.isInteger(value) || value < min || value > max) throw new Error('连接超时、保活或重连间隔无效');
	}
	const url = new URL(`${profile.protocol}://${host}:${profile.port}/mqtt`);
	if (url.username || url.password || url.pathname !== '/mqtt') throw new Error('连接地址无效');
	return url.href;
}

export function createDeviceTopics(repacket: string, dhtRegpack: string): DeviceTopics {
	for (const value of [repacket, dhtRegpack]) {
		if (!value.trim() || /[/+#\0]/.test(value)) throw new Error('设备包名不能为空或包含 /、+、#');
	}
	return {
		subTopic: `mqtt/admintnet/${repacket}/out`,
		willTopic: `mqtt/admintnet/${repacket}/will`,
		dhtTopic: `mqtt/admintnet/${dhtRegpack}/dht`,
		pubTopic: `mqtt/admintnet/${repacket}/into`,
	};
}

export function validateMqttTopic(topic: string, subscribe: boolean): void {
	if (!topic || topic.includes('\0') || new TextEncoder().encode(topic).length > 65_535) throw new Error('主题不能为空、过长或包含空字符');
	const levels = topic.split('/');
	if (levels.some((level, index) => (level.includes('+') && (!subscribe || level !== '+')) || (level.includes('#') && (!subscribe || level !== '#' || index !== levels.length - 1)))) {
		throw new Error('发布主题不能包含通配符；订阅的 + 须独占层级，# 须为最后一层');
	}
}

export function createDevicePayload(profile: Pick<MqttProfile, 'clientId' | 'mqttToken'>, command: string): string {
	return JSON.stringify({ token: profile.mqttToken, cmd: command, cmdpara: '', clientid: profile.clientId });
}

export function createDeviceState(): DeviceState {
	return { channels: [false, false, false, false], online: null, isAC: null, temperature: null, humidity: null, time: '', runSeconds: null };
}

export function applyDeviceMessage(state: DeviceState, profile: Pick<MqttProfile, 'dhtRegpack' | 'repacket'>, topics: DeviceTopics, topic: string, payload: string): DeviceState {
	let data: Record<string, unknown>;
	try {
		const parsed: unknown = JSON.parse(payload);
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return state;
		data = parsed as Record<string, unknown>;
	} catch {
		return state;
	}
	if (topic === topics.dhtTopic && data.regpacket === (profile.dhtRegpack || profile.repacket)) {
		const numberOrPrevious = (value: unknown, previous: null | number) => (typeof value === 'number' && Number.isFinite(value) ? value : previous);
		return {
			...state,
			temperature: numberOrPrevious(data.temperature, state.temperature),
			humidity: numberOrPrevious(data.humidity, state.humidity),
			runSeconds: numberOrPrevious(data.runsec, state.runSeconds),
			time: typeof data.time === 'string' ? data.time : state.time,
		};
	}
	if (data.regpacket !== profile.repacket) return state;
	if (topic === topics.willTopic) {
		if (data.redata === 'online' || data.redata === 'offline') return { ...state, online: data.redata === 'online' };
		return state;
	}
	if (topic !== topics.subTopic || typeof data.redata !== 'string') return state;
	const command = /^55 AA AA AA AA 82 (0[1-4]|A4) (0[01])$/.exec(data.redata);
	if (command) {
		const channels = [...state.channels];
		if (command[1] === 'A4') channels.fill(command[2] === '01');
		else channels[Number(command[1]) - 1] = command[2] === '01';
		return { ...state, channels };
	}
	if (/^55 AA AA AA AA 84 AC 0[01]$/.test(data.redata)) return { ...state, isAC: data.redata.endsWith('01') };
	return state;
}

export function redactMqttText(text: string, secrets: string[]): string {
	let result = text;
	for (const secret of secrets.filter(Boolean).sort((a, b) => b.length - a.length)) {
		for (const representation of new Set([encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), secret])) {
			result = result.replaceAll(representation, '[已隐藏]');
		}
	}
	return result;
}
