import { normalizeApiUrl } from './api-url';

export type OnlineStatus = 'connected' | 'connecting' | 'disconnected' | 'reconnecting';
export type OnlineEvent = 'OnlineUserList' | 'PublicNotice' | 'ReceiveMessage';
export type OnlineTokenProvider = () => Promise<string> | string;

export interface OnlineTransport {
	start: () => Promise<void>;
	stop: () => Promise<void>;
	on: (event: string, handler: (data: unknown) => void) => void;
	off: (event: string, handler: (data: unknown) => void) => void;
	onclose: (handler: () => void) => void;
	onreconnecting: (handler: () => void) => void;
	onreconnected: (handler: () => void) => void;
}

interface OnlineIdentity {
	version: number;
	token: OnlineTokenProvider;
	isCurrent: () => boolean;
	forcedOffline: () => Promise<void>;
}

export class OnlineSession {
	private active?: { identity: OnlineIdentity; connection: OnlineTransport; cleanup: () => void };
	private listeners = new Map<OnlineEvent, Set<(data: unknown) => void>>();
	private retry?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly create: (token: OnlineTokenProvider) => OnlineTransport,
		private readonly onStatus: (status: OnlineStatus) => void,
		private readonly retryDelay = 5000
	) {}

	connect(identity: OnlineIdentity) {
		if (this.active?.identity.version === identity.version && identity.isCurrent()) return;
		this.disconnect();
		const connection = this.create(async () => {
			if (this.active?.identity !== identity || !identity.isCurrent()) return '';
			const token = await identity.token();
			return this.active?.identity === identity && identity.isCurrent() ? token : '';
		});
		const handlers: Array<[string, (data: unknown) => void]> = [];
		const active = { identity, connection, cleanup: () => handlers.forEach(([event, handler]) => connection.off(event, handler)) };
		const current = () => this.active === active && identity.isCurrent();
		this.active = active;
		const register = (event: string, handler: (data: unknown) => void) => {
			handlers.push([event, handler]);
			connection.on(event, handler);
		};
		for (const event of ['OnlineUserList', 'PublicNotice', 'ReceiveMessage'] as const) {
			register(event, (data) => {
				if (current()) for (const listener of this.listeners.get(event) ?? []) listener(data);
			});
		}
		register('ForceOffline', () => {
			if (!current()) return;
			this.disconnect();
			void identity.forcedOffline().catch(() => {});
		});
		const retry = () => {
			if (!current() || this.retry !== undefined) return;
			this.retry = setTimeout(() => {
				this.retry = undefined;
				if (current()) void start();
			}, this.retryDelay);
		};
		const start = async () => {
			if (!current()) return;
			this.onStatus('connecting');
			try {
				await connection.start();
				if (current()) this.onStatus('connected');
				else await connection.stop();
			} catch {
				if (current()) {
					this.onStatus('disconnected');
					retry();
				}
			}
		};
		connection.onreconnecting(() => {
			if (current()) this.onStatus('reconnecting');
		});
		connection.onreconnected(() => {
			if (current()) this.onStatus('connected');
		});
		connection.onclose(() => {
			if (current()) {
				this.onStatus('disconnected');
				retry();
			}
		});
		void start();
	}

	disconnect() {
		const active = this.active;
		this.active = undefined;
		if (this.retry !== undefined) clearTimeout(this.retry);
		this.retry = undefined;
		active?.cleanup();
		if (active) void active.connection.stop().catch(() => {});
		this.onStatus('disconnected');
	}

	subscribe(event: OnlineEvent, listener: (data: unknown) => void) {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
		return () => {
			listeners.delete(listener);
		};
	}
}

export function onlineHubUrl(apiUrl: string) {
	return `${normalizeApiUrl(apiUrl)}/hubs/onlineUser`;
}
