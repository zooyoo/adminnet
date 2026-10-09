import type { UserInfo } from '@vben/types';

import type { SessionTokens } from '#/api/session';

import { requestClient } from '#/api/request';

export interface AdminUserInfo extends UserInfo {
	id: number | string;
	account: string;
	buttons: string[];
	roleIds: Array<number | string>;
	tenantId?: number | string;
	currentTenantId?: number | string;
	watermarkText?: string;
}

export async function getUserInfoApi(identity?: SessionTokens, signal?: AbortSignal) {
	const data = await requestClient.get<AdminUserInfo>('/api/sysAuth/userInfo', { adminIdentity: identity, signal });
	return {
		...data,
		userId: String(data.id),
		username: data.account,
		roles: (data.roleIds ?? []).map(String),
		buttons: data.buttons ?? [],
		desc: data.desc ?? '',
		homePath: data.homePath ?? '',
		token: '',
	};
}
