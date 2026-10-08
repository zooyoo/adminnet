import type { AddSysLangInput, PageSysLangInput, SysLangOutput, UpdateSysLangInput } from '#/api-services/models';

import { SysLangApi } from '#/api-services/apis/sys-lang-api';
import { getAPI } from '#/api/sdk';

export type LanguageRecord = Record<string, unknown> & SysLangOutput;
export type LanguageDraft = AddSysLangInput & { id?: number };
export const languageFields = [
	{ key: 'name', label: '语言名称', required: true },
	{ key: 'code', label: '语言代码', required: true },
	{ key: 'isoCode', label: 'ISO 语言代码', required: true },
	{ key: 'urlCode', label: 'URL 语言代码', required: true },
	{ key: 'dateFormat', label: '日期格式', required: true },
	{ key: 'timeFormat', label: '时间格式', required: true },
	{ key: 'grouping', label: '分组符号', required: true },
	{ key: 'decimalPoint', label: '小数点符号', required: true },
	{ key: 'thousandsSep', label: '千分位分隔符', required: false },
] as const;
export const directionOptions = [
	{ label: '从左到右', value: 1 },
	{ label: '从右到左', value: 2 },
];
export const weekOptions = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'].map((label, index) => ({ label, value: index + 1 }));
export async function languagePage(query: PageSysLangInput, signal?: AbortSignal) {
	const data = (await getAPI(SysLangApi).apiSysLangPagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as LanguageRecord[], total: data?.total ?? 0 };
}
export async function languageDetail(id: number) {
	const value = (await getAPI(SysLangApi).apiSysLangDetailGet(id)).data.result;
	if (!value) throw new Error('语言记录不存在');
	return value;
}
export function languageDraft(record?: Partial<LanguageDraft>): LanguageDraft {
	return {
		id: record?.id,
		name: record?.name ?? '',
		code: record?.code ?? '',
		isoCode: record?.isoCode ?? '',
		urlCode: record?.urlCode ?? '',
		dateFormat: record?.dateFormat ?? '',
		timeFormat: record?.timeFormat ?? '',
		grouping: record?.grouping ?? '',
		decimalPoint: record?.decimalPoint ?? '',
		thousandsSep: record?.thousandsSep ?? '',
		direction: record?.direction ?? 1,
		weekStart: record?.weekStart ?? 7,
		active: record?.active ?? false,
	};
}
export function saveLanguage(value: LanguageDraft) {
	return value.id ? getAPI(SysLangApi).apiSysLangUpdatePost({ ...value, id: value.id } satisfies UpdateSysLangInput) : getAPI(SysLangApi).apiSysLangAddPost(value);
}
export const removeLanguage = (id: number) => getAPI(SysLangApi).apiSysLangDeletePost({ id });
