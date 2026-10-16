import { requestClient } from '#/api/request';

export type RegionId = number | string;

export interface RegionDraft {
	[field: string]: unknown;
	id?: RegionId;
	pid: RegionId;
	name: string;
	code: string;
	cityCode: string;
	orderNo: number;
	remark: string;
}

export interface RegionRow {
	[field: string]: unknown;
	id: RegionId;
	pid?: RegionId;
	name: string;
	code?: null | string;
	cityCode?: null | string;
	orderNo?: number;
	remark?: null | string;
	shortName?: null | string;
	mergerName?: null | string;
	zipCode?: null | string;
	level?: number;
	pinYin?: null | string;
	lng?: number;
	lat?: number;
	children?: null | RegionRow[];
}

export interface RegionPageInput {
	pid: RegionId;
	name: string;
	code: string;
	page: number;
	pageSize: number;
}

export interface RegionPage {
	items: RegionRow[];
	total: number;
}

export interface RegionApi {
	tree(signal: AbortSignal): Promise<RegionRow[]>;
	page(input: RegionPageInput, signal: AbortSignal): Promise<RegionPage>;
	add(input: RegionDraft, signal: AbortSignal): Promise<RegionId>;
	update(input: RegionDraft, signal: AbortSignal): Promise<void>;
	delete(id: RegionId, signal: AbortSignal): Promise<void>;
	sync?(signal: AbortSignal): Promise<void>;
}

const prefix = '/api/sysRegion';
const options = (signal: AbortSignal) => ({ signal, silentError: true });

export const regionApi: RegionApi = {
	tree: (signal) => requestClient.get(`${prefix}/tree`, options(signal)),
	page: (input, signal) => requestClient.post(`${prefix}/page`, input, options(signal)),
	add: (input, signal) => requestClient.post(`${prefix}/add`, input, options(signal)),
	update: (input, signal) => requestClient.post(`${prefix}/update`, input, options(signal)),
	delete: (id, signal) => requestClient.post(`${prefix}/delete`, { id }, options(signal)),
	sync: (signal) => requestClient.post(`${prefix}/sync`, undefined, { ...options(signal), timeout: 0 }),
};
