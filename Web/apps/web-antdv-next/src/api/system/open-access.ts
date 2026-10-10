import { requestClient } from '#/api/request';

export type OpenAccessId = number | string;
export type OpenAccessMethod = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

export interface OpenAccessDraft {
	id?: OpenAccessId;
	accessKey: string;
	accessSecret: string;
	bindTenantId?: OpenAccessId;
	bindUserId?: OpenAccessId;
	[field: string]: unknown;
}

export interface OpenAccessRow extends OpenAccessDraft {
	id: OpenAccessId;
	bindUserAccount?: string;
	bindTenantName?: string;
	createTime?: string;
	updateTime?: string;
	createUserName?: string;
	updateUserName?: string;
	status?: number;
}

export interface OpenAccessQuery {
	page: number;
	pageSize: number;
	accessKey?: string;
}

export interface OpenAccessPage {
	items: OpenAccessRow[];
	total: number;
}

export interface OpenAccessTenant {
	id: OpenAccessId;
	name: string;
}

export interface OpenAccessUser {
	id: OpenAccessId;
	account: string;
	realName?: string;
	tenantId: OpenAccessId;
}

export interface OpenAccessSignatureInput {
	accessKey: string;
	accessSecret: string;
	method: OpenAccessMethod;
	url: string;
	timestamp: number;
	nonce: string;
}

export interface OpenAccessApi {
	page: (input: OpenAccessQuery, signal: AbortSignal) => Promise<OpenAccessPage>;
	add: (input: OpenAccessDraft, signal: AbortSignal) => Promise<unknown>;
	update: (input: OpenAccessDraft, signal: AbortSignal) => Promise<unknown>;
	delete: (input: { id: OpenAccessId }, signal: AbortSignal) => Promise<unknown>;
	tenantList: (signal: AbortSignal) => Promise<OpenAccessTenant[]>;
	userList: (input: { tenantId: OpenAccessId }, signal: AbortSignal) => Promise<OpenAccessUser[]>;
	secret: (signal: AbortSignal) => Promise<string>;
	generateSignature: (input: OpenAccessSignatureInput, signal: AbortSignal) => Promise<string>;
}

// 使用固定错误文案，避免服务端错误文本包含用户正在编辑的凭据。
const options = (signal: AbortSignal) => ({ signal, silentError: true });
const prefix = '/api/sysOpenAccess';

export const openAccessApi: OpenAccessApi = {
	page: (input, signal) => requestClient.post(`${prefix}/page`, input, options(signal)),
	add: (input, signal) => requestClient.post(`${prefix}/add`, input, options(signal)),
	update: (input, signal) => requestClient.post(`${prefix}/update`, input, options(signal)),
	delete: (input, signal) => requestClient.post(`${prefix}/delete`, input, options(signal)),
	tenantList: (signal) => requestClient.get(`${prefix}/tenantList`, options(signal)),
	userList: (input, signal) => requestClient.post(`${prefix}/userList`, input, options(signal)),
	secret: (signal) => requestClient.post(`${prefix}/secret`, undefined, options(signal)),
	generateSignature: (input, signal) => requestClient.post(`${prefix}/generateSignature`, input, options(signal)),
};
