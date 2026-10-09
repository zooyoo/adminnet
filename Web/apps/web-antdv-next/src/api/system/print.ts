import type { AddPrintInput, PagePrintInput, SysPrint, UpdatePrintInput } from '#/api-services/models';

import { SysPrintApi } from '#/api-services/apis/sys-print-api';
import { getAPI } from '#/api/sdk';

export async function listPrintTemplates(input: PagePrintInput, signal?: AbortSignal) {
	const result = (await getAPI(SysPrintApi).apiSysPrintPagePost(input, { signal })).data.result;
	return { items: result?.items ?? [], total: result?.total ?? 0 };
}

export const savePrintTemplate = (input: AddPrintInput | UpdatePrintInput) =>
	' id' in input && input.id ? getAPI(SysPrintApi).apiSysPrintUpdatePost(input) : getAPI(SysPrintApi).apiSysPrintAddPost(input as AddPrintInput);

export const removePrintTemplate = (id: number) => getAPI(SysPrintApi).apiSysPrintDeletePost({ id });

export async function getPrintTemplate(name: string): Promise<SysPrint | undefined> {
	return (await getAPI(SysPrintApi).apiSysPrintPrintNameGet(name)).data.result;
}
