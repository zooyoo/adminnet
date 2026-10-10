import type { OpenAccessApi, OpenAccessRow, OpenAccessSignatureInput } from '../../../api/system/open-access';
import type { OpenAccessPermissions, SignatureDraft } from './open-access';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionBoundary } from '../../../api/session';
import { createOpenAccessState, emptyDraft, OPEN_ACCESS_METHODS, OpenAccessSession, randomNonce, timestampSeconds, validateDraft, validateSignature } from './open-access';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

const row: OpenAccessRow = { id: 31, accessKey: 'unit-key', accessSecret: 'unit-secret', bindTenantId: 1, bindUserId: 10, bindUserAccount: 'alice', bindTenantName: '租户一' };
const signature: SignatureDraft = { accessKey: row.accessKey, accessSecret: row.accessSecret, method: 0, url: '/api/example/action', timestamp: '1700000000', nonce: '123456' };
const sessions: OpenAccessSession[] = [];

function harness(overrides: Partial<OpenAccessApi> = {}, granted: Partial<OpenAccessPermissions> = {}) {
	const state = createOpenAccessState();
	const boundary = new SessionBoundary();
	const context = { identity: 'user:10:tenant:1', permissions: { page: true, add: true, update: true, delete: true, ...granted } };
	const api = {
		page: vi.fn<OpenAccessApi['page']>().mockResolvedValue({ items: [{ ...row }], total: 1 }),
		add: vi.fn<OpenAccessApi['add']>().mockResolvedValue(undefined),
		update: vi.fn<OpenAccessApi['update']>().mockResolvedValue(undefined),
		delete: vi.fn<OpenAccessApi['delete']>().mockResolvedValue(undefined),
		tenantList: vi.fn<OpenAccessApi['tenantList']>().mockResolvedValue([
			{ id: 1, name: '租户一' },
			{ id: 2, name: '租户二' },
		]),
		userList: vi.fn<OpenAccessApi['userList']>().mockImplementation(async ({ tenantId }) => [{ id: Number(tenantId) * 10, account: 'user', tenantId }]),
		secret: vi.fn<OpenAccessApi['secret']>().mockResolvedValue('AbCdEfGhIjKlMnOpQrStUv'),
		generateSignature: vi.fn<OpenAccessApi['generateSignature']>().mockResolvedValue('unit-sign'),
		...overrides,
	};
	const session = new OpenAccessSession(state, { api, boundary, identity: () => context.identity, permissions: () => context.permissions, debounceMs: 20 });
	sessions.push(session);
	return { state, boundary, context, api, session };
}

const flush = async () => {
	await Promise.resolve();
	await Promise.resolve();
};
afterEach(() => {
	for (const session of sessions.splice(0)) session.dispose();
	vi.useRealTimers();
});

describe('open access validation', () => {
	it('requires all binding fields without changing the credential contents', () => {
		expect(Object.keys(validateDraft(emptyDraft()))).toEqual(['accessKey', 'accessSecret', 'bindTenantId', 'bindUserId']);
		const draft = { ...row, accessSecret: 'a+/b==', accessKey: ' key ' };
		expect(validateDraft(draft)).toEqual({});
		expect(draft.accessKey).toBe(' key ');
		expect(draft.accessSecret).toBe('a+/b==');
	});

	it.each(['https://example.com/api/a', '//example.com/a', '/api/a?x=1', '/api/a#x', '/api/space path', '/api\\path', 'api/a', ''])('rejects non-path URL %s', (url) => {
		expect(validateSignature({ ...signature, url }).url).toBeTruthy();
	});

	it('supports every existing method, seconds and numeric nonces', () => {
		expect(OPEN_ACCESS_METHODS).toEqual(['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT']);
		for (const method of [0, 1, 2, 3, 4, 5, 6, 7, 8] as const) expect(validateSignature({ ...signature, method })).toEqual({});
		expect(validateSignature({ ...signature, timestamp: '1700000000000', nonce: 'abc' })).toMatchObject({ timestamp: expect.any(String), nonce: expect.any(String) });
		expect(timestampSeconds(1700000000999)).toBe('1700000000');
	});

	it('uses crypto with rejection sampling for a six digit nonce', () => {
		const values = [0xffff_ffff, 899_999];
		const getRandomValues = vi.fn((array: Uint32Array) => {
			array[0] = values.shift()!;
			return array;
		});
		expect(randomNonce({ getRandomValues } as unknown as Pick<Crypto, 'getRandomValues'>)).toBe('999999');
		expect(getRandomValues).toHaveBeenCalledTimes(2);
	});
});

describe('open access request boundaries', () => {
	it('queries the default 50 rows with signal and keeps only the newest page', async () => {
		const oldPage = deferred<{ items: OpenAccessRow[]; total: number }>();
		const page = vi.fn<OpenAccessApi['page']>().mockReturnValueOnce(oldPage.promise).mockResolvedValue({ items: [], total: 0 });
		const { session, state } = harness({ page });
		session.activate();
		expect(page.mock.calls[0]![0]).toEqual({ page: 1, pageSize: 50, accessKey: undefined });
		state.filter = 'needle';
		session.search();
		await flush();
		expect(page.mock.calls[0]![1].aborted).toBe(true);
		oldPage.resolve({ items: [row], total: 1 });
		await flush();
		expect(state.items).toEqual([]);
		expect(page.mock.calls[1]![0].accessKey).toBe('needle');
	});

	it('clears the old user immediately and ignores an out-of-order tenant response', async () => {
		const oldUsers = deferred<Array<{ id: number; account: string; tenantId: number }>>();
		const userList = vi
			.fn<OpenAccessApi['userList']>()
			.mockReturnValueOnce(oldUsers.promise)
			.mockResolvedValue([
				{ id: 20, account: 'bob', tenantId: 2 },
				{ id: 11, account: 'wrong', tenantId: 1 },
			]);
		const { session, state } = harness({ userList });
		session.activate();
		await flush();
		session.openEditor(row);
		session.chooseTenant(2);
		expect(state.draft.bindUserId).toBeUndefined();
		expect(state.users).toEqual([]);
		expect(userList.mock.calls[0]![1].aborted).toBe(true);
		await flush();
		oldUsers.resolve([{ id: 10, account: 'alice', tenantId: 1 }]);
		await flush();
		expect(state.users).toEqual([{ id: 20, account: 'bob', tenantId: 2 }]);
		expect(state.draft.bindTenantId).toBe(2);
		expect(state.draft.bindUserId).toBeUndefined();
	});

	it('refuses saving without a user from the selected tenant', async () => {
		const { session, state, api } = harness();
		session.activate();
		await flush();
		session.openEditor(row);
		await flush();
		session.chooseTenant(2);
		await flush();
		await session.save();
		expect(state.draftErrors.bindUserId).toBe('请选择绑定用户');
		expect(api.update).not.toHaveBeenCalled();
		session.updateDraft({ bindUserId: 10 });
		await session.save();
		expect(state.draftErrors.bindUserId).toContain('当前租户');
		expect(api.update).not.toHaveBeenCalled();
	});

	it('deduplicates saving, sends the full draft and retains it after failure', async () => {
		const pending = deferred<unknown>();
		const update = vi.fn<OpenAccessApi['update']>().mockReturnValue(pending.promise);
		const { session, state } = harness({ update });
		session.activate();
		await flush();
		session.openEditor({ ...row, extraField: 'retained' });
		await flush();
		const saving = session.save();
		void session.save();
		expect(update).toHaveBeenCalledTimes(1);
		expect(update.mock.calls[0]![0]).toMatchObject({ ...row, extraField: 'retained' });
		pending.reject(new Error('secret must never appear in error UI'));
		await saving;
		expect(state.editorOpen).toBe(true);
		expect(state.draft.accessSecret).toBe(row.accessSecret);
		expect(state.saveBusy).toBe(false);
		expect(state.editorError).toBe('保存失败，已保留填写内容，请重试');
		expect(state.notice).toBe('');
	});

	it('requires confirmation for deletion, deduplicates it and sends only id', async () => {
		const pending = deferred<unknown>();
		const remove = vi.fn<OpenAccessApi['delete']>().mockReturnValue(pending.promise);
		const { session } = harness({ delete: remove });
		session.activate();
		await flush();
		session.requestDelete(row);
		session.cancelDelete();
		await session.confirmDelete();
		expect(remove).not.toHaveBeenCalled();
		session.requestDelete(row);
		const deleting = session.confirmDelete();
		void session.confirmDelete();
		expect(remove).toHaveBeenCalledTimes(1);
		expect(remove.mock.calls[0]![0]).toEqual({ id: row.id });
		pending.resolve(undefined);
		await deleting;
	});

	it('cannot overwrite a new draft or a manually edited secret with a late generated secret', async () => {
		const pending = deferred<string>();
		const secret = vi.fn<OpenAccessApi['secret']>().mockReturnValue(pending.promise);
		const { session, state } = harness({ secret });
		session.activate();
		await flush();
		session.openEditor();
		const generating = session.generateSecret();
		session.updateDraft({ accessSecret: 'manual-secret' });
		expect(secret.mock.calls[0]![0].aborted).toBe(true);
		pending.resolve('late-secret');
		await generating;
		expect(state.draft.accessSecret).toBe('manual-secret');
		session.closeEditor();
		session.openEditor(row);
		expect(state.draft.accessSecret).toBe(row.accessSecret);
	});

	it('rejects a late secret after closing the editor and opening another row', async () => {
		const pending = deferred<string>();
		const { session, state } = harness({ secret: () => pending.promise });
		session.activate();
		await flush();
		session.openEditor();
		const generating = session.generateSecret();
		session.closeEditor();
		session.openEditor(row);
		pending.resolve('late-old-editor-secret');
		await generating;
		expect(state.draft.accessKey).toBe(row.accessKey);
		expect(state.draft.accessSecret).toBe(row.accessSecret);
	});

	it('keeps the backend secret representation unchanged for an update-only user', async () => {
		const { session, state, api } = harness({}, { add: false });
		session.activate();
		await flush();
		session.openEditor(row);
		await session.generateSecret();
		expect(state.draft.accessSecret).toBe('AbCdEfGhIjKlMnOpQrStUv');
		expect(api.secret).toHaveBeenCalledTimes(1);
	});

	it('clears the old signature synchronously and rejects its late response', async () => {
		vi.useFakeTimers();
		const oldSign = deferred<string>();
		const generateSignature = vi.fn<OpenAccessApi['generateSignature']>().mockReturnValueOnce(oldSign.promise).mockResolvedValue('new-sign');
		const { session, state } = harness({ generateSignature });
		session.activate();
		await flush();
		session.openSignature(row);
		session.updateSignature(signature);
		await vi.advanceTimersByTimeAsync(20);
		expect(generateSignature).toHaveBeenCalledTimes(1);
		state.sign = 'previous-sign';
		session.updateSignature({ nonce: '654321' });
		expect(state.sign).toBe('');
		expect(generateSignature.mock.calls[0]![1].aborted).toBe(true);
		await vi.advanceTimersByTimeAsync(20);
		expect(state.sign).toBe('new-sign');
		oldSign.resolve('late-sign');
		await flush();
		expect(state.sign).toBe('new-sign');
		const input: OpenAccessSignatureInput = generateSignature.mock.calls[1]![0];
		expect(input).toEqual({ ...signature, timestamp: 1700000000, nonce: '654321' });
	});

	it('keeps failed signing parameters and allows a manual retry', async () => {
		const generateSignature = vi.fn<OpenAccessApi['generateSignature']>().mockRejectedValueOnce(new Error(row.accessSecret)).mockResolvedValue('retried-sign');
		const { session, state } = harness({ generateSignature });
		session.activate();
		await flush();
		session.openSignature(row);
		Object.assign(state.signature, signature);
		await session.generateSignature();
		expect(state.signature).toEqual(signature);
		expect(state.sign).toBe('');
		expect(state.signatureError).not.toContain(row.accessSecret);
		await session.generateSignature();
		expect(state.sign).toBe('retried-sign');
		expect(state.signatureError).toBe('');
	});

	it.each(['page', 'add', 'update', 'delete'] as const)('clears all sensitive data when %s permission changes', async (permission) => {
		const pending = deferred<string>();
		const { session, state, context } = harness({ generateSignature: () => pending.promise });
		session.activate();
		await flush();
		session.openEditor(row);
		session.openSignature(row);
		Object.assign(state.signature, signature);
		const signing = session.generateSignature();
		state.helpOpen = true;
		state.sign = 'old-sign';
		context.permissions[permission] = false;
		session.contextChanged(false);
		expect(state.items).toEqual([]);
		expect(state.draft).toEqual(emptyDraft());
		expect(state.signature.accessSecret).toBe('');
		expect(state.sign).toBe('');
		expect(state.helpOpen).toBe(false);
		pending.resolve('late-sign');
		await signing;
		expect(state.sign).toBe('');
	});

	it('rejects responses after an identity change even before the reactive watcher runs', async () => {
		const pending = deferred<string>();
		const { session, state, context } = harness({ secret: () => pending.promise });
		session.activate();
		await flush();
		session.openEditor();
		const generating = session.generateSecret();
		context.identity = 'another-user';
		pending.resolve('late-secret');
		await generating;
		expect(state.draft.accessSecret).toBe('');
		session.contextChanged(false);
		expect(state.editorOpen).toBe(false);
	});

	it('clears on session invalidation and ignores a request that disregards abort', async () => {
		const pending = deferred<{ items: OpenAccessRow[]; total: number }>();
		const { session, state, boundary } = harness({ page: () => pending.promise });
		session.activate();
		state.draft = { ...row };
		boundary.invalidate();
		pending.resolve({ items: [row], total: 1 });
		await flush();
		expect(state.items).toEqual([]);
		expect(state.draft.accessSecret).toBe('');
	});

	it('cancels a debounced signature and clears credentials on KeepAlive leave', async () => {
		vi.useFakeTimers();
		const { session, state, api } = harness();
		session.activate();
		await flush();
		session.openSignature(row);
		session.updateSignature(signature);
		session.deactivate();
		await vi.advanceTimersByTimeAsync(100);
		expect(api.generateSignature).not.toHaveBeenCalled();
		expect(state.signature.accessSecret).toBe('');
		session.activate();
		await flush();
		expect(api.page).toHaveBeenCalledTimes(2);
		expect(state.signatureOpen).toBe(false);
	});

	it('never fetches data without page permission, and blocks ungranted mutations', async () => {
		const denied = harness({}, { page: false });
		denied.session.activate();
		denied.session.openEditor();
		await denied.session.generateSecret();
		expect(denied.api.page).not.toHaveBeenCalled();
		expect(denied.api.tenantList).not.toHaveBeenCalled();
		expect(denied.api.secret).not.toHaveBeenCalled();
		const readOnly = harness({}, { add: false, update: false, delete: false });
		readOnly.session.activate();
		await flush();
		readOnly.session.openEditor(row);
		readOnly.session.requestDelete(row);
		expect(readOnly.state.editorOpen).toBe(false);
		expect(readOnly.state.deleteId).toBeUndefined();
	});
});
