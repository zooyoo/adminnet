import { requestClient } from '#/api/request';

export interface Position extends Record<string, unknown> {
	id?: number | string;
	tenantId?: number | string;
	name: string;
	code: string;
	status: number;
	orderNo: number;
	remark?: string;
	createTime?: string;
	createUserName?: string;
	updateTime?: string;
	updateUserName?: string;
	userList?: Array<{ id: number | string; account: string; realName: string }>;
}

export interface PositionQuery extends Record<string, unknown> {
	name?: string;
	code?: string;
	tenantId?: number | string;
}

export function listPositions(params: PositionQuery, signal?: AbortSignal) {
	return requestClient.get<Position[]>('/api/sysPos/list', { params, signal });
}

export function savePosition(value: Position) {
	return requestClient.post(`/api/sysPos/${value.id ? 'update' : 'add'}`, value);
}

export function deletePosition(id: number | string) {
	return requestClient.post('/api/sysPos/delete', { id });
}
