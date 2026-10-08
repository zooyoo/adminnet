export type OutputCell = boolean | number | string;
export interface OutputColumn<T> {
	key?: number | string;
	title?: unknown;
	dataIndex?: unknown;
	children?: OutputColumn<T>[];
}
export interface TableOutputOptions<T> {
	fileName: string;
	formatters?: Record<string, (record: T) => unknown>;
}

function textValue(value: unknown): OutputCell {
	if (value == null) return '';
	if (value instanceof Date) return value.toISOString();
	if (['boolean', 'number', 'string'].includes(typeof value)) return value as OutputCell;
	return JSON.stringify(value);
}

export function tableMatrix<T>(records: T[], columns: OutputColumn<T>[], formatters: TableOutputOptions<T>['formatters'] = {}): OutputCell[][] {
	const leaves: Array<{ title: string; read: (record: T) => unknown }> = [];
	function visit(items: OutputColumn<T>[], prefix = '') {
		for (const column of items) {
			const title = typeof column.title === 'string' ? column.title : '';
			const label = prefix && title ? `${prefix} / ${title}` : title || prefix;
			if (column.children?.length) {
				visit(column.children, label);
				continue;
			}
			const key = String(column.key ?? column.dataIndex ?? '');
			const formatter = formatters[key];
			if (!formatter && column.dataIndex === undefined) continue;
			const path = Array.isArray(column.dataIndex) ? column.dataIndex : [column.dataIndex];
			leaves.push({
				title: label || key,
				read:
					formatter ??
					((record) =>
						path.reduce<unknown>((value, property) => {
							if (!value || typeof value !== 'object' || (typeof property !== 'string' && typeof property !== 'number')) return undefined;
							return Reflect.get(value, property);
						}, record)),
			});
		}
	}
	visit(columns);
	return [leaves.map((column) => column.title), ...records.map((row) => leaves.map((column) => textValue(column.read(row))))];
}

export async function exportWorkbook(matrix: OutputCell[][], fileName: string, isCurrent = () => true) {
	const xlsx = await import('xlsx-js-style');
	if (!isCurrent()) return;
	const book = xlsx.utils.book_new();
	const sheet = xlsx.utils.aoa_to_sheet(matrix);
	sheet['!cols'] = (matrix[0] ?? []).map(() => ({ wch: 24 }));
	xlsx.utils.book_append_sheet(book, sheet, 'Data');
	xlsx.writeFile(book, `${fileName.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')}.xlsx`, { compression: true });
}

export function printableTable(matrix: OutputCell[][], title: string): string {
	const root = document.createElement('main');
	const heading = document.createElement('h1');
	heading.textContent = title;
	root.append(heading);
	const table = document.createElement('table');
	const header = document.createElement('thead');
	const body = document.createElement('tbody');
	matrix.forEach((values, index) => {
		const row = document.createElement('tr');
		for (const value of values) {
			const cell = document.createElement(index === 0 ? 'th' : 'td');
			cell.textContent = String(value);
			row.append(cell);
		}
		(index === 0 ? header : body).append(row);
	});
	table.append(header, body);
	root.append(table);
	return root.outerHTML;
}

export async function printTable(matrix: OutputCell[][], title: string, isCurrent = () => true) {
	const { default: printJS } = await import('print-js');
	if (!isCurrent()) return;
	printJS({
		printable: printableTable(matrix, title),
		type: 'raw-html',
		documentTitle: title,
		style:
			'body{font-family:Arial,sans-serif;color:#111}h1{font-size:18px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #aaa;padding:6px;text-align:left;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}',
	});
}
