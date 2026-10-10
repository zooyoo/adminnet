import type { RouteRecordStringComponent } from '@vben/types';

import { describe, expect, it } from 'vitest';

import { normalizeOpenAccessMenu, OPEN_ACCESS_ALIAS, OPEN_ACCESS_PATH } from './open-access-route';

const route = (input: Partial<RouteRecordStringComponent>): RouteRecordStringComponent => ({
	name: 'openAccess',
	path: OPEN_ACCESS_PATH,
	component: '/system/openAccess/index',
	meta: { title: '开放接口' },
	...input,
});

describe('normalizeOpenAccessMenu', () => {
	it.each(['/system/openAccess/index', 'system/openAccess/index', '/platform/openAccess/index'])('normalizes component %s and retains all unique aliases', (component) => {
		const original = route({ path: OPEN_ACCESS_ALIAS, component, alias: ['/custom/openAccess', OPEN_ACCESS_PATH, OPEN_ACCESS_ALIAS] });
		expect(normalizeOpenAccessMenu(original)).toEqual({ ...original, path: OPEN_ACCESS_PATH, component: '/system/openAccess/index', alias: [OPEN_ACCESS_ALIAS, '/custom/openAccess'] });
		expect(original.path).toBe(OPEN_ACCESS_ALIAS);
	});

	it('retains a scalar alias and the previous custom path', () => {
		expect(normalizeOpenAccessMenu(route({ path: '/old/openAccess', alias: '/extra/openAccess' })).alias).toEqual(['/old/openAccess', OPEN_ACCESS_ALIAS, '/extra/openAccess']);
	});

	it('is idempotent and preserves metadata and children', () => {
		const original = route({ children: [route({ name: 'child' })] });
		const normalized = normalizeOpenAccessMenu(original);
		expect(normalizeOpenAccessMenu(normalized)).toEqual(normalized);
		expect(normalized.meta).toBe(original.meta);
		expect(normalized.children).toBe(original.children);
	});

	it('leaves unrelated components untouched even when their path is similar', () => {
		const original = route({ component: '/system/user/index' });
		expect(normalizeOpenAccessMenu(original)).toBe(original);
	});
});
