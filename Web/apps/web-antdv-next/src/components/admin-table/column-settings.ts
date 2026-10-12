import type { TableProps } from 'antdv-next';

export type AdminColumn<T = Record<string, unknown>> = NonNullable<TableProps<T>['columns']>[number];
export type ColumnFixed = 'end' | 'start' | false;

export interface ColumnSetting<T> {
	column: AdminColumn<T>;
	key: string;
	label: string;
	parent: string;
	fixed: ColumnFixed;
}

export function columnKey<T>(column: AdminColumn<T>, path: string) {
	return String(column.key ?? ('dataIndex' in column ? column.dataIndex : undefined) ?? path);
}

export function columnSettings<T>(columns: AdminColumn<T>[], parent = '', inherited: ColumnFixed = false): ColumnSetting<T>[] {
	return columns.flatMap((column, index) => {
		const key = columnKey(column, `${parent}/${index}`);
		const fixed = column.fixed === true || column.fixed === 'left' ? 'start' : column.fixed === 'right' ? 'end' : (column.fixed ?? inherited);
		if ('children' in column && column.children?.length) return columnSettings(column.children, key, fixed);
		return [{ column, key, label: typeof column.title === 'string' ? column.title : key, parent, fixed }];
	});
}

export function configuredColumns<T>(columns: AdminColumn<T>[], hidden: string[], order: string[], fixed: Record<string, ColumnFixed>, parent = ''): AdminColumn<T>[] {
	const rank = (column: AdminColumn<T>, index: number) => {
		const key = columnKey(column, `${parent}/${index}`);
		const keys = 'children' in column && column.children ? columnSettings(column.children, key).map((item) => item.key) : [key];
		return Math.min(...keys.map((key) => (order.includes(key) ? order.indexOf(key) : Number.MAX_SAFE_INTEGER)));
	};
	return columns
		.map((column, index) => ({ column, index }))
		.sort((a, b) => rank(a.column, a.index) - rank(b.column, b.index))
		.flatMap(({ column, index }) => {
			const key = columnKey(column, `${parent}/${index}`);
			if ('children' in column && column.children) {
				const children = configuredColumns(column.children, hidden, order, fixed, key);
				return children.length ? [{ ...column, children }] : [];
			}
			return hidden.includes(key) ? [] : [{ ...column, ...(key in fixed ? { fixed: fixed[key] } : {}) }];
		});
}

export function moveColumnSetting<T>(settings: ColumnSetting<T>[], key: string, direction: -1 | 1): string[] {
	const keys = settings.map((item) => item.key);
	const index = keys.indexOf(key);
	const sibling = settings[index + direction];
	if (index >= 0 && sibling && sibling.parent === settings[index]?.parent) {
		keys[index] = sibling.key;
		keys[index + direction] = key;
	}
	return keys;
}

export function canMoveColumnSetting<T>(settings: ColumnSetting<T>[], index: number, direction: -1 | 1) {
	return settings[index + direction]?.parent === settings[index]?.parent && Boolean(settings[index + direction]);
}
