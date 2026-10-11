import { requestClient } from '#/api/request';

export type WechatUserId = number | string;
export type WechatPlatform = 1 | 2 | 3 | 4 | 5;

/** 管理资料契约，不包含登录凭据。 */
export interface WechatUserDraft {
	id?: WechatUserId;
	userId: WechatUserId;
	platformType: WechatPlatform;
	openId: string;
	unionId: null | string;
	nickName: null | string;
	avatar: null | string;
	mobile: null | string;
	sex: 0 | 1 | 2 | null;
	language: null | string;
	city: null | string;
	province: null | string;
	country: null | string;
}

export interface WechatUserRow extends Record<string, unknown>, WechatUserDraft {
	id: WechatUserId;
	tenantId?: null | WechatUserId;
}

export interface WechatUserQuery {
	nickName: string;
	mobile: string;
	platformType?: WechatPlatform;
	tenantId?: WechatUserId;
	page: number;
	pageSize: number;
}

export const wechatUserApi = {
	page: (query: WechatUserQuery, signal: AbortSignal) => requestClient.post<{ items: WechatUserRow[]; total: number }>('/api/sysWechatUser/page', query, { signal, silentError: true }),
	add: (draft: WechatUserDraft, signal: AbortSignal) => requestClient.post('/api/sysWechatUser/add', draft, { signal, silentError: true }),
	update: (draft: WechatUserDraft, signal: AbortSignal) => requestClient.post('/api/sysWechatUser/update', draft, { signal, silentError: true }),
	delete: (id: WechatUserId, signal: AbortSignal) => requestClient.post('/api/sysWechatUser/delete', { id }, { signal, silentError: true }),
};
