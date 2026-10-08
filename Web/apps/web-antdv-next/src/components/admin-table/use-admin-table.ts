import { onScopeDispose, ref, shallowRef } from 'vue';

import { isCancel } from 'axios';

export interface PageQuery {
	page: number;
	pageSize: number;
	field?: string;
	order?: 'ascending' | 'descending';
}

export interface PageResult<T> {
	items: T[];
	total: number;
}

export interface AdminTableOptions<T, Q extends Record<string, unknown>> {
	query: Q;
	pageSize?: number;
	load: (query: PageQuery & Q, signal: AbortSignal) => Promise<PageResult<T>>;
}

export function useAdminTable<T, Q extends Record<string, unknown>>(options: AdminTableOptions<T, Q>) {
	const rows = shallowRef<T[]>([]);
	const query = shallowRef<Q>({ ...options.query });
	const page = ref(1);
	const pageSize = ref(options.pageSize ?? 20);
	const total = ref(0);
	const field = ref<string>();
	const order = ref<PageQuery['order']>();
	const loading = ref(false);
	const error = ref('');
	const selectedKeys = ref<Array<number | string>>([]);
	let controller: AbortController | undefined;
	let generation = 0;
	const exports = new Set<AbortController>();
	let disposed = false;

	async function collectAll(signal?: AbortSignal): Promise<T[]> {
		const cancellation = new AbortController();
		exports.add(cancellation);
		const exportSignal = signal ? AbortSignal.any([signal, cancellation.signal]) : cancellation.signal;
		const snapshot = { ...query.value, field: field.value, order: order.value };
		const items: T[] = [];
		let expected: number | undefined;
		try {
			for (let current = 1; ; current += 1) {
				exportSignal.throwIfAborted();
				if (disposed) throw new DOMException('View closed', 'AbortError');
				const result = await options.load({ ...snapshot, page: current, pageSize: 500 }, exportSignal);
				exportSignal.throwIfAborted();
				if (expected !== undefined && expected !== result.total) throw new Error('数据已变化，请重新导出');
				expected = result.total;
				if (!result.items.length && items.length < expected) throw new Error('导出数据不完整，请重试');
				items.push(...result.items);
				if (items.length >= expected) return items;
			}
		} finally {
			exports.delete(cancellation);
		}
	}

	async function reload() {
		controller?.abort();
		controller = new AbortController();
		const current = ++generation;
		loading.value = true;
		error.value = '';
		try {
			const result = await options.load({ ...query.value, page: page.value, pageSize: pageSize.value, field: field.value, order: order.value }, controller.signal);
			if (current !== generation) return;
			rows.value = result.items;
			total.value = result.total;
		} catch (cause) {
			if (current === generation && !isCancel(cause) && !(cause instanceof DOMException && cause.name === 'AbortError')) {
				error.value = cause instanceof Error ? cause.message : '查询失败';
			}
		} finally {
			if (current === generation) loading.value = false;
		}
	}

	function search(values?: Partial<Q>) {
		query.value = { ...query.value, ...values };
		page.value = 1;
		selectedKeys.value = [];
		return reload();
	}

	function reset() {
		query.value = { ...options.query };
		field.value = undefined;
		order.value = undefined;
		page.value = 1;
		selectedKeys.value = [];
		return reload();
	}

	function setSelectedKeys(keys: Array<number | string>) {
		selectedKeys.value = [...keys];
	}

	function change(current: number, size: number, sortField?: string, sortOrder?: 'ascend' | 'descend' | null) {
		const nextOrder = sortOrder === 'ascend' ? 'ascending' : sortOrder === 'descend' ? 'descending' : undefined;
		const sortChanged = sortField !== field.value || nextOrder !== order.value;
		page.value = size !== pageSize.value || sortChanged ? 1 : current;
		pageSize.value = size;
		field.value = nextOrder ? sortField : undefined;
		order.value = nextOrder;
		return reload();
	}

	onScopeDispose(() => {
		disposed = true;
		generation += 1;
		controller?.abort();
		for (const cancellation of exports) cancellation.abort();
		exports.clear();
	});

	return { rows, query, page, pageSize, total, field, order, loading, error, selectedKeys, reload, search, reset, change, setSelectedKeys, collectAll };
}

export type AdminTableController<T, Q extends Record<string, unknown> = Record<string, unknown>> = ReturnType<typeof useAdminTable<T, Q>>;
