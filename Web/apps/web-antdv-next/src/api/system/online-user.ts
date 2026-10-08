import type { PageQuery, PageResult } from '#/components/admin-table/use-admin-table';

import { requestClient } from '#/api/request';

export interface OnlineUser extends Record<string, unknown> {
	id: number | string;
	tenantId?: number | string;
	connectionId: string;
	userId: number | string;
	userName: string;
	realName?: string;
	ip?: string;
	browser?: string;
	os?: string;
	time?: string;
}

export interface OnlineUserQuery extends Record<string, unknown> {
	userName?: string;
	realName?: string;
	tenantId?: number | string;
}

export function pageOnlineUsers(query: OnlineUserQuery & PageQuery, signal?: AbortSignal) {
	return requestClient.post<PageResult<OnlineUser>>('/api/sysOnlineUser/page', query, { signal });
}

export function forceOffline(user: OnlineUser) {
	return requestClient.post('/api/sysOnlineUser/forceOffline', { id: user.id, connectionId: user.connectionId });
}
