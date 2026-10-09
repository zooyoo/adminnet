import { describe, expect, it } from 'vitest';

import { columnDraft, moveColumnInput, validateColumns } from '../database-form';

describe('database form', () => {
	it('preserves every column setting and rejects duplicates', () => {
		const column = { ...columnDraft(), dbColumnName: 'Amount', dataType: 'numeric', length: 12, decimalDigits: 3, defaultValue: '1.25', isNullable: 1 };
		expect(() => validateColumns([column], ['numeric'])).not.toThrow();
		expect(column).toMatchObject({ length: 12, decimalDigits: 3, defaultValue: '1.25', isNullable: 1 });
		expect(() => validateColumns([column, { ...column, dbColumnName: 'amount' }], ['numeric'])).toThrow('重复');
	});
	it('rejects empty columns, unsafe identifiers and unsupported types', () => {
		expect(() => validateColumns([], [])).toThrow();
		expect(() => validateColumns([{ ...columnDraft(), dbColumnName: 'name;drop' }], ['varchar'])).toThrow();
		expect(() => validateColumns([{ ...columnDraft(), dbColumnName: 'Name' }], ['text'])).toThrow();
	});
	it('moves the selected column, including the first position', () => {
		const columns = ['A', 'B', 'C'].map((dbColumnName) => ({ dbColumnName }));
		const target = { configId: 'test', tableName: 'Sample' };
		expect(moveColumnInput(target, columns, 1, 'up')).toEqual({ ...target, columnName: 'B', afterColumnName: '' });
		expect(moveColumnInput(target, columns, 2, 'up')).toEqual({ ...target, columnName: 'C', afterColumnName: 'A' });
		expect(moveColumnInput(target, columns, 0, 'down')).toEqual({ ...target, columnName: 'A', afterColumnName: 'B' });
		expect(() => moveColumnInput(target, columns, 0, 'up')).toThrow();
		expect(() => moveColumnInput(target, columns, 2, 'down')).toThrow();
	});
});
