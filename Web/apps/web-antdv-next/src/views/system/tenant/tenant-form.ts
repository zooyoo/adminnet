import type { TenantRecord, UpdateTenantInput } from '#/api/system/tenant';

export function createTenantDraft(record?: TenantRecord, copy = false): UpdateTenantInput {
	return {
		id: copy ? undefined : record?.id,
		userId: copy ? undefined : record?.userId,
		orgId: copy ? undefined : record?.orgId,
		name: record?.name ?? '',
		adminAccount: record?.adminAccount ?? '',
		tenantType: record?.tenantType ?? 0,
		dbType: record?.dbType ?? 0,
		phone: record?.phone ?? '',
		email: record?.email ?? '',
		host: record?.host ?? '',
		connection: record?.connection ?? '',
		slaveConnections: record?.slaveConnections ?? '',
		configId: copy ? undefined : record?.configId,
		orderNo: record?.orderNo ?? 100,
		status: record?.status ?? 1,
		remark: record?.remark ?? '',
		logo: record?.logo ?? '',
		title: record?.title ?? '',
		viceTitle: record?.viceTitle ?? '',
		viceDesc: record?.viceDesc ?? '',
		copyright: record?.copyright ?? '',
		icp: record?.icp ?? '',
		icpUrl: record?.icpUrl ?? '',
		watermark: record?.watermark ?? '',
		enableReg: record?.enableReg ?? 2,
		regWayId: record?.regWayId,
	};
}

export function createTenantSaveInput(draft: UpdateTenantInput): UpdateTenantInput {
	// 禁用时沿用旧请求的省略规则；保留草稿选择，支持切回启用和失败重试。
	return { ...draft, regWayId: draft.enableReg === 1 ? draft.regWayId : undefined };
}

export function isDefaultTenant(record: TenantRecord) {
	return record.configId === '1300000000001' || record.id === 1300000000001;
}

export function logoAsDataUrl(file: File): Promise<string> {
	return new Promise((resolve, reject) => {
		const reader = new FileReader();
		reader.onload = () => resolve(String(reader.result));
		reader.onerror = () => reject(new Error('无法读取 Logo 文件'));
		reader.readAsDataURL(file);
	});
}
