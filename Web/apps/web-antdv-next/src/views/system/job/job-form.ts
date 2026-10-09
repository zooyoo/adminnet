import type { AddJobDetailInput, AddJobTriggerInput, SysJobDetail, SysJobTrigger } from '#/api-services/models';

export const cronType = 'Furion.Schedule.CronTrigger';
export const periodType = 'Furion.Schedule.PeriodTrigger';
export const statusTitles = ['积压', '就绪', '正在运行', '暂停', '阻塞', '失败后就绪', '归档', '崩溃', '超限', '无触发时间', '未启动', '未知触发器', '未知任务'];
export const typeTitles = ['内置', '脚本', 'HTTP'];
export function cronArgs(expression: string, format: number) {
	if (!expression.trim()) throw new Error('Cron 表达式不能为空');
	return `${JSON.stringify(expression.trim())},${format}`;
}
export function parseCronArgs(args?: null | string): { expression: string; format: number } {
	const source = args?.trim() ?? '';
	const values: unknown = JSON.parse(source.startsWith('[') ? source : `[${source}]`);
	if (!Array.isArray(values) || values.length !== 2 || typeof values[0] !== 'string' || ![0, 1, 2, 3].includes(values[1])) throw new Error('Cron 参数格式无效');
	return { expression: values[0], format: values[1] };
}
export function jobDraft(record?: SysJobDetail): AddJobDetailInput {
	return {
		...record,
		jobId: record?.jobId ?? '',
		groupName: record?.groupName ?? '',
		description: record?.description ?? '',
		createType: record?.createType ?? 2,
		concurrent: record?.concurrent ?? false,
		includeAnnotation: record?.includeAnnotation ?? false,
		properties: record?.properties ?? '{}',
		scriptCode: record?.scriptCode ?? '',
	};
}
export function httpFields(properties?: null | string) {
	const values = JSON.parse(properties || '{}');
	const http = typeof values.HttpJob === 'string' ? JSON.parse(values.HttpJob) : (values.HttpJob ?? {});
	return { uri: String(http.RequestUri ?? ''), method: String(http.HttpMethod?.Method ?? 'GET'), body: String(http.Body ?? '') };
}
export function jobPayload(draft: AddJobDetailInput, http: ReturnType<typeof httpFields>): AddJobDetailInput {
	if (draft.jobId.trim().length < 2 || draft.jobId.trim().length > 64) throw new Error('任务编号长度必须为 2 至 64 个字符');
	const properties = JSON.parse(draft.properties || '{}');
	if (Array.isArray(properties) || properties === null || typeof properties !== 'object') throw new Error('任务参数必须是 JSON 对象');
	if (draft.createType === 1 && !draft.scriptCode?.trim()) throw new Error('脚本代码不能为空');
	if (draft.createType === 2) {
		const uri = new URL(http.uri);
		if (!['http:', 'https:'].includes(uri.protocol)) throw new Error('HTTP 地址必须使用 http 或 https');
		const existing = typeof properties.HttpJob === 'string' ? JSON.parse(properties.HttpJob) : (properties.HttpJob ?? {});
		properties.HttpJob = JSON.stringify({
			...existing,
			RequestUri: http.uri,
			HttpMethod: { Method: http.method },
			Body: http.body,
			ClientName: existing.ClientName ?? 'HttpJob',
			EnsureSuccessStatusCode: existing.EnsureSuccessStatusCode ?? true,
		});
	}
	return { ...draft, jobId: draft.jobId.trim(), properties: JSON.stringify(properties) };
}
export function triggerDraft(jobId: string, record?: SysJobTrigger): AddJobTriggerInput {
	return {
		...record,
		jobId,
		triggerId: record?.triggerId ?? '',
		triggerType: record?.triggerType ?? cronType,
		assemblyName: record?.assemblyName ?? 'Furion',
		args: record?.args ?? '"0 */5 * * * *",2',
		description: record?.description ?? '',
		startNow: record?.startNow ?? true,
		runOnStart: record?.runOnStart ?? false,
		resetOnlyOnce: record?.resetOnlyOnce ?? true,
		maxNumberOfRuns: record?.maxNumberOfRuns ?? 0,
		maxNumberOfErrors: record?.maxNumberOfErrors ?? 0,
		numRetries: record?.numRetries ?? 0,
		retryTimeout: record?.retryTimeout ?? 1000,
	};
}
export function wallTime(value?: Date | null | string) {
	return value ? String(value).replace(' ', 'T').slice(0, 19) : '';
}
export const cronFormats = [
	{ value: 0, label: '5 字段：分 时 日 月 周' },
	{ value: 1, label: '6 字段：分 时 日 月 周 年' },
	{ value: 2, label: '6 字段：秒 分 时 日 月 周' },
	{ value: 3, label: '7 字段：秒 分 时 日 月 周 年' },
];
export const cronFieldTitles = [
	['分钟', '小时', '日期', '月份', '星期'],
	['分钟', '小时', '日期', '月份', '星期', '年份'],
	['秒', '分钟', '小时', '日期', '月份', '星期'],
	['秒', '分钟', '小时', '日期', '月份', '星期', '年份'],
];
