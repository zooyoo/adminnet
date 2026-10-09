import type { AxiosResponse } from 'axios';

import type { SysFile } from '#/api-services/models';

import { decodeFileResponse } from '#/api/file-response';
import { requestClient } from '#/api/request';

export type FileRecord = Record<string, unknown> & SysFile;
export interface FileQuery extends Record<string, unknown> {
	fileName?: string;
	startTime?: string;
	endTime?: string;
	tenantId?: number;
	page?: number;
	pageSize?: number;
}
export async function filePage(query: FileQuery, signal?: AbortSignal) {
	return requestClient.post<{ items: FileRecord[]; total: number }>('/api/sysFile/page', query, { signal });
}
export function uploadFile(file: File, fileType = '', isPublic = false, signal?: AbortSignal) {
	const data = new FormData();
	data.append('file', file);
	data.append('fileType', fileType);
	data.append('isPublic', String(isPublic));
	return requestClient.post<FileRecord>('/api/sysFile/uploadFile', data, { signal });
}
export function saveFile(file: FileRecord, signal?: AbortSignal) {
	const { id, fileName, fileType, isPublic, fileAlias, dataId } = file;
	return requestClient.post('/api/sysFile/update', { id, fileName, fileType, isPublic, fileAlias, dataId }, { signal });
}
export const removeFile = (id: number, signal?: AbortSignal) => requestClient.post('/api/sysFile/delete', { id }, { signal });
export async function readFile(file: SysFile, signal?: AbortSignal) {
	const response = await requestClient.post<AxiosResponse<ArrayBuffer>>(
		'/api/sysFile/downloadFile',
		{ id: file.id },
		{
			signal,
			responseType: 'arraybuffer',
			responseReturn: 'raw',
		}
	);
	const decoded = await decodeFileResponse(response, `${file.fileName ?? '文件'}${file.suffix ?? ''}`);
	if (decoded.kind !== 'file') throw new Error('服务未返回文件内容');
	return decoded.file;
}
