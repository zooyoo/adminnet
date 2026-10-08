import type { RouteRecordStringComponent } from '@vben/types';

import { requestClient } from '#/api/request';
import { normalizeMenuIcon } from '#/utils/admin-tree';

/**
 * 获取用户所有菜单
 */
export async function getAllMenusApi() {
	const menus = await requestClient.get<RouteRecordStringComponent[]>('/api/sysMenu/vbenMenuTree');
	function normalize(routes: RouteRecordStringComponent[]): RouteRecordStringComponent[] {
		return routes.map((route) => ({
			...route,
			meta: { ...route.meta, title: route.meta?.title ?? String(route.name ?? ''), icon: typeof route.meta?.icon === 'string' ? normalizeMenuIcon(route.meta.icon) : route.meta?.icon },
			children: route.children?.length ? normalize(route.children) : undefined,
		}));
	}
	return normalize(menus);
}
