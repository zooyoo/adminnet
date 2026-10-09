import type { AddJobDetailInput, AddJobTriggerInput, PageJobDetailInput, PageJobTriggerRecordInput, SysJobDetail, SysJobTrigger } from '#/api-services/models';

import { SysJobApi } from '#/api-services/apis/sys-job-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

export type JobRecord = Record<string, unknown> & SysJobDetail & { jobTriggers: SysJobTrigger[] };
export type TriggerInput = Omit<AddJobTriggerInput, 'endTime' | 'startTime'> & { startTime?: null | string; endTime?: null | string };
export interface CronPreview {
	expression: string;
	format: number;
	fromTime: string;
	timeZoneId: string;
	occurrences: string[];
}
export interface CronPreviewQuery {
	expression: string;
	format: number;
	fromTime?: string;
	startTime?: string;
	endTime?: string;
	timeZoneId?: string;
}
export async function jobPage(input: PageJobDetailInput, signal?: AbortSignal) {
	const result = (await getAPI(SysJobApi).apiSysJobPageJobDetailPost(input, { signal })).data.result;
	return { items: (result?.items ?? []).filter((item) => item.jobDetail).map((item) => ({ ...item.jobDetail!, jobTriggers: item.jobTriggers ?? [] })), total: result?.total ?? 0 };
}
export async function jobGroups(signal?: AbortSignal) {
	return (await getAPI(SysJobApi).apiSysJobListJobGroupPost({ signal })).data.result ?? [];
}
export const saveJob = (input: AddJobDetailInput, signal?: AbortSignal) =>
	input.id ? getAPI(SysJobApi).apiSysJobUpdateJobDetailPost(input, { signal }) : getAPI(SysJobApi).apiSysJobAddJobDetailPost(input, { signal });
export const saveTrigger = (input: TriggerInput, signal?: AbortSignal) =>
	input.id ? getAPI(SysJobApi).apiSysJobUpdateJobTriggerPost(input as AddJobTriggerInput, { signal }) : getAPI(SysJobApi).apiSysJobAddJobTriggerPost(input as AddJobTriggerInput, { signal });
export async function previewCron(input: CronPreviewQuery, signal?: AbortSignal): Promise<CronPreview> {
	return requestClient.post<CronPreview>('/api/sysJob/cronPreview', input, { signal });
}
export async function jobRecords(input: PageJobTriggerRecordInput, signal?: AbortSignal) {
	const result = (await getAPI(SysJobApi).apiSysJobPageJobTriggerRecordPost(input, { signal })).data.result;
	return { items: (result?.items ?? []).map((record) => ({ ...record })), total: result?.total ?? 0 };
}
export async function jobClusters(signal?: AbortSignal) {
	return ((await getAPI(SysJobApi).apiSysJobJobClusterListGet({ signal })).data.result ?? []).map((record) => ({ ...record }));
}
export const jobActions = {
	runJob: (jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobRunJobPost({ jobId }, { signal }),
	pauseJob: (jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobPauseJobPost({ jobId }, { signal }),
	startJob: (jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobStartJobPost({ jobId }, { signal }),
	cancelJob: (jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobCancelJobPost({ jobId }, { signal }),
	deleteJobDetail: (jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobDeleteJobDetailPost({ jobId }, { signal }),
	startAllJob: (_jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobStartAllJobPost({ signal }),
	pauseAllJob: (_jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobPauseAllJobPost({ signal }),
	cancelSleep: (_jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobCancelSleepPost({ signal }),
	persistAll: (_jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobPersistAllPost({ signal }),
	clearJobTriggerRecord: (_jobId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobClearJobTriggerRecordPost({ signal }),
};
export const triggerActions = {
	pauseTrigger: (jobId: string, triggerId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobPauseTriggerPost({ jobId, triggerId }, { signal }),
	startTrigger: (jobId: string, triggerId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobStartTriggerPost({ jobId, triggerId }, { signal }),
	deleteJobTrigger: (jobId: string, triggerId: string, signal?: AbortSignal) => getAPI(SysJobApi).apiSysJobDeleteJobTriggerPost({ jobId, triggerId }, { signal }),
};
