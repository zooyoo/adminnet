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
		dataType: primary ? 'bigint' : '',
		length: 0,
		decimalDigits: 0,
		isPrimarykey: primary ? 1 : 0,
		isIdentity: 0,
		isNullable: primary ? 0 : 1,
		columnDescription: primary ? '主键Id' : '',
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

export function fieldTemplates(kind: 'base' | 'delete' | 'org' | 'tenant', types: string[]): ColumnDraft[] {
	const type = (name: string, fallback: string) => (types.includes(name) ? name : fallback);
	const draft = (name: string, dataType: string, description: string, length = 0, nullable = 1): ColumnDraft => ({
		...columnDraft(),
		dbColumnName: name,
		dataType,
		length,
		isNullable: nullable,
		columnDescription: description,
	});
	switch (kind) {
		case 'tenant':
			return [draft('TenantId', 'bigint', '租户Id')];
		case 'org':
			return [draft('OrgId', 'bigint', '机构Id')];
		case 'delete':
			return [draft('IsDelete', type('bit', 'boolean'), '软删除', 0, 0)];
		case 'base':
			return [
				draft('CreateTime', type('datetime', 'timestamp'), '创建时间'),
				draft('UpdateTime', type('datetime', 'timestamp'), '更新时间'),
				draft('CreateUserId', 'bigint', '创建者Id'),
				draft('CreateUserName', 'varchar', '创建者姓名', 64),
				draft('UpdateUserId', 'bigint', '修改者Id'),
				draft('UpdateUserName', 'varchar', '修改者姓名', 64),
			];
	}
}
export function updateColumnType(draft: ColumnDraft) {
	if (['char', 'nchar', 'nvarchar', 'varchar'].includes(draft.dataType)) {
		if (!draft.length) draft.length = 32;
	} else draft.length = 0;
}

export function moveDraftFields<T>(fields: T[], index: number, delta: number): T[] {
	if (fields.length < 2 || index < 0 || index >= fields.length) return fields;
	const next = (index + delta + fields.length) % fields.length;
	const result = [...fields];
	[result[index], result[next]] = [result[next]!, result[index]!];
	return result;
}
