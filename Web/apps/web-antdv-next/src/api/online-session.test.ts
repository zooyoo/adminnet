import { afterEach, describe, expect, it, vi } from 'vitest';

import { onlineHubUrl, OnlineSession, type OnlineTokenProvider, type OnlineTransport } from './online-session';

function fixture(failFirst = false) {
	let version = 1;
	let token: Promise<string> | string = 'first-token';
	const transports: Array<OnlineTransport & { events: Map<string, (data: unknown) => void>; token: OnlineTokenProvider; closed: () => void; reconnected: () => void }> = [];
	const status = vi.fn();
	const forcedOffline = vi.fn(async () => {});
	const session = new OnlineSession(
		(getToken) => {
			const events = new Map<string, (data: unknown) => void>();
			const start = vi.fn(async () => {});
			if (failFirst) start.mockRejectedValueOnce(new Error('Offline'));
			const transport = {
				token: getToken,
				events,
				start,
				stop: vi.fn(async () => {}),
				on: vi.fn((event: string, handler: (data: unknown) => void) => {
					events.set(event, handler);
				}),
				off: vi.fn((event: string) => {
					events.delete(event);
				}),
				closed: () => {},
				reconnected: () => {},
				onclose(handler: () => void) {
					this.closed = handler;
				},
				onreconnecting: vi.fn(),
				onreconnected(handler: () => void) {
					this.reconnected = handler;
				},
			};
			transports.push(transport);
			return transport;
		},
		status,
		100
	);
	const connect = () => {
		const current = version;
		session.connect({ version: current, token: () => token, isCurrent: () => current === version, forcedOffline });
	};
	return {
		session,
		transports,
		status,
		forcedOffline,
		connect,
		setToken: (value: Promise<string> | string) => {
			token = value;
		},
		changeIdentity: () => {
			version++;
		},
	};
}

afterEach(() => {
	vi.useRealTimers();
});

describe('online session lifecycle', () => {
	it('creates one connection per identity and reads the latest token', async () => {
		const state = fixture();
		state.connect();
		state.connect();
		await Promise.resolve();
		expect(state.transports).toHaveLength(1);
		expect(await state.transports[0]!.token()).toBe('first-token');
		state.setToken('renewed-token');
		expect(await state.transports[0]!.token()).toBe('renewed-token');
		expect(state.status).toHaveBeenLastCalledWith('connected');
		state.session.disconnect();
	});

	it('suppresses events and credentials from the previous tenant connection', async () => {
		const state = fixture();
		const received = vi.fn();
		state.session.subscribe('OnlineUserList', received);
		state.connect();
		const old = state.transports[0]!;
		const late = old.events.get('OnlineUserList')!;
		state.changeIdentity();
		state.connect();
		await Promise.resolve();
		late({ online: true });
		old.reconnected();
		expect(await old.token()).toBe('');
		expect(old.stop).toHaveBeenCalled();
		expect(received).not.toHaveBeenCalled();
		state.transports[1]!.events.get('OnlineUserList')!({ online: true });
		expect(received).toHaveBeenCalledTimes(1);
		state.session.disconnect();
	});

	it('stops once and expires only the current identity when forced offline', () => {
		const state = fixture();
		state.connect();
		const force = state.transports[0]!.events.get('ForceOffline')!;
		force('reason');
		force('reason');
		expect(state.forcedOffline).toHaveBeenCalledTimes(1);
		expect(state.transports[0]!.stop).toHaveBeenCalledTimes(1);
		expect(state.transports[0]!.events.size).toBe(0);
	});

	it('cancels reconnection timers on logout', async () => {
		vi.useFakeTimers();
		const state = fixture();
		state.connect();
		await Promise.resolve();
		state.transports[0]!.closed();
		state.session.disconnect();
		await vi.advanceTimersByTimeAsync(200);
		expect(state.transports[0]!.start).toHaveBeenCalledTimes(1);
	});

	it('does not let a late start restore a stopped connection', async () => {
		let resolve!: () => void;
		const transport: OnlineTransport = {
			start: () =>
				new Promise<void>((done) => {
					resolve = done;
				}),
			stop: vi.fn(async () => {}),
			on: vi.fn(),
			off: vi.fn(),
			onclose: vi.fn(),
			onreconnecting: vi.fn(),
			onreconnected: vi.fn(),
		};
		const status = vi.fn();
		const session = new OnlineSession(() => transport, status);
		session.connect({ version: 1, token: () => 'token', isCurrent: () => true, forcedOffline: vi.fn() });
		session.disconnect();
		resolve();
		await Promise.resolve();
		expect(status).not.toHaveBeenCalledWith('connected');
		expect(transport.stop).toHaveBeenCalled();
	});

	it('awaits the old transport stop without retaining its credentials or replacing a new identity', async () => {
		const state = fixture();
		state.connect();
		await Promise.resolve();
		const old = state.transports[0]!;
		let finishStop!: () => void;
		vi.mocked(old.stop).mockReturnValueOnce(new Promise<void>((resolve) => { finishStop = resolve; }));
		let stopped = false;
		const pending = state.session.disconnect().then(() => { stopped = true; });
		await Promise.resolve();
		expect(stopped).toBe(false);
		expect(old.events.size).toBe(0);
		expect(await old.token()).toBe('');
		state.changeIdentity();
		state.connect();
		await Promise.resolve();
		expect(await state.transports[1]!.token()).toBe('first-token');
		finishStop();
		await pending;
		expect(stopped).toBe(true);
		expect(state.status).toHaveBeenLastCalledWith('connected');
		expect(state.transports[1]!.stop).not.toHaveBeenCalled();
		await state.session.disconnect();
	});

	it('retries a failed initial handshake without duplicating event handlers', async () => {
		vi.useFakeTimers();
		const state = fixture(true);
		state.connect();
		await Promise.resolve();
		const transport = state.transports[0]!;
		expect(state.status).toHaveBeenLastCalledWith('disconnected');
		await vi.advanceTimersByTimeAsync(100);
		expect(state.status).toHaveBeenLastCalledWith('connected');
		expect(transport.on).toHaveBeenCalledTimes(4);
		state.session.disconnect();
	});

	it('never returns a late token renewal to an obsolete connection', async () => {
		const state = fixture();
		let finish!: (token: string) => void;
		state.setToken(
			new Promise<string>((resolve) => {
				finish = resolve;
			})
		);
		state.connect();
		const pendingToken = state.transports[0]!.token();
		state.changeIdentity();
		state.setToken('new-identity-token');
		state.connect();
		finish('old-identity-token');
		expect(await pendingToken).toBe('');
		expect(await state.transports[1]!.token()).toBe('new-identity-token');
		state.session.disconnect();
	});

	it('removes subscribers when their view closes', () => {
		const state = fixture();
		const receive = vi.fn();
		const dispose = state.session.subscribe('PublicNotice', receive);
		state.connect();
		dispose();
		state.transports[0]!.events.get('PublicNotice')!({});
		expect(receive).not.toHaveBeenCalled();
		state.session.disconnect();
	});

	it.each([
		['/prod-api', '/prod-api/hubs/onlineUser'],
		['https://example.test/gateway/', 'https://example.test/gateway/hubs/onlineUser'],
		['', '/hubs/onlineUser'],
	])('uses the configured API root %s', (root, expected) => {
		expect(onlineHubUrl(root)).toBe(expected);
	});
});
