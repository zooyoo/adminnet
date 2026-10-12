import type { AddCodeGenInput } from '#/api-services/models/add-code-gen-input';
import type { CodeGenConfig } from '#/api-services/models/code-gen-config';
import type { ColumnOuput } from '#/api-services/models/column-ouput';
import type { DatabaseOutput } from '#/api-services/models/database-output';
import type { SysCodeGen } from '#/api-services/models/sys-code-gen';
import type { SysDictData } from '#/api-services/models/sys-dict-data';
import type { SysDictType } from '#/api-services/models/sys-dict-type';
import type { SysMenu } from '#/api-services/models/sys-menu';
import type { TableOutput } from '#/api-services/models/table-output';
import type { TableUniqueConfigItem } from '#/api-services/models/table-unique-config-item';

import { requestClient } from '#/api/request';

export type CodeGenId = number | string;
export type CodeGenRow = Omit<SysCodeGen, 'id'> & Record<string, unknown> & { id: CodeGenId };
export type CodeGenField = Omit<CodeGenConfig, 'codeGenId' | 'id'> & Record<string, unknown> & { id: CodeGenId; codeGenId: CodeGenId };
export type CodeGenDraft = AddCodeGenInput & { id?: CodeGenId; dbNickName?: null | string; tableUniqueList: TableUniqueConfigItem[] };
export interface CodeGenQuery extends Record<string, unknown> { tableName: string; busName: string; }
export interface CodeGenPage { items: CodeGenRow[]; total: number; }
export interface CodeGenOption { label: string; value: string; }
export interface CodeGenConstant { code?: string; name?: string; }

export const codegenApi = {
	page: (query: CodeGenQuery, signal: AbortSignal) => requestClient.post<CodeGenPage>('/api/sysCodeGen/page', query, { signal, silentError: true }),
	detail: (id: CodeGenId, signal: AbortSignal) => requestClient.get<CodeGenRow>('/api/sysCodeGen/detail', { params: { id }, signal, silentError: true }),
	add: (draft: CodeGenDraft, signal: AbortSignal) => requestClient.post('/api/sysCodeGen/add', draft, { signal, silentError: true }),
	update: (draft: CodeGenDraft, signal: AbortSignal) => requestClient.post('/api/sysCodeGen/update', draft, { signal, silentError: true }),
	delete: (ids: CodeGenId[], signal: AbortSignal) => requestClient.post('/api/sysCodeGen/delete', ids.map((id) => ({ id })), { signal, silentError: true }),
	sync: (draft: CodeGenDraft, signal: AbortSignal) => requestClient.post('/api/sysCodeGen/syncField', draft, { signal, silentError: true }),
	fields: (id: CodeGenId, signal: AbortSignal) => requestClient.get<CodeGenField[]>('/api/sysCodeGenConfig/list', { params: { codeGenId: id }, signal, silentError: true }),
	saveFields: (fields: CodeGenField[], signal: AbortSignal) => requestClient.post('/api/sysCodeGenConfig/update', fields, { signal, silentError: true }),
	databases: (signal: AbortSignal) => requestClient.get<DatabaseOutput[]>('/api/sysCodeGen/databaseList', { signal, silentError: true }),
	tables: (configId: string, signal: AbortSignal) => requestClient.get<TableOutput[]>(`/api/sysCodeGen/tableList/${encodeURIComponent(configId)}`, { signal, silentError: true }),
	columns: (tableName: string, configId: string, signal: AbortSignal) => requestClient.get<ColumnOuput[]>(`/api/sysCodeGen/columnListByTableName/${encodeURIComponent(tableName)}/${encodeURIComponent(configId)}`, { signal, silentError: true }),
	namespaces: (signal: AbortSignal) => requestClient.get<string[]>('/api/sysCodeGen/applicationNamespaces', { signal, silentError: true }),
	menus: (signal: AbortSignal) => requestClient.get<SysMenu[]>('/api/sysMenu/list', { signal, silentError: true }),
	dictionaries: (signal: AbortSignal) => requestClient.get<SysDictType[]>('/api/sysDictType/list', { signal, silentError: true }),
	constants: (signal: AbortSignal) => requestClient.get<CodeGenConstant[]>('/api/sysConst/list', { signal, silentError: true }),
	options: async (code: string, signal: AbortSignal): Promise<CodeGenOption[]> => {
		const rows = await requestClient.get<SysDictData[]>(`/api/sysDictData/dataList/${encodeURIComponent(code)}`, { signal, silentError: true });
		return rows.map((row) => ({ value: String(row.value ?? ''), label: row.label ?? String(row.value ?? '') }));
	},
};
