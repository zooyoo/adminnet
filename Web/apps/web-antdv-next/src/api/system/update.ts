import { requestClient } from '#/api/request';

export interface SystemUpdateStatus {
	enabled: boolean;
	reason: string;
	targetName: string;
	isRunning: boolean;
}

export interface SystemUpdateBackup {
	fileName: string;
	createTime: string;
}

// 页面提供就地错误反馈；密钥请求也不向全局通知转发服务端错误内容。
export const getSystemUpdateStatus = (signal?: AbortSignal): Promise<SystemUpdateStatus> => requestClient.get('/api/sysUpdate/status', { signal, silentError: true });
export const getSystemUpdateBackups = (signal?: AbortSignal): Promise<SystemUpdateBackup[]> => requestClient.post('/api/sysUpdate/list', undefined, { signal, silentError: true });
export const getSystemUpdateLogs = (signal?: AbortSignal): Promise<string[]> => requestClient.get('/api/sysUpdate/logs', { signal, silentError: true });
export const runSystemUpdate = (signal?: AbortSignal): Promise<void> => requestClient.post('/api/sysUpdate/update', undefined, { signal, timeout: 0, silentError: true });
export const restoreSystemUpdate = (fileName: string, signal?: AbortSignal): Promise<void> => requestClient.post('/api/sysUpdate/restore', { fileName }, { signal, timeout: 0, silentError: true });
export const clearSystemUpdateLogs = (signal?: AbortSignal): Promise<void> => requestClient.get('/api/sysUpdate/clear', { signal, silentError: true });
export const getSystemUpdateWebHookKey = (signal?: AbortSignal): Promise<string> => requestClient.get('/api/sysUpdate/webHookKey', { signal, silentError: true });
