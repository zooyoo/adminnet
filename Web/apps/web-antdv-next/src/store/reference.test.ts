import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { sessionBoundary } from '#/api/session';
import { useReferenceStore } from '#/store/reference';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('#/api/request', () => ({ requestClient: { get } }));

describe('reference store tenant isolation', () => {
	beforeEach(() => {
		setActivePinia(createPinia());
		get.mockReset();
	});

	it('deduplicates concurrent loads and normalizes enum values', async () => {
		get.mockResolvedValue({ StatusEnum: [{ label: '启用', value: '1' }], org_type: [{ label: '部门', value: 'department' }] });
		const store = useReferenceStore();
		await Promise.all([store.load(), store.load()]);
		expect(get).toHaveBeenCalledTimes(1);
		expect(store.options('StatusEnum')[0]?.value).toBe(1);
		expect(store.label('org_type', 'department')).toBe('部门');
	});

	it('discards a response from a previous tenant session', async () => {
		const old = Promise.withResolvers<Record<string, unknown>>();
		get.mockReturnValue(old.promise);
		const store = useReferenceStore();
		const loading = store.load();
		sessionBoundary.invalidate();
		store.$reset();
		old.resolve({ org_type: [{ label: '旧租户', value: 'old' }] });
		await loading;
		expect(store.options('org_type')).toEqual([]);
		get.mockResolvedValue({ org_type: [{ label: '新租户', value: 'new' }] });
		await store.load();
		expect(store.label('org_type', 'new')).toBe('新租户');
	});

	it('allows retry after a failed reference request', async () => {
		get.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
		const store = useReferenceStore();
		await expect(store.load()).rejects.toThrow('offline');
		await expect(store.load()).resolves.toBeUndefined();
		expect(get).toHaveBeenCalledTimes(2);
	});
});
