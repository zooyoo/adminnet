import type { AddDictDataInput, AddDictTypeInput, PageDictDataInput, PageDictTypeInput, SysDictData, SysDictType, UpdateDictDataInput, UpdateDictTypeInput } from '#/api-services/models';

import { SysDictDataApi } from '#/api-services/apis/sys-dict-data-api';
import { SysDictTypeApi } from '#/api-services/apis/sys-dict-type-api';
import { getAPI } from '#/api/sdk';

export type DictType = Record<string, unknown> & SysDictType;
export type DictData = Record<string, unknown> & SysDictData;
export type { AddDictDataInput, AddDictTypeInput, UpdateDictDataInput, UpdateDictTypeInput };
export async function dictTypePage(query: PageDictTypeInput, signal?: AbortSignal) {
	const data = (await getAPI(SysDictTypeApi).apiSysDictTypePagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as DictType[], total: data?.total ?? 0 };
}
export async function dictDataPage(query: PageDictDataInput, signal?: AbortSignal) {
	if (!query.dictTypeId) return { items: [], total: 0 };
	const data = (await getAPI(SysDictDataApi).apiSysDictDataPagePost(query, { signal })).data.result;
	return { items: (data?.items ?? []) as DictData[], total: data?.total ?? 0 };
}
export function saveDictType(value: AddDictTypeInput | UpdateDictTypeInput) {
	return value.id ? getAPI(SysDictTypeApi).apiSysDictTypeUpdatePost(value) : getAPI(SysDictTypeApi).apiSysDictTypeAddPost(value);
}
export function saveDictData(value: AddDictDataInput | UpdateDictDataInput) {
	return value.id ? getAPI(SysDictDataApi).apiSysDictDataUpdatePost(value) : getAPI(SysDictDataApi).apiSysDictDataAddPost(value);
}
export const removeDictType = (id: number) => getAPI(SysDictTypeApi).apiSysDictTypeDeletePost({ id });
export const removeDictData = (id: number) => getAPI(SysDictDataApi).apiSysDictDataDeletePost({ id });
export const dictTagColor = (tag?: null | string) => ({ primary: 'processing', info: 'default', danger: 'error', warning: 'warning', success: 'success' })[tag ?? ''] ?? 'default';
