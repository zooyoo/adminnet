import type { AxiosResponse } from 'axios';

import type { AddSysLangTextInput, PageSysLangTextInput, SysLangTextOutput, UpdateSysLangTextInput } from '#/api-services/models';

import { SysLangTextApi } from '#/api-services/apis/sys-lang-text-api';
import { requestClient } from '#/api/request';
import { getAPI } from '#/api/sdk';

export type TranslationRecord = Record<string, unknown> & SysLangTextOutput;
export type TranslationDraft = AddSysLangTextInput & { id?: number };
export async function translationPage(query: PageSysLangTextInput, signal?: AbortSignal) {
	const data = (await getAPI(SysLangTextApi).apiSysLangTextPagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as TranslationRecord[], total: data?.total ?? 0 };
}
export async function translationDetail(id: number) {
	const value = (await getAPI(SysLangTextApi).apiSysLangTextDetailGet(id)).data.result;
	if (!value) throw new Error('翻译记录不存在');
	return value;
}
export function translationDraft(record?: Partial<TranslationDraft>): TranslationDraft {
	return {
		id: record?.id,
		entityName: record?.entityName ?? '',
		entityId: record?.entityId ?? 0,
		fieldName: record?.fieldName ?? '',
		langCode: record?.langCode ?? '',
		content: record?.content ?? '',
	};
}
export function saveTranslation(value: TranslationDraft) {
	return value.id ? getAPI(SysLangTextApi).apiSysLangTextUpdatePost({ ...value, id: value.id } satisfies UpdateSysLangTextInput) : getAPI(SysLangTextApi).apiSysLangTextAddPost(value);
}
export const removeTranslation = (id: number) => getAPI(SysLangTextApi).apiSysLangTextDeletePost({ id });
export const removeTranslations = (ids: number[]) => getAPI(SysLangTextApi).apiSysLangTextBatchDeletePost(ids.map((id) => ({ id })));
export function exportTranslations(input: PageSysLangTextInput) {
	return requestClient.post<AxiosResponse<ArrayBuffer>>('/api/sysLangText/export', input, { responseType: 'arraybuffer', responseReturn: 'raw' });
}
export function translationImportTemplate() {
	return requestClient.get<AxiosResponse<ArrayBuffer>>('/api/sysLangText/import', { responseType: 'arraybuffer', responseReturn: 'raw' });
}
export function importTranslations(file: File) {
	const data = new FormData();
	data.append('file', file);
	return requestClient.post<AxiosResponse<ArrayBuffer>>('/api/sysLangText/import', data, { responseType: 'arraybuffer', responseReturn: 'raw', timeout: 600_000 });
}
