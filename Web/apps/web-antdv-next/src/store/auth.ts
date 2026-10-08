import type { AuthApi } from '#/api/core/auth';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'antdv-next';
import { defineStore } from 'pinia';

import { changeTenantApi, enterTenantApi, getUserInfoApi, loginApi, logoutApi, phoneLoginApi } from '#/api';
import { sessionBoundary } from '#/api/session';
import { resetRoutes } from '#/router';
import { safeRedirect } from '#/router/redirect';

export const useAuthStore = defineStore(
	'auth',
	() => {
		const accessStore = useAccessStore();
		const userStore = useUserStore();
		const router = useRouter();
		const loginLoading = ref(false);
		const homePath = ref('');
		let expiryTask: Promise<void> | undefined;

		function clearSession() {
			sessionBoundary.invalidate();
			resetRoutes();
			resetAllStores();
		}

		async function completeLogin(result: AuthApi.LoginResult, version: number, onSuccess?: () => Promise<void> | void) {
			if (version !== sessionBoundary.version) return;
			if (!result.accessToken || !result.refreshToken) throw new Error('登录响应缺少令牌');
			accessStore.setAccessToken(result.accessToken);
			accessStore.setRefreshToken(result.refreshToken);
			homePath.value = safeRedirect(result.homepage, preferences.app.defaultHomePath);
			const userInfo = await fetchUserInfo();
			if (version !== sessionBoundary.version) return;
			accessStore.setLoginExpired(false);
			if (onSuccess) await onSuccess();
			else await router.replace(safeRedirect(router.currentRoute.value.query.redirect, homePath.value));
			notification.success({
				description: `欢迎回来，${userInfo.realName}`,
				title: '登录成功',
				duration: 3,
			});
			return { userInfo };
		}

		async function authenticate(login: () => Promise<AuthApi.LoginResult>, onSuccess?: () => Promise<void> | void) {
			if (loginLoading.value) return;
			clearSession();
			const version = sessionBoundary.version;
			loginLoading.value = true;
			try {
				return await completeLogin(await login(), version, onSuccess);
			} catch (error) {
				if (version === sessionBoundary.version) clearSession();
				throw error;
			} finally {
				if (version === sessionBoundary.version) loginLoading.value = false;
			}
		}

		function authLogin(params: AuthApi.LoginParams, onSuccess?: () => Promise<void> | void) {
			return authenticate(() => loginApi(params), onSuccess);
		}

		function authPhoneLogin(params: AuthApi.PhoneLoginParams) {
			return authenticate(() => phoneLoginApi(params));
		}

		async function redirectToLogin(redirect: boolean) {
			const path = safeRedirect(router.currentRoute.value.fullPath, '');
			clearSession();
			await router.replace({
				path: LOGIN_PATH,
				query: redirect && path ? { redirect: encodeURIComponent(path) } : {},
			});
		}

		function expireSession() {
			if (!expiryTask) {
				expiryTask = redirectToLogin(true)
					.then(() => {
						notification.warning({
							title: '登录已失效',
							description: '请重新登录后继续操作',
							duration: 4.5,
						});
					})
					.finally(() => {
						expiryTask = undefined;
					});
			}
			return expiryTask;
		}

		async function logout(redirect = true) {
			try {
				if (accessStore.accessToken) await logoutApi();
			} catch {
				// 服务端不可用时仍清理本地登录状态。
			} finally {
				await redirectToLogin(redirect);
			}
		}

		async function changeTenant(id: number | string, enterAdmin = false) {
			if (loginLoading.value) return;
			let version = sessionBoundary.version;
			let adopted = false;
			loginLoading.value = true;
			try {
				const result = await (enterAdmin ? enterTenantApi(id) : changeTenantApi(id));
				if (version !== sessionBoundary.version) return;
				clearSession();
				adopted = true;
				version = sessionBoundary.version;
				loginLoading.value = true;
				return await completeLogin(result, version);
			} catch (error) {
				if (adopted && version === sessionBoundary.version) await expireSession();
				throw error;
			} finally {
				if (version === sessionBoundary.version) loginLoading.value = false;
			}
		}

		async function fetchUserInfo() {
			const version = sessionBoundary.version;
			const userInfo = await getUserInfoApi();
			if (version === sessionBoundary.version) {
				userInfo.homePath = homePath.value || preferences.app.defaultHomePath;
				userStore.setUserInfo(userInfo);
				accessStore.setAccessCodes(userInfo.buttons);
			}
			return userInfo;
		}

		function $reset() {
			loginLoading.value = false;
			homePath.value = '';
		}

		return { $reset, authLogin, authPhoneLogin, changeTenant, expireSession, fetchUserInfo, homePath, loginLoading, logout };
	},
	{ persist: { pick: ['homePath'] } }
);
