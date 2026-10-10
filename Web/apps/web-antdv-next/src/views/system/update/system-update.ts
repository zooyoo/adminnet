import type { SystemUpdateBackup, SystemUpdateStatus } from '#/api/system/update';

export type SystemUpdateAction = 'clear' | 'restore' | 'update' | 'webHookKey';
type LoadPhase = 'error' | 'idle' | 'loading' | 'ready';

export interface SystemUpdateState {
	status?: SystemUpdateStatus;
	statusPhase: LoadPhase;
	statusError: string;
	backups: SystemUpdateBackup[];
	backupPhase: LoadPhase;
	backupError: string;
	logs: string[];
	logsPhase: LoadPhase;
	logsError: string;
	selectedFileName: string;
	confirmFileName: string;
	busy?: SystemUpdateAction;
	feedback?: { kind: 'error' | 'success'; message: string };
}

interface Boundary {
	readonly version: number;
	track: (controller: AbortController) => void;
	release: (controller: AbortController) => void;
}

interface SystemUpdateSessionOptions {
	boundary: Boundary;
	canView: () => boolean;
	can: (action: SystemUpdateAction) => boolean;
	fetchStatus: (signal: AbortSignal) => Promise<SystemUpdateStatus>;
	fetchBackups: (signal: AbortSignal) => Promise<SystemUpdateBackup[]>;
	fetchLogs: (signal: AbortSignal) => Promise<string[]>;
	update: (signal: AbortSignal) => Promise<void>;
	restore: (fileName: string, signal: AbortSignal) => Promise<void>;
	clear: (signal: AbortSignal) => Promise<void>;
	fetchWebHookKey: (signal: AbortSignal) => Promise<string>;
	writeClipboard: (value: string) => Promise<void>;
	onChange: (state: SystemUpdateState) => void;
}

interface Flight {
	controller: AbortController;
	promise: Promise<void>;
}

export function createSystemUpdateState(): SystemUpdateState {
	return { statusPhase: 'idle', statusError: '', backups: [], backupPhase: 'idle', backupError: '', logs: [], logsPhase: 'idle', logsError: '', selectedFileName: '', confirmFileName: '' };
}

export function parseSystemUpdateStatus(value: unknown): SystemUpdateStatus {
	if (!value || typeof value !== 'object') throw new Error('系统更新状态格式无效');
	const status = value as SystemUpdateStatus;
	if (typeof status.enabled !== 'boolean' || typeof status.isRunning !== 'boolean' || typeof status.reason !== 'string' || typeof status.targetName !== 'string' || (status.enabled && !status.targetName.trim())) {
		throw new Error('系统更新状态格式无效');
	}
	return { enabled: status.enabled, reason: status.reason, targetName: status.targetName, isRunning: status.isRunning };
}

export function parseSystemUpdateBackups(value: unknown): SystemUpdateBackup[] {
	if (!Array.isArray(value) || value.some((item) => !item || typeof item.fileName !== 'string' || !item.fileName.trim() || /[/\\]/.test(item.fileName) || typeof item.createTime !== 'string')) {
		throw new Error('备份记录格式无效');
	}
	return value.map((item) => ({ fileName: item.fileName, createTime: item.createTime }));
}

export function canRunSystemUpdateAction(state: SystemUpdateState, action: SystemUpdateAction) {
	if (state.busy || state.statusPhase !== 'ready' || !state.status || state.status.isRunning) return false;
	if (state.confirmFileName && action !== 'restore') return false;
	if (action === 'clear') return true;
	if (!state.status.enabled) return false;
	return action !== 'restore' || state.backups.some((item) => item.fileName === state.selectedFileName);
}

// 轮询与执行分开管理；关闭页面只停止前端观察，不表示服务端发布被取消。
export class SystemUpdateSession {
	private active = false;
	private backupFlight?: Flight;
	private generation = 0;
	private readonly identityVersion: number;
	private readonly lifetime = new AbortController();
	private observation?: Flight;
	private readonly requests = new Set<AbortController>();
	private state = createSystemUpdateState();
	private timer?: ReturnType<typeof setTimeout>;

	constructor(private readonly options: SystemUpdateSessionOptions) {
		this.identityVersion = options.boundary.version;
		options.boundary.track(this.lifetime);
		this.lifetime.signal.addEventListener('abort', this.clearIdentity);
	}

	activate() {
		if (this.active || this.lifetime.signal.aborted || !this.options.canView()) return;
		this.active = true;
		return this.refreshRecords();
	}

	cancelRestore() {
		if (this.current()) this.publish({ confirmFileName: '' });
	}

	clearLogs() {
		return this.execute('clear', this.options.clear);
	}

	confirmRestore() {
		const fileName = this.state.confirmFileName;
		if (!fileName || fileName !== this.state.selectedFileName || !this.canPerform('restore')) return;
		this.publish({ confirmFileName: '' });
		return this.execute('restore', (signal) => this.options.restore(fileName, signal));
	}

	copyWebHookKey() {
		return this.execute('webHookKey', async (signal) => {
			// 密钥只存在于本次显式复制操作的局部作用域中。
			const key = await this.options.fetchWebHookKey(signal);
			if (signal.aborted || !this.current()) return;
			if (typeof key !== 'string' || !key.trim()) throw new Error('密钥响应无效');
			await this.options.writeClipboard(key);
		});
	}

	deactivate() {
		this.active = false;
		this.reset();
	}

	dispose() {
		this.deactivate();
		this.lifetime.signal.removeEventListener('abort', this.clearIdentity);
		this.lifetime.abort();
		this.options.boundary.release(this.lifetime);
	}

	invalidateIdentity() {
		this.lifetime.abort();
	}

	async refreshRecords() {
		if (!this.current()) return;
		await Promise.all([this.observe(), this.readBackups()]);
	}

	requestRestore() {
		if (this.canPerform('restore') && !this.state.confirmFileName) this.publish({ confirmFileName: this.state.selectedFileName });
	}

	selectBackup(fileName: string) {
		if (this.current() && !this.state.busy && !this.state.confirmFileName) this.publish({ selectedFileName: fileName });
	}

	update() {
		return this.execute('update', this.options.update);
	}

	private canPerform(action: SystemUpdateAction) {
		return this.current() && this.options.can(action) && canRunSystemUpdateAction(this.state, action);
	}

	private readonly clearIdentity = () => {
		this.active = false;
		this.reset();
	};

	private current(generation = this.generation) {
		return this.active && this.options.canView() && !this.lifetime.signal.aborted && this.options.boundary.version === this.identityVersion && generation === this.generation;
	}

	private async execute(action: SystemUpdateAction, operation: (signal: AbortSignal) => Promise<void>) {
		if (!this.canPerform(action)) return;
		const generation = this.generation;
		const controller = this.track();
		this.publish({ busy: action, feedback: undefined });
		try {
			await operation(controller.signal);
			if (!this.current(generation) || controller.signal.aborted) return;
			if (action === 'clear') {
				this.stopObservation();
				this.publish({ logs: [], logsPhase: 'ready', logsError: '' });
			}
			const messages = { update: '系统更新已完成', restore: '备份还原已完成', clear: '日志已清空', webHookKey: 'WebHook 密钥已复制' };
			this.publish({ feedback: { kind: 'success', message: messages[action] } });
		} catch {
			if (this.current(generation) && !controller.signal.aborted) {
				const messages = { update: '更新失败，请查看日志并重试', restore: '还原失败，已保留选中的备份，请查看日志并重试', clear: '清空日志失败，已有日志已保留', webHookKey: '复制 WebHook 密钥失败，请检查剪贴板权限后重试' };
				this.publish({ feedback: { kind: 'error', message: messages[action] } });
			}
		} finally {
			this.release(controller);
			if (this.current(generation)) {
				this.publish({ busy: undefined });
				if (action !== 'webHookKey') {
					this.stopObservation();
					void this.refreshRecords();
				}
			}
		}
	}

	private observe(): Promise<void> {
		if (!this.current()) return Promise.resolve();
		if (this.observation) return this.observation.promise;
		this.stopTimer();
		const generation = this.generation;
		const controller = this.track();
		const valid = () => this.current(generation) && !controller.signal.aborted;
		this.publish({ statusPhase: this.state.statusPhase === 'ready' ? 'ready' : 'loading', logsPhase: this.state.logsPhase === 'ready' ? 'ready' : 'loading' });
		const status = async () => {
			try {
				const value = parseSystemUpdateStatus(await this.options.fetchStatus(controller.signal));
				if (valid()) this.publish({ status: value, statusPhase: 'ready', statusError: '' });
			} catch {
				if (valid()) this.publish({ status: undefined, statusPhase: 'error', statusError: '无法读取系统更新状态，请刷新记录重试' });
			}
		};
		const logs = async () => {
			try {
				const value = await this.options.fetchLogs(controller.signal);
				if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw new Error('日志格式无效');
				if (valid()) this.publish({ logs: [...value], logsPhase: 'ready', logsError: '' });
			} catch {
				if (valid()) this.publish({ logsPhase: 'error', logsError: '无法读取更新日志，已有日志可能不是最新记录' });
			}
		};
		const promise = Promise.all([status(), logs()]).then(() => undefined).finally(() => {
			this.release(controller);
			if (this.observation?.controller === controller) {
				this.observation = undefined;
				if (valid()) this.timer = setTimeout(() => void this.observe(), 300);
			}
		});
		this.observation = { controller, promise };
		return promise;
	}

	private publish(patch: Partial<SystemUpdateState>) {
		this.state = { ...this.state, ...patch };
		this.options.onChange({ ...this.state, backups: this.state.backups.map((item) => ({ ...item })), logs: [...this.state.logs] });
	}

	private readBackups(): Promise<void> {
		if (!this.current()) return Promise.resolve();
		if (this.backupFlight) return this.backupFlight.promise;
		const generation = this.generation;
		const controller = this.track();
		this.publish({ backupPhase: 'loading', backupError: '' });
		const promise = (async () => {
			try {
				const value = parseSystemUpdateBackups(await this.options.fetchBackups(controller.signal));
				if (this.current(generation) && !controller.signal.aborted) this.publish({ backups: value, backupPhase: 'ready', backupError: '' });
			} catch {
				if (this.current(generation) && !controller.signal.aborted) this.publish({ backupPhase: 'error', backupError: '无法读取备份记录，已保留当前选择，请刷新记录重试' });
			} finally {
				this.release(controller);
				if (this.backupFlight?.controller === controller) this.backupFlight = undefined;
			}
		})();
		this.backupFlight = { controller, promise };
		return promise;
	}

	private release(controller: AbortController) {
		this.requests.delete(controller);
		this.options.boundary.release(controller);
	}

	private reset() {
		this.generation++;
		this.stopTimer();
		for (const controller of this.requests) {
			controller.abort();
			this.options.boundary.release(controller);
		}
		this.requests.clear();
		this.observation = undefined;
		this.backupFlight = undefined;
		this.state = createSystemUpdateState();
		this.publish({});
	}

	private stopObservation() {
		this.stopTimer();
		if (this.observation) {
			this.observation.controller.abort();
			this.release(this.observation.controller);
			this.observation = undefined;
		}
	}

	private stopTimer() {
		if (this.timer !== undefined) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private track() {
		const controller = new AbortController();
		this.requests.add(controller);
		this.options.boundary.track(controller);
		return controller;
	}
}
