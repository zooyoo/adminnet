import type { SystemUpdateAction, SystemUpdateState } from './system-update';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canRunSystemUpdateAction, createSystemUpdateState, parseSystemUpdateBackups, parseSystemUpdateStatus, SystemUpdateSession } from './system-update';

const enabledStatus = { enabled: true, reason: '', targetName: '隔离更新目标', isRunning: false };
const backups = [{ fileName: 'release-01.zip', createTime: '2026-10-10 10:00:00' }, { fileName: 'release-02.zip', createTime: '2026-10-10 11:00:00' }];
const sessions: SystemUpdateSession[] = [];

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
	return { promise, resolve, reject };
}

async function flush() {
	for (let index = 0; index < 12; index++) await Promise.resolve();
}

function setup(overrides: Partial<ConstructorParameters<typeof SystemUpdateSession>[0]> = {}) {
	const controllers = new Set<AbortController>();
	const boundary = {
		version: 0,
		track: (controller: AbortController) => { controllers.add(controller); },
		release: (controller: AbortController) => { controllers.delete(controller); },
		invalidate: () => { boundary.version++; for (const controller of controllers) controller.abort(); controllers.clear(); },
	};
	let state = createSystemUpdateState();
	const changes: SystemUpdateState[] = [];
	const allowed = new Set<SystemUpdateAction>(['clear', 'restore', 'update', 'webHookKey']);
	const api = {
		fetchStatus: vi.fn(async (_signal: AbortSignal) => ({ ...enabledStatus })),
		fetchBackups: vi.fn(async (_signal: AbortSignal) => backups),
		fetchLogs: vi.fn(async (_signal: AbortSignal) => ['已保存的日志']),
		update: vi.fn(async (_signal: AbortSignal) => undefined),
		restore: vi.fn(async (_fileName: string, _signal: AbortSignal) => undefined),
		clear: vi.fn(async (_signal: AbortSignal) => undefined),
		fetchWebHookKey: vi.fn(async (_signal: AbortSignal) => 'private-webhook-key'),
		writeClipboard: vi.fn(async (_value: string) => undefined),
	};
	const session = new SystemUpdateSession({
		boundary, canView: () => true, can: (action) => allowed.has(action), ...api, ...overrides,
		onChange: (value) => { state = value; changes.push(value); overrides.onChange?.(value); },
	});
	sessions.push(session);
	return { session, api, boundary, controllers, allowed, changes, get state() { return state; } };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => { for (const session of sessions.splice(0)) session.dispose(); vi.useRealTimers(); });

describe('系统更新会话', () => {
	it('无查看权限不读取数据也不轮询', async () => {
		const h = setup({ canView: () => false });
		await h.session.activate();
		await vi.advanceTimersByTimeAsync(3000);
		expect(h.api.fetchStatus).not.toHaveBeenCalled();
		expect(h.api.fetchLogs).not.toHaveBeenCalled();
		expect(h.api.fetchBackups).not.toHaveBeenCalled();
		expect(h.state).toEqual(createSystemUpdateState());
	});

	it('慢日志请求期间不会堆积轮询，完成后才开始下一轮', async () => {
		const pending = deferred<string[]>();
		const fetchLogs = vi.fn((_signal: AbortSignal) => pending.promise);
		const h = setup({ fetchLogs });
		const initial = h.session.activate();
		await vi.advanceTimersByTimeAsync(3000);
		void h.session.refreshRecords();
		expect(fetchLogs).toHaveBeenCalledTimes(1);
		expect(h.api.fetchStatus).toHaveBeenCalledTimes(1);
		pending.resolve(['新日志']);
		await initial;
		await vi.advanceTimersByTimeAsync(299);
		expect(fetchLogs).toHaveBeenCalledTimes(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(fetchLogs).toHaveBeenCalledTimes(2);
	});

	it('KeepAlive 离页取消请求并拒绝迟到日志，重新激活可读取新记录', async () => {
		const pending = deferred<string[]>();
		const fetchLogs = vi.fn((_signal: AbortSignal) => Promise.resolve(['重新打开后的记录']));
		fetchLogs.mockImplementationOnce(() => pending.promise);
		const h = setup({ fetchLogs });
		const initial = h.session.activate();
		await flush();
		const signal = fetchLogs.mock.calls[0]![0];
		h.session.deactivate();
		expect(signal.aborted).toBe(true);
		expect(h.state.logs).toEqual([]);
		await h.session.activate();
		pending.resolve(['迟到且不可显示的记录']);
		await initial;
		expect(h.state.logs).toEqual(['重新打开后的记录']);
		h.session.deactivate();
		const count = fetchLogs.mock.calls.length;
		await vi.advanceTimersByTimeAsync(3000);
		expect(fetchLogs).toHaveBeenCalledTimes(count);
	});

	it('还原取消保留备份和日志，确认后才请求且忙状态持续到请求完成', async () => {
		const pending = deferred<void>();
		const restore = vi.fn((_fileName: string, _signal: AbortSignal) => pending.promise);
		const h = setup({ restore });
		await h.session.activate();
		h.session.selectBackup('release-02.zip');
		h.session.requestRestore();
		expect(h.state.confirmFileName).toBe('release-02.zip');
		expect(h.state.busy).toBeUndefined();
		h.session.cancelRestore();
		expect(restore).not.toHaveBeenCalled();
		expect(h.state.logs).toEqual(['已保存的日志']);
		expect(h.state.selectedFileName).toBe('release-02.zip');
		h.session.requestRestore();
		const execution = h.session.confirmRestore();
		expect(restore).toHaveBeenCalledWith('release-02.zip', expect.any(AbortSignal));
		expect(h.state.busy).toBe('restore');
		await h.session.update();
		await h.session.clearLogs();
		await h.session.copyWebHookKey();
		h.session.selectBackup('release-01.zip');
		expect(h.api.update).not.toHaveBeenCalled();
		expect(h.api.clear).not.toHaveBeenCalled();
		expect(h.api.fetchWebHookKey).not.toHaveBeenCalled();
		expect(h.state.selectedFileName).toBe('release-02.zip');
		await vi.advanceTimersByTimeAsync(1000);
		expect(h.state.busy).toBe('restore');
		expect(h.api.fetchLogs.mock.calls.length).toBeGreaterThan(1);
		pending.resolve();
		await execution;
		await flush();
		expect(h.state.busy).toBeUndefined();
		expect(h.state.feedback?.message).toBe('备份还原已完成');
		expect(h.api.fetchBackups).toHaveBeenCalledTimes(2);
	});

	it('更新直接执行，失败保留选择且不报告成功', async () => {
		const update = vi.fn(async (_signal: AbortSignal) => { throw new Error('backend physical path / secret'); });
		const h = setup({ update });
		await h.session.activate();
		h.session.selectBackup('release-01.zip');
		await h.session.update();
		expect(update).toHaveBeenCalledTimes(1);
		expect(h.state.selectedFileName).toBe('release-01.zip');
		expect(h.state.feedback).toEqual({ kind: 'error', message: '更新失败，请查看日志并重试' });
		expect(JSON.stringify(h.changes)).not.toContain('backend physical path');
	});

	it('还原失败保留选择并明确反馈', async () => {
		const restore = vi.fn(async (_fileName: string, _signal: AbortSignal) => { throw new Error('restore failed'); });
		const h = setup({ restore });
		await h.session.activate();
		h.session.selectBackup('release-02.zip');
		h.session.requestRestore();
		await h.session.confirmRestore();
		expect(h.state.selectedFileName).toBe('release-02.zip');
		expect(h.state.busy).toBeUndefined();
		expect(h.state.feedback?.kind).toBe('error');
	});

	it('清空服务失败保留日志，成功后拒绝清空前的迟到日志', async () => {
		const pending = deferred<string[]>();
		const fetchLogs = vi.fn((_signal: AbortSignal) => Promise.resolve(['已保存的日志']));
		const clear = vi.fn(async (_signal: AbortSignal): Promise<void> => { throw new Error('clear failed'); });
		const h = setup({ fetchLogs, clear });
		await h.session.activate();
		await h.session.clearLogs();
		await flush();
		expect(h.state.logs).toEqual(['已保存的日志']);
		expect(h.state.feedback?.kind).toBe('error');
		fetchLogs.mockImplementationOnce(() => pending.promise);
		await vi.advanceTimersByTimeAsync(300);
		const oldSignal = fetchLogs.mock.calls.at(-1)![0];
		clear.mockResolvedValueOnce(undefined);
		fetchLogs.mockResolvedValue([]);
		await h.session.clearLogs();
		await flush();
		expect(oldSignal.aborted).toBe(true);
		pending.resolve(['清空前的迟到日志']);
		await flush();
		expect(h.state.logs).toEqual([]);
		expect(h.state.feedback?.message).toBe('日志已清空');
	});

	it('目标禁用仍读取备份和日志并可清空，但不能更新还原或获取密钥', async () => {
		const h = setup({ fetchStatus: async () => ({ enabled: false, reason: '发布目标未配置', targetName: '', isRunning: false }) });
		await h.session.activate();
		h.session.selectBackup('release-01.zip');
		await h.session.update();
		h.session.requestRestore();
		await h.session.copyWebHookKey();
		expect(h.api.update).not.toHaveBeenCalled();
		expect(h.api.fetchWebHookKey).not.toHaveBeenCalled();
		expect(h.state.confirmFileName).toBe('');
		expect(h.state.backups).toHaveLength(2);
		expect(h.state.logs).toHaveLength(1);
		await h.session.clearLogs();
		expect(h.api.clear).toHaveBeenCalledTimes(1);
	});

	it('服务端繁忙禁止所有 mutation，日志轮询仍继续', async () => {
		const h = setup({ fetchStatus: async () => ({ ...enabledStatus, isRunning: true }) });
		await h.session.activate();
		h.session.selectBackup('release-01.zip');
		await h.session.update();
		h.session.requestRestore();
		await h.session.clearLogs();
		await h.session.copyWebHookKey();
		expect(h.api.update).not.toHaveBeenCalled();
		expect(h.api.clear).not.toHaveBeenCalled();
		expect(h.api.fetchWebHookKey).not.toHaveBeenCalled();
		await vi.advanceTimersByTimeAsync(600);
		expect(h.api.fetchLogs).toHaveBeenCalledTimes(3);
	});

	it('各按钮权限独立校验，页面权限变化取消会话后可恢复加载', async () => {
		const h = setup();
		await h.session.activate();
		h.allowed.delete('update');
		h.allowed.delete('restore');
		h.allowed.delete('webHookKey');
		h.session.selectBackup('release-01.zip');
		await h.session.update();
		h.session.requestRestore();
		await h.session.copyWebHookKey();
		expect(h.api.update).not.toHaveBeenCalled();
		expect(h.state.confirmFileName).toBe('');
		expect(h.api.fetchWebHookKey).not.toHaveBeenCalled();
		await h.session.clearLogs();
		expect(h.api.clear).toHaveBeenCalledTimes(1);
		h.session.dispose();
		expect(h.state).toEqual(createSystemUpdateState());
		const replacement = setup();
		await replacement.session.activate();
		expect(replacement.state.logs).toHaveLength(1);
	});

	it('身份边界取消 pending 复制请求，迟到密钥不写剪贴板且不进入状态', async () => {
		const pending = deferred<string>();
		const h = setup({ fetchWebHookKey: () => pending.promise });
		await h.session.activate();
		const operation = h.session.copyWebHookKey();
		h.boundary.invalidate();
		expect(h.state).toEqual(createSystemUpdateState());
		pending.resolve('late-private-key');
		await operation;
		expect(h.api.writeClipboard).not.toHaveBeenCalled();
		expect(JSON.stringify(h.changes)).not.toContain('late-private-key');
		await vi.advanceTimersByTimeAsync(3000);
		expect(h.api.fetchLogs).toHaveBeenCalledTimes(1);
	});

	it('密钥仅显式点击复制，成功和失败状态均不包含密钥', async () => {
		const h = setup();
		await h.session.activate();
		await vi.advanceTimersByTimeAsync(600);
		expect(h.api.fetchWebHookKey).not.toHaveBeenCalled();
		await h.session.copyWebHookKey();
		expect(h.api.writeClipboard).toHaveBeenCalledWith('private-webhook-key');
		expect(h.state.feedback?.message).toBe('WebHook 密钥已复制');
		h.api.writeClipboard.mockRejectedValueOnce(new Error('private-webhook-key'));
		await h.session.copyWebHookKey();
		expect(h.state.feedback?.kind).toBe('error');
		expect(JSON.stringify(h.changes)).not.toContain('private-webhook-key');
	});

	it('离页执行请求被取消观察，迟到完成不宣称后端操作取消或成功', async () => {
		const pending = deferred<void>();
		const update = vi.fn((_signal: AbortSignal) => pending.promise);
		const h = setup({ update });
		await h.session.activate();
		const operation = h.session.update();
		h.session.deactivate();
		expect(update.mock.calls[0]![0].aborted).toBe(true);
		pending.resolve();
		await operation;
		expect(h.state.feedback).toBeUndefined();
		expect(h.controllers.size).toBe(1);
		h.session.dispose();
		expect(h.controllers.size).toBe(0);
	});

	it('加载失败与空记录分别展示，并拒绝没有目标的可用状态', async () => {
		const h = setup({ fetchStatus: async () => ({ ...enabledStatus, targetName: '' }), fetchLogs: async () => { throw new Error('logs failed'); }, fetchBackups: async () => { throw new Error('backups failed'); } });
		await h.session.activate();
		expect(h.state.statusPhase).toBe('error');
		expect(h.state.backupPhase).toBe('error');
		expect(h.state.logsPhase).toBe('error');
		await h.session.update();
		expect(h.api.update).not.toHaveBeenCalled();
		const empty = setup({ fetchLogs: async () => [], fetchBackups: async () => [] });
		await empty.session.activate();
		expect(empty.state.backupPhase).toBe('ready');
		expect(empty.state.logsPhase).toBe('ready');
		expect(empty.state.backups).toEqual([]);
		expect(empty.state.logs).toEqual([]);
	});
});

describe('系统更新数据边界', () => {
	it('备份只保留公开文件名与创建时间，并拒绝物理路径', () => {
		expect(parseSystemUpdateBackups([{ ...backups[0], filePath: 'server/private/path' }])).toEqual([backups[0]]);
		expect(() => parseSystemUpdateBackups([{ fileName: 'C:\\private\\backup.zip', createTime: '' }])).toThrow();
		expect(() => parseSystemUpdateBackups(null)).toThrow();
	});
	it('状态只保留公开属性，禁用状态不要求存在目标', () => {
		expect(parseSystemUpdateStatus({ ...enabledStatus, configuration: 'secret' })).toEqual(enabledStatus);
		expect(parseSystemUpdateStatus({ enabled: false, reason: '未配置', targetName: '', isRunning: false }).enabled).toBe(false);
		expect(() => parseSystemUpdateStatus(null)).toThrow();
	});
	it('未知状态或无选中备份不能执行', () => {
		expect(canRunSystemUpdateAction(createSystemUpdateState(), 'update')).toBe(false);
		const state = { ...createSystemUpdateState(), status: enabledStatus, statusPhase: 'ready' as const };
		expect(canRunSystemUpdateAction(state, 'restore')).toBe(false);
	});
});
