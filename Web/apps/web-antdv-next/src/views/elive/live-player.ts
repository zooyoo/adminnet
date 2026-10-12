import type { LivePlayer, LivePlayerEvents, LiveProfile } from './live-session';

import sdkScriptUrl from 'ezuikit-js/ezuikit.js?url';

interface SdkPlayer {
	opt?: { accessToken?: string; url?: string };
	reSize: (width: number, height: number) => void;
	stop: () => unknown;
}
interface SdkOptions extends LiveProfile {
	autoplay: boolean;
	handleError: () => void;
	handleSuccess: () => void;
	height: number;
	id: string;
	template: string;
	useHardDev: boolean;
	width: number;
}
type SdkWindow = Window & { EZUIKit?: { EZUIKitPlayer: new (options: SdkOptions) => SdkPlayer } };

// standard 模板返回没有 destroy 方法的旧式播放器，整个 SDK 必须位于可移除的 iframe 中。
export function createLivePlayer(container: HTMLElement, profile: LiveProfile, events: LivePlayerEvents, signal: AbortSignal): Promise<LivePlayer> {
	return new Promise((resolve, reject) => {
		const frame = document.createElement('iframe');
		frame.title = '直播播放器';
		frame.className = 'live-player-frame';
		frame.allow = 'autoplay; fullscreen; microphone; camera';
		frame.allowFullscreen = true;
		frame.referrerPolicy = 'no-referrer';
		frame.style.cssText = 'width:100%;height:100%;border:0;display:block';
		frame.srcdoc = '<!doctype html><html lang="zh-CN"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#111}#video-container{width:100%;height:100%}</style></head><body><div id="video-container"></div></body></html>';
		let player: SdkPlayer | undefined;
		let disposed = false;
		let script: HTMLScriptElement | undefined;
		const dispose = () => {
			if (disposed) return;
			disposed = true;
			signal.removeEventListener('abort', abort);
			frame.onload = null;
			if (script) {
				script.onload = null;
				script.onerror = null;
			}
			try {
				if (player) void Promise.resolve(player.stop()).catch(() => {});
			} catch {
				// 初始化失败时 stop 可能不可用；移除 iframe 仍会销毁其执行环境。
			}
			if (player?.opt) {
				player.opt.accessToken = '';
				player.opt.url = '';
			}
			player = undefined;
			frame.remove();
		};
		const abort = () => {
			dispose();
			reject(new Error('播放已取消'));
		};
		if (signal.aborted) {
			abort();
			return;
		}
		signal.addEventListener('abort', abort, { once: true });
		frame.onload = () => {
			frame.onload = null;
			const child = frame.contentWindow as null | SdkWindow;
			if (!child || signal.aborted) {
				abort();
				return;
			}
			script = child.document.createElement('script');
			script.src = new URL(sdkScriptUrl, document.baseURI).href;
			script.onerror = () => {
				dispose();
				reject(new Error('播放器资源加载失败'));
			};
			script.onload = () => {
				if (disposed || signal.aborted) return;
				try {
					if (!child.EZUIKit) throw new Error('播放器资源无效');
					player = new child.EZUIKit.EZUIKitPlayer({
						...profile,
						autoplay: true,
						id: 'video-container',
						template: 'standard',
						useHardDev: true,
						width: container.clientWidth,
						height: container.clientHeight,
						handleSuccess: () => { if (!disposed && !signal.aborted) events.playing(); },
						handleError: () => { if (!disposed && !signal.aborted) events.error(); },
					});
					resolve({ dispose, resize: (width, height) => { if (!disposed) player?.reSize(width, height); } });
				} catch {
					dispose();
					reject(new Error('播放器初始化失败'));
				}
			};
			child.document.head.append(script);
		};
		container.append(frame);
	});
}
