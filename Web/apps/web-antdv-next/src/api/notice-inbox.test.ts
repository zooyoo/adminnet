import { describe, expect, it, vi } from 'vitest';

import { NoticeInbox } from './notice-inbox';

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason: Error) => void;
	const promise = new Promise<T>((done, fail) => {
		resolve = done;
		reject = fail;
	});
	return { promise, resolve, reject };
}

function fixture() {
	let version = 0;
	const load = vi.fn(async (_signal: AbortSignal): Promise<Array<{ id?: number | string }>> => [{ id: 1 }]);
	const read = vi.fn(async (_id: number | string) => {});
	const update = vi.fn();
	const error = vi.fn();
	const inbox = new NoticeInbox({ load, read, update, error, version: () => version });
	return {
		inbox,
		load,
		read,
		update,
		error,
		switchIdentity: () => {
			version++;
			inbox.reset();
		},
	};
}

describe('notice inbox', () => {
	it('deduplicates server results by normalized notice identity', async () => {
		const state = fixture();
		state.load.mockResolvedValue([{ id: 1 }, { id: '1' }, {}, { id: 2 }]);
		await state.inbox.refresh();
		expect(state.update).toHaveBeenLastCalledWith([{ id: '1' }, { id: 2 }]);
	});

	it('does not overwrite a later event refresh with an older response', async () => {
		const state = fixture();
		const older = deferred<Array<{ id: number }>>();
		state.load.mockReturnValueOnce(older.promise).mockResolvedValueOnce([{ id: 2 }]);
		const pending = state.inbox.refresh();
		await state.inbox.refresh();
		older.resolve([{ id: 1 }]);
		await pending;
		expect(state.update).toHaveBeenCalledTimes(1);
		expect(state.update).toHaveBeenLastCalledWith([{ id: 2 }]);
	});

	it('rejects late unread responses after identity changes', async () => {
		const state = fixture();
		const older = deferred<Array<{ id: number }>>();
		state.load.mockReturnValueOnce(older.promise);
		const pending = state.inbox.refresh();
		state.switchIdentity();
		older.resolve([{ id: 1 }]);
		await pending;
		expect(state.update).toHaveBeenLastCalledWith([]);
		expect(state.update).toHaveBeenCalledTimes(1);
	});

	it('preserves unread state when a read request fails', async () => {
		const state = fixture();
		await state.inbox.refresh();
		state.read.mockRejectedValueOnce(new Error('Unavailable'));
		expect(await state.inbox.markRead(1)).toBe(false);
		expect(state.update).toHaveBeenLastCalledWith([{ id: 1 }]);
		expect(state.error).toHaveBeenLastCalledWith('Unavailable');
	});

	it('deduplicates concurrent reads and refreshes after confirmed success', async () => {
		const state = fixture();
		await state.inbox.refresh();
		const reading = deferred<void>();
		state.read.mockReturnValueOnce(reading.promise);
		state.load.mockResolvedValue([]);
		const first = state.inbox.markRead(1);
		expect(state.inbox.markRead('1')).toBe(first);
		reading.resolve();
		expect(await first).toBe(true);
		expect(state.read).toHaveBeenCalledTimes(1);
		expect(state.update).toHaveBeenLastCalledWith([]);
	});

	it('keeps another identity unread list when old read completes', async () => {
		const state = fixture();
		await state.inbox.refresh();
		const reading = deferred<void>();
		state.read.mockReturnValueOnce(reading.promise);
		const pending = state.inbox.markRead(1);
		state.switchIdentity();
		state.load.mockResolvedValue([{ id: 2 }]);
		await state.inbox.refresh();
		reading.resolve();
		expect(await pending).toBe(false);
		expect(state.update).toHaveBeenLastCalledWith([{ id: 2 }]);
	});

	it('all-read partial failures retain failed items without rejecting the event handler', async () => {
		const state = fixture();
		state.load.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]).mockResolvedValue([{ id: 2 }]);
		await state.inbox.refresh();
		state.read.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('Failed second'));
		expect(await state.inbox.markAllRead()).toEqual([true, false]);
		expect(state.update).toHaveBeenLastCalledWith([{ id: 2 }]);
	});
});
