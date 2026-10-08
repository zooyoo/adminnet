import type { PageQuery, PageResult } from '#/components/admin-table/use-admin-table';

import { requestClient } from '#/api/request';

export interface Notice extends Record<string, unknown> {
	id?: number | string;
	title: string;
	content: string;
	type?: number;
	status?: number;
	createUserId?: number | string;
	createUserName?: string;
	publicUserName?: string;
	createTime?: string;
	publicTime?: string;
}

export interface NoticeRecipient extends Record<string, unknown> {
	id?: number | string;
	noticeId?: number | string;
	userId?: number | string;
	readStatus?: number;
	readTime?: string;
	sysNotice?: Notice;
}

export interface NoticeQuery extends Record<string, unknown> {
	title?: string;
	type?: number;
}

export function pageNotices(query: NoticeQuery & PageQuery, signal?: AbortSignal) {
	return requestClient.post<PageResult<Notice>>('/api/sysNotice/page', query, { signal });
}

export function pageReceivedNotices(query: NoticeQuery & PageQuery, signal?: AbortSignal) {
	return requestClient.post<PageResult<NoticeRecipient>>('/api/sysNotice/pageReceived', query, { signal });
}

export function addNotice(notice: Pick<Notice, 'content' | 'title' | 'type'>) {
	return requestClient.post('/api/sysNotice/add', notice);
}

export function updateNotice(notice: Notice) {
	return requestClient.post('/api/sysNotice/update', notice);
}

export function publishNotice(id: number | string) {
	return requestClient.post('/api/sysNotice/public', { id });
}

export function deleteNotice(id: number | string) {
	return requestClient.post('/api/sysNotice/delete', { id });
}

export function setNoticeRead(id: number | string) {
	return requestClient.post('/api/sysNotice/setRead', { id });
}

export function unreadNotices(signal?: AbortSignal) {
	return requestClient.get<Notice[]>('/api/sysNotice/unReadList', { signal });
}
