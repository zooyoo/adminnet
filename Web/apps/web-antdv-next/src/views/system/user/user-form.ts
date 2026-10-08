import type { UserDraft, UserRecord } from '#/api/system/user';

function dateOnly(value: Date | null | string | undefined) {
	if (!value) return null;
	if (typeof value === 'string') return value.slice(0, 10);
	const pad = (part: number) => String(part).padStart(2, '0');
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function createUserDraft(record?: UserRecord, copy = false, tenantId?: number, orgId?: number): UserDraft {
	return {
		id: copy ? undefined : record?.id,
		tenantId: record?.tenantId ?? tenantId,
		account: copy ? '' : (record?.account ?? ''),
		realName: record?.realName ?? '',
		nickName: record?.nickName ?? '',
		phone: record?.phone ?? '',
		email: record?.email ?? '',
		accountType: record?.accountType ?? 777,
		langCode: record?.langCode ?? 'zh-CN',
		homepage: record?.homepage ?? '',
		orderNo: record?.orderNo ?? 100,
		orgId: record?.orgId ?? orgId,
		posId: record?.posId,
		jobNum: record?.jobNum ?? '',
		domainAccount: record?.domainAccount ?? '',
		joinDate: dateOnly(record?.joinDate),
		birthday: dateOnly(record?.birthday),
		cardType: record?.cardType ?? 0,
		idCardNum: record?.idCardNum ?? '',
		sex: record?.sex ?? 1,
		age: record?.age,
		nation: record?.nation ?? '',
		address: record?.address ?? '',
		college: record?.college ?? '',
		cultureLevel: record?.cultureLevel ?? 5,
		politicalOutlook: record?.politicalOutlook ?? '',
		officePhone: record?.officePhone ?? '',
		emergencyContact: record?.emergencyContact ?? '',
		emergencyPhone: record?.emergencyPhone ?? '',
		emergencyAddress: record?.emergencyAddress ?? '',
		remark: record?.remark ?? '',
		roleIdList: [],
		extOrgIdList: [],
	};
}

export function validateAssignments(draft: UserDraft) {
	const pairs = new Set<string>();
	for (const row of draft.extOrgIdList ?? []) {
		if (!row.orgId || !row.posId) return '请补全附属机构和职位';
		const pair = `${row.orgId}:${row.posId}`;
		if (pairs.has(pair)) return '附属机构和职位不能重复';
		pairs.add(pair);
	}
	return '';
}
