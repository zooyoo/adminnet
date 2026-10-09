import { effectScope } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { sessionBoundary } from '#/api/session';

import { useDatabaseSelection } from '../use-database-selection';

vi.mock('#/api/system/database', () => ({ databaseConnections: vi.fn(), databaseTables: vi.fn(), databaseTypes: vi.fn(), databaseColumns: vi.fn() }));
function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((accept) => {
		resolve = accept;
	});
	return { promise, resolve };
}
describe('database selection lifecycle', () => {
	it('late reload of the same connection does not restore its old table', async () => {
		const pending = deferred<Array<{ name: string }>>();
		let calls = 0;
		const scope = effectScope();
		const selection = scope.run(() =>
			useDatabaseSelection({
				connections: async () => [],
				tables: () => (++calls === 1 ? pending.promise : Promise.resolve([{ name: 'Old' }, { name: 'New' }])),
				types: async () => ['text'],
				columns: async (target) => [{ dbColumnName: target.tableName }],
			})
		)!;
		const old = selection.selectConnection('same', 'Old');
		await selection.selectConnection('same', 'New');
		pending.resolve([{ name: 'Old' }]);
		await old;
		expect(selection.tableName.value).toBe('New');
		expect(selection.columns.value).toEqual([{ dbColumnName: 'New' }]);
		scope.stop();
	});
	it('clears old targets and ignores late connection responses', async () => {
		const pending = deferred<Array<{ name: string }>>();
		const loaders = {
			connections: async () => [],
			tables: vi.fn((id: string) => (id === 'old' ? pending.promise : Promise.resolve([{ name: 'Current' }]))),
			types: async () => ['varchar'],
			columns: async () => [{ dbColumnName: 'CurrentField' }],
		};
		const scope = effectScope();
		const selection = scope.run(() => useDatabaseSelection(loaders))!;
		const old = selection.selectConnection('old');
		await selection.selectConnection('new');
		await selection.selectTable('Current');
		pending.resolve([{ name: 'Stale' }]);
		await old;
		expect(selection.configId.value).toBe('new');
		expect(selection.tables.value).toEqual([{ name: 'Current' }]);
		expect(selection.columns.value).toEqual([{ dbColumnName: 'CurrentField' }]);
		const next = selection.selectConnection('old');
		expect(selection.tableName.value).toBe('');
		expect(selection.columns.value).toEqual([]);
		await next;
		scope.stop();
	});
	it('does not restore column responses after session invalidation', async () => {
		const pending = deferred<Array<{ dbColumnName: string }>>();
		const scope = effectScope();
		const selection = scope.run(() => useDatabaseSelection({ connections: async () => [], tables: async () => [{ name: 'Sample' }], types: async () => ['text'], columns: () => pending.promise }))!;
		await selection.selectConnection('test');
		const result = selection.selectTable('Sample');
		sessionBoundary.invalidate();
		pending.resolve([{ dbColumnName: 'Stale' }]);
		await result;
		expect(selection.columns.value).toEqual([]);
		expect(selection.configId.value).toBe('');
		expect(selection.loading.value).toBe(false);
		scope.stop();
	});
	it('failed table loading disables mutations and keeps the error', async () => {
		const scope = effectScope();
		const selection = scope.run(() =>
			useDatabaseSelection({
				connections: async () => [],
				tables: async () => {
					throw new Error('connection unavailable');
				},
				types: async () => [],
				columns: async () => [],
			})
		)!;
		await selection.selectConnection('offline');
		expect(selection.ready.value).toBe(false);
		expect(selection.error.value).toBe('connection unavailable');
		expect(selection.loading.value).toBe(false);
		scope.stop();
	});
});
