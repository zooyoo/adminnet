import { effectScope } from 'vue';

import { describe, expect, it, vi } from 'vitest';

import { useAdminTable } from './use-admin-table';

describe('useAdminTable', () => {
	it('collects all pages with the original query and without changing the active page', async () => {
		const scope = effectScope();
		const load = vi.fn(async (query: { page: number }) => ({ items: query.page === 1 ? [1, 2] : [3], total: 3 }));
		const table = scope.run(() => useAdminTable({ query: { name: 'filter', tenantId: 7 }, load }))!;
		table.page.value = 4;
		table.field.value = 'name';
		table.order.value = 'descending';
		expect(await table.collectAll()).toEqual([1, 2, 3]);
		expect(load).toHaveBeenLastCalledWith({ name: 'filter', tenantId: 7, page: 2, pageSize: 500, field: 'name', order: 'descending' }, expect.any(AbortSignal));
		expect(table.page.value).toBe(4);
		expect(table.rows.value).toEqual([]);
		scope.stop();
	});
	it('does not silently export partial data or changed datasets', async () => {
		const scope = effectScope();
		let calls = 0;
		const table = scope.run(() => useAdminTable({ query: {}, load: async () => (++calls === 1 ? { items: [1], total: 2 } : { items: [], total: 2 }) }))!;
		await expect(table.collectAll()).rejects.toThrow('不完整');
		scope.stop();
		const changed = effectScope();
		calls = 0;
		const other = changed.run(() => useAdminTable({ query: {}, load: async () => (++calls === 1 ? { items: [1], total: 2 } : { items: [2], total: 3 }) }))!;
		await expect(other.collectAll()).rejects.toThrow('数据已变化');
		changed.stop();
	});
	it('cancels an export when its view is disposed', async () => {
		const scope = effectScope();
		const deferred = Promise.withResolvers<{ items: number[]; total: number }>();
		const table = scope.run(() => useAdminTable({ query: {}, load: () => deferred.promise }))!;
		const pending = table.collectAll();
		scope.stop();
		deferred.resolve({ items: [1], total: 1 });
		await expect(pending).rejects.toThrow('abort');
	});
	it('maps pagination and sorting to the existing API contract', async () => {
		const scope = effectScope();
		const load = vi.fn(async () => ({ items: [{ id: 1 }], total: 41 }));
		const table = scope.run(() => useAdminTable({ query: { name: 'test' }, load }))!;
		await table.change(3, 20, 'name', 'descend');
		expect(load).toHaveBeenLastCalledWith({ name: 'test', page: 1, pageSize: 20, field: 'name', order: 'descending' }, expect.any(AbortSignal));
		await table.change(3, 20, 'name', 'descend');
		expect(table.page.value).toBe(3);
		expect(table.rows.value).toEqual([{ id: 1 }]);
		expect(table.total.value).toBe(41);
		scope.stop();
	});

	it('resets filters and selection while preserving initial tenant scope', async () => {
		const scope = effectScope();
		const table = scope.run(() => useAdminTable({ query: { name: '', tenantId: 7 }, load: async () => ({ items: [], total: 0 }) }))!;
		await table.search({ name: 'engineer' });
		table.selectedKeys.value = [2, 3];
		await table.reset();
		expect(table.query.value).toEqual({ name: '', tenantId: 7 });
		expect(table.page.value).toBe(1);
		expect(table.selectedKeys.value).toEqual([]);
		scope.stop();
	});

	it('does not replace newer results with a late response', async () => {
		const scope = effectScope();
		const old = Promise.withResolvers<{ items: number[]; total: number }>();
		let calls = 0;
		const table = scope.run(() => useAdminTable({ query: {}, load: () => (++calls === 1 ? old.promise : Promise.resolve({ items: [2], total: 1 })) }))!;
		const pending = table.reload();
		await table.reload();
		old.resolve({ items: [1], total: 1 });
		await pending;
		expect(table.rows.value).toEqual([2]);
		expect(table.loading.value).toBe(false);
		scope.stop();
	});

	it('exposes errors and releases loading after failure', async () => {
		const scope = effectScope();
		const table = scope.run(() =>
			useAdminTable({
				query: {},
				load: async () => {
					throw new Error('查询失败');
				},
			})
		)!;
		await table.reload();
		expect(table.error.value).toBe('查询失败');
		expect(table.loading.value).toBe(false);
		scope.stop();
	});

	it('aborts pending work when the view is disposed', async () => {
		const scope = effectScope();
		let signal: AbortSignal | undefined;
		const table = scope.run(() =>
			useAdminTable({
				query: {},
				load: async (_query, requestSignal) => {
					signal = requestSignal;
					return { items: [], total: 0 };
				},
			})
		)!;
		const pending = table.reload();
		scope.stop();
		await pending;
		expect(signal?.aborted).toBe(true);
	});
});
