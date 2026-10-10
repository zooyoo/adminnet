import type { RouteRecordStringComponent } from '@vben/types';

import type { SessionTokens } from '#/api/session';

import { requestClient } from '#/api/request';
import { sessionBoundary } from '#/api/session';
import { normalizeStressTestMenu } from '#/router/stress-test-route';
import { normalizeMenuIcon } from '#/utils/admin-tree';

/**
 * 获取用户所有菜单
 */
let prepared: undefined | { menus: RouteRecordStringComponent[]; version: number };

export function prepareSessionMenus(menus: RouteRecordStringComponent[], version: number) {
	prepared = { menus, version };
}

export async function getAllMenusApi(identity?: SessionTokens, signal?: AbortSignal) {
	if (!identity && prepared) {
		const candidate = prepared;
		prepared = undefined;
		if (candidate.version === sessionBoundary.version) return candidate.menus;
	}
	const menus = await requestClient.get<RouteRecordStringComponent[]>('/api/sysMenu/vbenMenuTree', { adminIdentity: identity, signal });
	function normalize(routes: RouteRecordStringComponent[]): RouteRecordStringComponent[] {
		return routes.map((route) => ({
			...normalizeStressTestMenu(route),
			meta: { ...route.meta, title: route.meta?.title ?? String(route.name ?? ''), icon: typeof route.meta?.icon === 'string' ? normalizeMenuIcon(route.meta.icon) : route.meta?.icon },
			children: route.children?.length ? normalize(route.children) : undefined,
		}));
	}
	return normalize(menus);
}
