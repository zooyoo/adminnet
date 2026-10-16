import type { AdminColumn } from './column-settings';

export type SortOrder = 'ascend' | 'descend' | null;
export function sortField(value: unknown): string | undefined {
	if (typeof value === 'string') return value || undefined;
	if (typeof value === 'number') return String(value);
	if (Array.isArray(value) && value.length && value.every((part) => (typeof part === 'string' && part.length > 0) || typeof part === 'number')) return value.map(String).join('.');
	return undefined;
}
export function sorterState(sorter: unknown): { field: string | undefined; order: SortOrder } {
	const current = Array.isArray(sorter) ? sorter[0] : sorter;
	if (!current || typeof current !== 'object') return { field: undefined, order: null };
	const value = current as { field?: unknown; columnKey?: unknown; order?: unknown };
	const order = value.order === 'ascend' || value.order === 'descend' ? value.order : null;
	return { field: order ? (sortField(value.field) ?? sortField(value.columnKey)) : undefined, order };
}
export function controlledSortColumns<T>(columns: AdminColumn<T>[], field: string | undefined, order: 'ascending' | 'descending' | undefined): AdminColumn<T>[] {
	let assigned = false;
	function visit(items: AdminColumn<T>[]): AdminColumn<T>[] {
		return items.map((column) => {
			if ('children' in column && column.children) return { ...column, children: visit(column.children) };
			if (!('sorter' in column) || !column.sorter) return column;
			const columnField = sortField(column.dataIndex) ?? sortField(column.key);
			const active = !assigned && !!order && field !== undefined && columnField === field;
			if (active) assigned = true;
			return { ...column, sortOrder: active ? (order === 'ascending' ? 'ascend' : 'descend') : null };
		});
	}
	return visit(columns);
}
