import type { DbColumnInput, DbColumnOutput, MoveDbColumnInput } from '#/api-services/models';
import type { DatabaseTarget } from '#/api/system/database';

export type ColumnDraft = {
	[
		K in keyof Required<Pick<DbColumnInput, 'columnDescription' | 'dataType' | 'dbColumnName' | 'decimalDigits' | 'defaultValue' | 'isIdentity' | 'isNullable' | 'isPrimarykey' | 'length'>>
	]: NonNullable<DbColumnInput[K]>;
};
export function columnDraft(primary = false): ColumnDraft {
	return {
		dbColumnName: primary ? 'Id' : '',
		dataType: primary ? 'bigint' : 'varchar',
		length: primary ? 0 : 64,
		decimalDigits: 0,
		isPrimarykey: primary ? 1 : 0,
		isIdentity: 0,
		isNullable: 0,
		columnDescription: '',
		defaultValue: '',
	};
}
export function validateColumns(columns: ColumnDraft[], types: string[]) {
	if (!columns.length) throw new Error('至少添加一个字段');
	const names = new Set<string>();
	for (const column of columns) {
		if (!column.dbColumnName || !/^[\p{L}_][\p{L}\p{N}_$]*$/u.test(column.dbColumnName) || column.dbColumnName.length > 63) throw new Error('字段名无效');
		const name = column.dbColumnName.toLowerCase();
		if (names.has(name)) throw new Error(`字段名重复：${column.dbColumnName}`);
		names.add(name);
		if (!types.includes(column.dataType)) throw new Error(`请选择支持的字段类型：${column.dbColumnName}`);
		if (column.length < 0 || column.decimalDigits < 0 || (column.length > 0 && column.decimalDigits > column.length)) throw new Error('长度或小数位无效');
	}
}
export function moveColumnInput(target: DatabaseTarget, columns: DbColumnOutput[], index: number, direction: 'down' | 'up'): MoveDbColumnInput {
	const next = direction === 'up' ? index - 1 : index + 1;
	if (index < 0 || next < 0 || next >= columns.length) throw new Error('字段已在边界位置');
	return { ...target, columnName: columns[index]!.dbColumnName, afterColumnName: direction === 'up' ? (columns[index - 2]?.dbColumnName ?? '') : columns[next]!.dbColumnName };
}
