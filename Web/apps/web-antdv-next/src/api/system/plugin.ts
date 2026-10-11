import { requestClient } from '#/api/request';

export type PluginId = number | string;
export type PluginStatus = 1 | 2;

export interface PluginDraft {
	id?: PluginId;
	name: string;
	assemblyName: string;
	csharpCode: string;
	orderNo: number;
	status: PluginStatus;
	remark: string;
	tenantId?: PluginId;
}

export interface PluginRow extends Omit<PluginDraft, 'assemblyName' | 'id' | 'remark'> {
	id: PluginId;
	assemblyName?: null | string;
	remark?: null | string;
	createTime?: string;
	updateTime?: null | string;
	createUserName?: null | string;
	updateUserName?: null | string;
}

export interface PluginQuery {
	name: string;
	tenantId?: PluginId;
	page: number;
	pageSize: number;
}

export interface PluginPage {
	items: PluginRow[];
	total: number;
}

export interface PluginApi {
	page(query: PluginQuery, signal: AbortSignal): Promise<PluginPage>;
	add(draft: PluginDraft, signal: AbortSignal): Promise<unknown>;
	update(draft: PluginDraft, signal: AbortSignal): Promise<unknown>;
	delete(id: PluginId, signal: AbortSignal): Promise<unknown>;
}

// 页面沿用四个既有管理接口，编译和运行由后端保存流程负责。
export const pluginApi: PluginApi = {
	page: (query, signal) => requestClient.post('/api/sysPlugin/page', query, { signal, silentError: true }),
	add: (draft, signal) => requestClient.post('/api/sysPlugin/add', draft, { signal, silentError: true }),
	update: (draft, signal) => requestClient.post('/api/sysPlugin/update', draft, { signal, silentError: true }),
	delete: (id, signal) => requestClient.post('/api/sysPlugin/delete', { id }, { signal, silentError: true }),
};
