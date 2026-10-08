import { describe, expect, it } from 'vitest';

import { safeRedirect } from './redirect';

describe('safeRedirect', () => {
	it.each(['https://example.test', '//example.test', '/\\example.test', '/auth/login?redirect=x', '/login', '%broken', '/test%0Aevil'])('rejects unsafe or recursive redirect %s', (path) => {
		expect(safeRedirect(path)).toBe('/home');
	});

	it('preserves local paths, query parameters and hashes', () => {
		expect(safeRedirect('%2Fsystem%2Fuser%3Fpage%3D2%23details')).toBe('/system/user?page=2#details');
	});
});
