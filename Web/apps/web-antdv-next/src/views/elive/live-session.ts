export interface LiveProfile {
	accessToken: string;
	url: string;
}

export interface LivePlayer {
	dispose: () => void;
	resize: (width: number, height: number) => void;
}

export interface LivePlayerEvents {
	error: () => void;
	playing: () => void;
}

export type LivePhase = 'error' | 'idle' | 'loading' | 'playing';
export type LivePlayerFactory = (profile: LiveProfile, events: LivePlayerEvents, signal: AbortSignal) => Promise<LivePlayer>;

export function validateLiveProfile(profile: LiveProfile): LiveProfile {
	const accessToken = profile.accessToken.trim();
	const url = profile.url.trim();
	if (!accessToken || accessToken.length > 4096) throw new Error('请输入有效的访问 Token');
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error('请输入有效的 ezopen 视频地址');
	}
	if (
		url.length > 4096 ||
		/[\s<>"']/u.test(url) ||
		parsed.protocol !== 'ezopen:' ||
		!parsed.hostname ||
		parsed.hash ||
		!/^\/[\w-]+\/[1-9]\d*\.(?:hd\.)?(?:live|(?:cloud\.)?rec)$/u.test(parsed.pathname)
	) {
		throw new Error('视频地址应为 ezopen://主机/设备序列号/通道.live 或 .rec');
	}
	return { accessToken, url };
}

export class LiveSession {
	private active?: { controller: AbortController; player?: LivePlayer };
	private timer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly create: LivePlayerFactory,
		private readonly changed: (phase: LivePhase, error: string) => void,
		private readonly playbackTimeout = 45_000
	) {}

	resize(width: number, height: number) {
		if (width > 0 && height > 0) this.active?.player?.resize(width, height);
	}

	async start(profile: LiveProfile) {
		this.stop();
		let snapshot: LiveProfile;
		try {
			snapshot = validateLiveProfile(profile);
		} catch (error) {
			this.changed('error', error instanceof Error ? error.message : '播放配置无效');
			return;
		}
		const active = { controller: new AbortController(), player: undefined as LivePlayer | undefined };
		this.active = active;
		const current = () => this.active === active && !active.controller.signal.aborted;
		const failed = () => {
			if (!current()) return;
			this.stop();
			this.changed('error', '播放失败，请检查访问 Token、设备权限和视频地址后重试。');
		};
		this.changed('loading', '');
		this.timer = setTimeout(failed, this.playbackTimeout);
		try {
			const player = await this.create(
				snapshot,
				{
					error: failed,
					playing: () => {
						if (!current()) return;
						clearTimeout(this.timer);
						this.timer = undefined;
						this.changed('playing', '');
					},
				},
				active.controller.signal
			);
			if (current()) active.player = player;
			else player.dispose();
		} catch {
			failed();
		} finally {
			snapshot.accessToken = '';
			snapshot.url = '';
		}
	}

	stop() {
		const active = this.active;
		this.active = undefined;
		clearTimeout(this.timer);
		this.timer = undefined;
		active?.controller.abort();
		active?.player?.dispose();
		this.changed('idle', '');
	}
}
