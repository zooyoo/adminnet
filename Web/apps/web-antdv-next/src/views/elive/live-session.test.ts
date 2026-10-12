import type { LivePlayer, LivePlayerEvents, LiveProfile } from './live-session';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveSession, validateLiveProfile } from './live-session';

const profile = { accessToken: 'authorized-fixture-token', url: 'ezopen://open.ys7.com/DEVICE123/1.live' };
function fixture() {
	const player: LivePlayer = { dispose: vi.fn(), resize: vi.fn() };
	let callbacks: LivePlayerEvents | undefined;
	let signal: AbortSignal | undefined;
	let snapshot: LiveProfile | undefined;
	const changed = vi.fn();
	const create = vi.fn(async (config: LiveProfile, events: LivePlayerEvents, abort: AbortSignal) => {
		callbacks = events;
		signal = abort;
		snapshot = config;
		return player;
	});
	const session = new LiveSession(create, changed, 1000);
	return { session, player, create, changed, callbacks: () => callbacks!, signal: () => signal!, snapshot: () => snapshot! };
}
afterEach(() => vi.useRealTimers());

describe('直播配置', () => {
	it('保留原 ezopen 输入及高清、密码和回放地址', () => {
		for (const url of [profile.url, 'ezopen://code@open.ys7.com/DEVICE123/1.hd.live', 'ezopen://open.ys7.com/DEVICE123/1.rec?begin=20261012000000&end=20261012120000', 'ezopen://open.ys7.com/DEVICE123/1.cloud.rec']) {
			expect(validateLiveProfile({ ...profile, url }).url).toBe(url);
		}
	});
	it('拒绝空凭据、其他协议和无法解析的地址且不回显敏感输入', () => {
		expect(() => validateLiveProfile({ ...profile, accessToken: '' })).toThrow('访问 Token');
		for (const url of ['https://example.test/live.m3u8', 'javascript:alert(1)', 'ezopen://open.ys7.com/DEVICE123/0.live', 'ezopen://open.ys7.com/<secret>/1.live', 'bad-secret']) {
			expect(() => validateLiveProfile({ ...profile, url })).toThrow(/ezopen/);
		}
	});
});
describe('直播会话', () => {
	it('停止释放实例、取消生命周期并隔离迟到的播放与错误回执', async () => {
		const f = fixture();
		await f.session.start(profile);
		f.callbacks().playing();
		expect(f.changed).toHaveBeenLastCalledWith('playing', '');
		f.session.stop();
		expect(f.player.dispose).toHaveBeenCalledOnce();
		expect(f.signal().aborted).toBe(true);
		f.callbacks().playing();
		f.callbacks().error();
		expect(f.changed).toHaveBeenLastCalledWith('idle', '');
	});
	it('切换期间取消旧初始化并释放迟到的实例', async () => {
		let resolveOld: ((player: LivePlayer) => void) | undefined;
		const oldPlayer: LivePlayer = { dispose: vi.fn(), resize: vi.fn() };
		const nextPlayer: LivePlayer = { dispose: vi.fn(), resize: vi.fn() };
		const signals: AbortSignal[] = [];
		const create = vi.fn((_config: LiveProfile, _events: LivePlayerEvents, signal: AbortSignal) => {
			signals.push(signal);
			return signals.length === 1 ? new Promise<LivePlayer>((resolve) => { resolveOld = resolve; }) : Promise.resolve(nextPlayer);
		});
		const session = new LiveSession(create, vi.fn());
		const old = session.start(profile);
		await session.start({ ...profile, accessToken: 'second-fixture-token' });
		expect(signals[0]?.aborted).toBe(true);
		resolveOld?.(oldPlayer);
		await old;
		expect(oldPlayer.dispose).toHaveBeenCalledOnce();
		expect(nextPlayer.dispose).not.toHaveBeenCalled();
		session.stop();
	});
	it('初始化结束清除局部凭据但保留用户草稿', async () => {
		const f = fixture();
		await f.session.start(profile);
		expect(f.snapshot()).toEqual({ accessToken: '', url: '' });
		expect(profile.accessToken).toBe('authorized-fixture-token');
		f.session.stop();
	});
	it('真实错误路径销毁当前播放器，错误信息不采用 SDK 原文', async () => {
		const f = fixture();
		await f.session.start(profile);
		f.callbacks().error();
		expect(f.player.dispose).toHaveBeenCalledOnce();
		expect(f.changed).toHaveBeenLastCalledWith('error', '播放失败，请检查访问 Token、设备权限和视频地址后重试。');
	});
	it('播放超时会终止初始化，迟到实例不能恢复播放', async () => {
		vi.useFakeTimers();
		let resolvePlayer: ((player: LivePlayer) => void) | undefined;
		let signal: AbortSignal | undefined;
		const player: LivePlayer = { dispose: vi.fn(), resize: vi.fn() };
		const changed = vi.fn();
		const session = new LiveSession((_config, _events, abort) => {
			signal = abort;
			return new Promise((resolve) => { resolvePlayer = resolve; });
		}, changed, 1000);
		const pending = session.start(profile);
		await vi.advanceTimersByTimeAsync(1000);
		expect(signal?.aborted).toBe(true);
		expect(changed).toHaveBeenLastCalledWith('error', expect.any(String));
		resolvePlayer?.(player);
		await pending;
		expect(player.dispose).toHaveBeenCalledOnce();
	});
	it('无效配置不创建播放器，加载失败不泄露异常中的 Token', async () => {
		const f = fixture();
		await f.session.start({ ...profile, url: 'bad-address' });
		expect(f.create).not.toHaveBeenCalled();
		const changed = vi.fn();
		const session = new LiveSession(() => Promise.reject(new Error(profile.accessToken)), changed);
		await session.start(profile);
		expect(JSON.stringify(changed.mock.calls)).not.toContain(profile.accessToken);
	});
	it('仅为活动实例应用有效尺寸，成功后取消播放截止定时器', async () => {
		vi.useFakeTimers();
		const f = fixture();
		await f.session.start(profile);
		f.session.resize(640, 360);
		f.session.resize(0, 0);
		expect(f.player.resize).toHaveBeenCalledExactlyOnceWith(640, 360);
		f.callbacks().playing();
		await vi.advanceTimersByTimeAsync(1000);
		expect(f.player.dispose).not.toHaveBeenCalled();
		f.session.stop();
		f.session.resize(800, 450);
		expect(f.player.resize).toHaveBeenCalledOnce();
	});
});
