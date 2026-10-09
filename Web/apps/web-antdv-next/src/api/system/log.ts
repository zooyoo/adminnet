import type { AxiosResponse } from 'axios';

import type { PageExLogInput, SysLogDiff, SysLogOp } from '#/api-services/models';

import { SysLogDiffApi } from '#/api-services/apis/sys-log-diff-api';
import { SysLogExApi } from '#/api-services/apis/sys-log-ex-api';
import { SysLogOpApi } from '#/api-services/apis/sys-log-op-api';
import { SysLogVisApi } from '#/api-services/apis/sys-log-vis-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

export type LogKind = 'diff' | 'ex' | 'op' | 'vis';
export type LogQuery = Omit<PageExLogInput, 'endTime' | 'startTime'> & { endTime?: null | string; startTime?: null | string };
export type LogRecord = Record<string, unknown> & SysLogDiff & SysLogOp;
export type LogPage = { items: LogRecord[]; total: number };

export async function logPage(kind: LogKind, input: LogQuery, signal?: AbortSignal): Promise<LogPage> {
	const value = input as PageExLogInput;
	const result = kind === 'vis'
		? (await getAPI(SysLogVisApi).apiSysLogVisPagePost(value, { signal })).data.result
		: kind === 'op'
			? (await getAPI(SysLogOpApi).apiSysLogOpPagePost(value, { signal })).data.result
			: kind === 'ex'
				? (await getAPI(SysLogExApi).apiSysLogExPagePost(value, { signal })).data.result
				: (await getAPI(SysLogDiffApi).apiSysLogDiffPagePost(value, { signal })).data.result;
	return { items: (result?.items ?? []).map(item => ({ ...item })), total: result?.total ?? 0 };
}

export async function logDetail(kind: Exclude<LogKind, 'vis'>, id: number, signal?: AbortSignal) {
	return kind === 'op'
		? (await getAPI(SysLogOpApi).apiSysLogOpDetailIdGet(id, { signal })).data.result
		: kind === 'ex'
			? (await getAPI(SysLogExApi).apiSysLogExDetailIdGet(id, { signal })).data.result
			: (await getAPI(SysLogDiffApi).apiSysLogDiffDetailIdGet(id, { signal })).data.result;
}

export async function clearLogs(kind: Exclude<LogKind, 'diff'>, signal?: AbortSignal) {
	if (kind === 'vis') return getAPI(SysLogVisApi).apiSysLogVisClearPost({ signal });
	if (kind === 'op') return getAPI(SysLogOpApi).apiSysLogOpClearPost({ signal });
	return getAPI(SysLogExApi).apiSysLogExClearPost({ signal });
}

export async function exportLogs(kind: 'ex' | 'op', input: Pick<LogQuery, 'endTime' | 'startTime' | 'tenantId'>, signal?: AbortSignal) {
	return requestClient.post<AxiosResponse<Blob>>(`/api/${kind === 'op' ? 'sysLogOp' : 'sysLogEx'}/export`, input, { signal, responseType: 'blob', responseReturn: 'raw' });
}
