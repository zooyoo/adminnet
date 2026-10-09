import type { SessionTokens } from '#/api/session';

import { sm2 } from 'sm-crypto-v2';

import { requestClient } from '#/api/request';

export namespace AuthApi {
	export interface LoginParams {
		account: string;
		password: string;
		tenantId?: number | string;
		code?: string;
		codeId?: number | string;
	}

	export interface LoginResult extends SessionTokens {
		homepage?: string;
	}

	export interface PhoneLoginParams {
		phone: string;
		code: string;
		tenantId?: number | string;
	}

	export interface RegistrationParams extends PhoneLoginParams {
		account: string;
		realName: string;
		codeId?: number | string;
		wayId?: number | string;
	}

	export interface Captcha {
		id: number | string;
		img: string;
		expirySeconds: number;
	}

	export interface TenantOption {
		label: string;
		value: number | string;
		host: string;
	}

	export interface SystemInfo {
		title: string;
		logo: string;
		viceTitle?: string;
		viceDesc?: string;
		copyright?: string;
		icp?: string;
		icpUrl?: string;
		captcha: number | string;
		secondVer: number | string;
		hideTenantForLogin: boolean;
		enableReg: number | string;
		regWayId?: number | string;
		wayList: TenantOption[];
	}
}

export const isEnabled = (value: number | string | undefined) => value === 1 || value === 'Y';

export function loginApi(data: AuthApi.LoginParams) {
	const publicKey = import.meta.env.VITE_SM_PUBLIC_KEY;
	if (!publicKey) throw new Error('未配置登录公钥');
	return requestClient.post<AuthApi.LoginResult>(
		'/api/sysAuth/login',
		{
			...data,
			password: sm2.doEncrypt(data.password, publicKey, 1),
		},
		{ adminAnonymous: true }
	);
}

export function phoneLoginApi(data: AuthApi.PhoneLoginParams) {
	return requestClient.post<AuthApi.LoginResult>('/api/sysAuth/loginPhone', data, { adminAnonymous: true });
}

export function tokenLoginApi(accessToken: string, signal?: AbortSignal) {
	return requestClient.get<AuthApi.LoginResult>('/api/sysAuth/refreshToken', {
		params: { accessToken },
		adminIdentity: { accessToken, refreshToken: '' },
		adminManualTokens: true,
		silentError: true,
		signal,
	});
}

export function registrationApi(data: AuthApi.RegistrationParams) {
	return requestClient.post<void>('/api/sysAuth/userRegistration', data, { adminAnonymous: true });
}

export function logoutApi() {
	return requestClient.post('/api/sysAuth/logout', undefined, { silentError: true });
}

export function unlockScreenApi(password: string, signal?: AbortSignal) {
	const publicKey = import.meta.env.VITE_SM_PUBLIC_KEY;
	if (!publicKey) throw new Error('未配置登录公钥');
	return requestClient.post<boolean>('/api/sysAuth/unLockScreen', undefined, {
		params: { password: sm2.doEncrypt(password, publicKey, 1) },
		silentError: true,
		signal,
	});
}

export function getCaptchaApi() {
	return requestClient.get<AuthApi.Captcha>('/api/sysAuth/captcha', { adminAnonymous: true });
}

export function getSystemInfoApi(tenantId?: number | string) {
	return requestClient.get<AuthApi.SystemInfo>('/api/sysConfig/sysInfo', { adminAnonymous: true, params: { tenantId } });
}

export function getTenantOptionsApi() {
	return requestClient.get<AuthApi.TenantOption[]>('/api/sysTenant/list', { adminAnonymous: true });
}

export function sendSmsApi(phone: string) {
	return requestClient.post(`/api/sysSms/sendSms/${encodeURIComponent(phone)}/0`, undefined, { adminAnonymous: true });
}

export function changeTenantApi(id: number | string, signal?: AbortSignal) {
	return requestClient.post<AuthApi.LoginResult>('/api/sysTenant/changeTenant', { id }, { adminManualTokens: true, signal });
}

export function enterTenantApi(id: number | string, signal?: AbortSignal) {
	return requestClient.post<AuthApi.LoginResult>('/api/sysTenant/goTenant', { id }, { adminManualTokens: true, signal });
}
