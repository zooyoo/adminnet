import { requestClient } from '#/api/request';

export type TemplateId = number | string;
export type TemplateType = 1 | 2 | 3 | 4 | 7;
export type TemplateSortField = 'code' | 'groupName' | 'name' | 'orderNo' | 'type';
export type TemplateSortOrder = 'ascending' | 'descending';

export interface TemplateRow extends Record<string, unknown> {
	id: TemplateId;
	name: string;
	code: string;
	groupName: string;
	type: TemplateType;
	content: string;
	orderNo: number;
	remark?: string;
	tenantId?: TemplateId;
}

export interface TemplateDraft extends Record<string, unknown> {
	id?: TemplateId;
	name: string;
	code: string;
	groupName: string;
	type: TemplateType;
	content: string;
	orderNo: number;
	remark: string;
	tenantId?: TemplateId;
}

export interface TemplateQuery {
	name: string;
	code: string;
	groupName: string;
	type?: TemplateType;
	tenantId?: TemplateId;
	page: number;
	pageSize: number;
}

export interface TemplatePage {
	items: TemplateRow[];
	total: number;
}

export interface TemplateApi {
	page(query: TemplateQuery, signal: AbortSignal): Promise<TemplatePage>;
	groups(signal: AbortSignal): Promise<string[]>;
	add(draft: TemplateDraft, signal: AbortSignal): Promise<unknown>;
	update(draft: TemplateDraft, signal: AbortSignal): Promise<unknown>;
	delete(id: TemplateId, signal: AbortSignal): Promise<unknown>;
	render(input: { content: string; data: Record<string, string> }, signal: AbortSignal): Promise<string>;
}

export const templateApi: TemplateApi = {
	page: (query, signal) => requestClient.post('/api/sysTemplate/page', query, { signal, silentError: true }),
	groups: (signal) => requestClient.get('/api/sysTemplate/groupList', { signal, silentError: true }),
	add: (draft, signal) => requestClient.post('/api/sysTemplate/add', draft, { signal, silentError: true }),
	update: (draft, signal) => requestClient.post('/api/sysTemplate/update', draft, { signal, silentError: true }),
	delete: (id, signal) => requestClient.post('/api/sysTemplate/delete', { id }, { signal, silentError: true }),
	// 先序列化完整 JSON，保留 Axios 合并对象时会丢弃的原参数键。
	render: (input, signal) => requestClient.post('/api/sysTemplate/render', JSON.stringify(input), { headers: { 'Content-Type': 'application/json;charset=utf-8' }, signal, silentError: true }),
};
