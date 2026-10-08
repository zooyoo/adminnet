import type { TenantRecord, UpdateTenantInput } from '#/api/system/tenant';

export function createTenantDraft(record?: TenantRecord): UpdateTenantInput {
	return {
		id: record?.id,
		userId: record?.userId,
		orgId: record?.orgId,
		name: record?.name ?? '',
		adminAccount: record?.adminAccount ?? '',
		tenantType: record?.tenantType ?? 0,
		dbType: record?.dbType ?? 0,
		phone: record?.phone ?? '',
		email: record?.email ?? '',
		host: record?.host ?? '',
		connection: record?.connection ?? '',
		slaveConnections: record?.slaveConnections ?? '',
		configId: record?.configId,
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
