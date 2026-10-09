import type { OrgTreeOutput, SysFile, SysUser } from '#/api-services/models';

import { sm2 } from 'sm-crypto-v2';

import { requestClient } from '#/api/request';

export type ProfileRecord = Omit<SysUser, 'birthday'> & { birthday?: null | string };

export function getProfile(signal?: AbortSignal) {
	return requestClient.get<ProfileRecord>('/api/sysUser/baseInfo', { signal });
}

export function saveProfile(value: ProfileRecord, signal?: AbortSignal) {
	return requestClient.post<number>('/api/sysUser/baseInfo', value, { signal });
}

export function profileLanguages(signal?: AbortSignal) {
	return requestClient.post<Array<{ code: string; label: string }>>('/api/sysLang/dropdownData', undefined, { signal });
}

export function profileOrganizations(signal?: AbortSignal) {
	return requestClient.get<OrgTreeOutput[]>('/api/sysUser/orgInfo', { signal });
}

export function changeOwnPassword(passwordOld: string, passwordNew: string, signal?: AbortSignal) {
	const publicKey = import.meta.env.VITE_SM_PUBLIC_KEY;
	if (!publicKey) throw new Error('未配置登录公钥');
	return requestClient.post<number>('/api/sysUser/changePwd', {
		passwordOld: sm2.doEncrypt(passwordOld, publicKey, 1),
		passwordNew: sm2.doEncrypt(passwordNew, publicKey, 1),
	}, { signal, silentError: true });
}

export function uploadProfileImage(file: File, kind: 'avatar' | 'signature', signal?: AbortSignal) {
	const data = new FormData();
	data.append('file', file);
	return requestClient.post<SysFile>(`/api/sysFile/${kind === 'avatar' ? 'uploadAvatar' : 'uploadSignature'}`, data, { signal });
}
