import type { PluginApi, PluginPage, PluginRow } from '#/api/system/plugin';

import { describe, expect, it, vi } from 'vitest';

import { SessionBoundary } from '../../../api/session';
import { createPluginState, PluginSession } from './plugin-session';

const row: PluginRow = { id: '12', name: '插件', csharpCode: 'public class A {}', status: 1, orderNo: 100, tenantId: '1' };
function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}
function setup() {
	const state = createPluginState();
	const boundary = new SessionBoundary();
	const permissions = { page: true, add: true, update: true, delete: true };
	const identity = { value: 'first' };
	const api = {
		page: vi.fn<PluginApi['page']>().mockResolvedValue({ items: [row], total: 1 }),
		add: vi.fn<PluginApi['add']>().mockResolvedValue(undefined),
		update: vi.fn<PluginApi['update']>().mockResolvedValue(undefined),
		delete: vi.fn<PluginApi['delete']>().mockResolvedValue(undefined),
	};
	const session = new PluginSession(state, { api, boundary, identity: () => identity.value, permissions: () => permissions });
	return { state, boundary, permissions, identity, api, session };
}

describe('插件会话隔离', () => {
	it('离页中止查询，即使接口忽略取消也不回填', async () => {
		const h = setup();
		const result = deferred<PluginPage>();
		h.api.page.mockReturnValue(result.promise);
		h.session.activate();
		const signal = h.api.page.mock.calls[0]![1];
		h.session.deactivate();
		expect(signal.aborted).toBe(true);
		result.resolve({ items: [row], total: 1 });
		await result.promise;
		await Promise.resolve();
		expect(h.state.items).toEqual([]);
		expect(h.state.listBusy).toBe(false);
	});

	it('较早查询晚返回不会覆盖较新的筛选结果', async () => {
		const h = setup();
		const first = deferred<PluginPage>();
		h.api.page.mockReturnValueOnce(first.promise);
		h.session.activate();
		h.state.name = 'new';
		h.api.page.mockResolvedValue({ items: [], total: 0 });
		await h.session.loadPage();
		first.resolve({ items: [row], total: 1 });
		await first.promise;
		expect(h.state.items).toEqual([]);
	});

	it('保存失败保留编辑器原文与可重试状态', async () => {
		const h = setup();
		h.session.activate();
		h.session.openEditor(row);
		h.state.draft.csharpCode = '保留\r\n草稿';
		h.api.update.mockRejectedValue(new Error('offline'));
		await h.session.save();
		expect(h.state.editorOpen).toBe(true);
		expect(h.state.draft.csharpCode).toBe('保留\r\n草稿');
		expect(h.state.editorError).toContain('结果未确认');
		expect(h.state.saveBusy).toBe(false);
	});

	it('业务编译诊断可见且原文草稿保留', async () => {
		const h = setup();
		h.session.activate();
		h.session.openEditor(row);
		h.api.update.mockRejectedValue(Object.assign(new Error('CS1002: 应输入 ;'), { code: 'ERR_ADMIN_RESULT' }));
		await h.session.save();
		expect(h.state.editorError).toContain('CS1002: 应输入 ;');
		expect(h.state.editorError).toContain('草稿已保留');
		expect(h.state.draft.csharpCode).toBe(row.csharpCode);
		expect(h.state.saveBusy).toBe(false);
	});

	it('身份切换清除草稿，旧保存成功不能显示通知或查询新身份', async () => {
		const h = setup();
		const result = deferred<unknown>();
		h.api.update.mockReturnValue(result.promise);
		h.session.activate();
		h.session.openEditor(row);
		const saved = h.session.save();
		h.identity.value = 'second';
		h.boundary.invalidate();
		h.session.contextChanged(false);
		result.resolve(undefined);
		await saved;
		expect(h.state.editorOpen).toBe(false);
		expect(h.state.draft.csharpCode).toBe('');
		expect(h.state.notice).toBe('');
		expect(h.api.page).toHaveBeenCalledTimes(1);
	});

	it('保存期间防重且不允许切换编辑目标', async () => {
		const h = setup();
		const result = deferred<unknown>();
		h.api.update.mockReturnValue(result.promise);
		h.session.activate();
		h.session.openEditor(row);
		const saved = h.session.save();
		await h.session.save();
		h.session.openEditor({ ...row, id: '99' });
		h.session.closeEditor();
		expect(h.state.draft.id).toBe('12');
		expect(h.state.editorOpen).toBe(true);
		expect(h.api.update).toHaveBeenCalledTimes(1);
		result.resolve(undefined);
		await saved;
		expect(h.state.editorOpen).toBe(false);
	});

	it('无权限或输入无效时不发送写请求', async () => {
		const h = setup();
		h.session.activate();
		h.session.openEditor();
		await h.session.save();
		expect(h.state.errors).toHaveProperty('name');
		expect(h.api.add).not.toHaveBeenCalled();
		h.permissions.update = false;
		h.session.openEditor(row);
		expect(h.state.draft.id).toBeUndefined();
		h.permissions.delete = false;
		h.session.requestDelete(row);
		await h.session.confirmDelete();
		expect(h.api.delete).not.toHaveBeenCalled();
	});

	it('删除取消不发请求，失败保留确认对象', async () => {
		const h = setup();
		h.session.activate();
		h.session.requestDelete(row);
		h.session.cancelDelete();
		await h.session.confirmDelete();
		expect(h.api.delete).not.toHaveBeenCalled();
		h.session.requestDelete(row);
		h.api.delete.mockRejectedValue(new Error('offline'));
		await h.session.confirmDelete();
		expect(h.state.deleteRow?.id).toBe('12');
		expect(h.state.deleteBusy).toBe(false);
		expect(h.state.deleteError).toContain('结果未确认');
	});
});
