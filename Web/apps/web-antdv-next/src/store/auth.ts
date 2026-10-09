import type { AuthApi } from '#/api/core/auth';

import { ref } from 'vue';
import { useRouter } from 'vue-router';

import { LOGIN_PATH } from '@vben/constants';
import { preferences } from '@vben/preferences';
import { resetAllStores, useAccessStore, useUserStore } from '@vben/stores';

import { notification } from 'antdv-next';
import { defineStore } from 'pinia';

import { changeTenantApi, enterTenantApi, getUserInfoApi, loginApi, logoutApi, phoneLoginApi, tokenLoginApi, unlockScreenApi } from '#/api';
import { getAllMenusApi, prepareSessionMenus } from '#/api/core/menu';
import { onlineSession } from '#/api/realtime';
import { isTokenExpired, sessionBoundary } from '#/api/session';
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
			onlineSession.disconnect();
			sessionBoundary.invalidate();
			resetRoutes();
			resetAllStores();
		}

		async function completeLogin(result: AuthApi.LoginResult, version: number, onSuccess?: () => Promise<void> | void, preparedUser?: Awaited<ReturnType<typeof getUserInfoApi>>) {
			if (version !== sessionBoundary.version) return;
			if (!result.accessToken || !result.refreshToken) throw new Error('登录响应缺少令牌');
			accessStore.setAccessToken(result.accessToken);
			accessStore.setRefreshToken(result.refreshToken);
			homePath.value = safeRedirect(result.homepage, preferences.app.defaultHomePath);
			const userInfo = await fetchUserInfo(preparedUser);
			if (version !== sessionBoundary.version) return;
			accessStore.setLoginExpired(false);
			if (onSuccess) await onSuccess();
			else await router.replace(safeRedirect(router.currentRoute.value.query.redirect, homePath.value));
			notification.success({
				description: `欢迎回来，${userInfo.realName}`,
				title: '登录成功',
				duration: 3,
				placement: preferences.app.isMobile ? 'bottomRight' : 'topRight',
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

		function lockScreen() {
			if (accessStore.accessToken) accessStore.lockScreen();
		}

		async function unlockScreen(password: string, signal: AbortSignal) {
			const version = sessionBoundary.version;
			if (!accessStore.isLockScreen || signal.aborted) return;
			if (!(await unlockScreenApi(password, signal))) throw new Error('密码验证失败，请重试');
			if (version === sessionBoundary.version && !signal.aborted) accessStore.unlockScreen();
		}

		async function authTokenLogin(token: string, redirect: string, signal: AbortSignal) {
			if (!token || isTokenExpired(token)) throw new Error('登录令牌无效或已过期，请重新登录');
			if (loginLoading.value || signal.aborted) throw new Error('登录操作已取消');
			let version = sessionBoundary.version;
			let adopted = false;
			loginLoading.value = true;
			try {
				const result = await tokenLoginApi(token, signal);
				if (version !== sessionBoundary.version || signal.aborted) return;
				if (!result.accessToken || !result.refreshToken) throw new Error('登录响应缺少令牌');
				const [userInfo, menus] = await Promise.all([getUserInfoApi(result, signal), getAllMenusApi(result, signal)]);
				if (version !== sessionBoundary.version || signal.aborted) return;
				clearSession();
				adopted = true;
				version = sessionBoundary.version;
				loginLoading.value = true;
				prepareSessionMenus(menus, version);
				return await completeLogin(result, version, async () => { await router.replace(safeRedirect(redirect)); }, userInfo);
			} catch (error) {
				if (adopted && version === sessionBoundary.version) clearSession();
				throw error;
			} finally {
				if (version === sessionBoundary.version) loginLoading.value = false;
			}
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
			const version = sessionBoundary.version;
			onlineSession.disconnect();
			try {
				if (accessStore.accessToken) await logoutApi();
			} catch {
				// 服务端不可用时仍清理本地登录状态。
			} finally {
				if (version === sessionBoundary.version) await redirectToLogin(redirect);
			}
		}

		async function changeTenant(id: number | string, enterAdmin = false, signal?: AbortSignal) {
			if (loginLoading.value || signal?.aborted) return;
			let version = sessionBoundary.version;
			let adopted = false;
			loginLoading.value = true;
			try {
				const result = await (enterAdmin ? enterTenantApi(id, signal) : changeTenantApi(id, signal));
				if (version !== sessionBoundary.version || signal?.aborted) return;
				if (!result.accessToken || !result.refreshToken) throw new Error('切换响应缺少令牌');
				// 当前页面及连接继续使用原身份，候选身份验证失败时不丢失原会话。
				const [userInfo, menus] = await Promise.all([getUserInfoApi(result, signal), getAllMenusApi(result, signal)]);
				if (version !== sessionBoundary.version || signal?.aborted) return;
				clearSession();
				adopted = true;
				version = sessionBoundary.version;
				loginLoading.value = true;
				prepareSessionMenus(menus, version);
				return await completeLogin(result, version, undefined, userInfo);
			} catch (error) {
				if (adopted && version === sessionBoundary.version) await expireSession();
				throw error;
			} finally {
				if (version === sessionBoundary.version) loginLoading.value = false;
			}
		}

		async function fetchUserInfo(preparedUser?: Awaited<ReturnType<typeof getUserInfoApi>>) {
			const version = sessionBoundary.version;
			const userInfo = preparedUser ?? (await getUserInfoApi());
			if (version === sessionBoundary.version) {
				userInfo.homePath = homePath.value || preferences.app.defaultHomePath;
				userStore.setUserInfo(userInfo);
				accessStore.setAccessCodes(userInfo.buttons);
				onlineSession.connect({
					version,
					token: async () => {
						if (accessStore.accessToken && isTokenExpired(accessStore.accessToken)) await getUserInfoApi();
						return accessStore.accessToken ?? '';
					},
					isCurrent: () => version === sessionBoundary.version,
					forcedOffline: async () => {
						await logout(false);
						if (!accessStore.accessToken) notification.warning({ title: '已被强制下线', description: '请重新登录后继续操作', placement: preferences.app.isMobile ? 'bottomRight' : 'topRight' });
					},
				});
			}
			return userInfo;
		}

		function $reset() {
			loginLoading.value = false;
			homePath.value = '';
		}

		return { $reset, authLogin, authPhoneLogin, authTokenLogin, changeTenant, expireSession, fetchUserInfo, homePath, lockScreen, loginLoading, logout, unlockScreen };
	},
	{ persist: { pick: ['homePath'] } }
);
