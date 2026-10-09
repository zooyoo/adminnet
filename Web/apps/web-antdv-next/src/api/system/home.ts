import type { MenuOutput } from '#/api-services/models';

import { requestClient } from '#/api/request';

export interface ScheduleRecord {
	id?: number | string;
	content: string;
	scheduleTime: string;
	startTime: string;
	endTime: string;
	status: number;
}

export const listSchedules = (startTime: string, endTime: string, signal?: AbortSignal) => requestClient.post<ScheduleRecord[]>('/api/sysSchedule/page', { startTime, endTime }, { signal });
export const saveSchedule = (value: ScheduleRecord, signal?: AbortSignal) => requestClient.post(`/api/sysSchedule/${value.id ? 'update' : 'add'}`, value, { signal });
export const deleteSchedule = (id: ScheduleRecord['id'], signal?: AbortSignal) => requestClient.post('/api/sysSchedule/delete', { id }, { signal });
export const setScheduleStatus = (id: ScheduleRecord['id'], status: number, signal?: AbortSignal) => requestClient.post('/api/sysSchedule/setStatus', { id, status }, { signal });
export const getFavoriteMenus = (signal?: AbortSignal) => requestClient.get<MenuOutput[]>('/api/sysUserMenu/userMenuList', { signal });
export const getAvailableMenus = (signal?: AbortSignal) => requestClient.get<MenuOutput[]>('/api/sysMenu/loginMenuTree', { signal });
export const saveFavoriteMenus = (menuIdList: Array<number | string>, signal?: AbortSignal) => requestClient.post('/api/sysUserMenu/add', { menuIdList }, { signal });
