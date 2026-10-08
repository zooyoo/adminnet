import { describe, expect, it } from 'vitest';

import { createTenantDraft, isDefaultTenant } from './tenant-form';

describe('tenant editor model', () => {
	it('does not carry a previous unsaved logo into a new or different tenant', () => {
		const first = createTenantDraft({ id: 1, name: 'A', adminAccount: 'a', logo: '/a.png' });
		first.logoBase64 = 'data:image/png;base64,old';
		first.logoFileName = 'old.png';
		const second = createTenantDraft({ id: 2, name: 'B', adminAccount: 'b', logo: '/b.png' });
		expect(second.logo).toBe('/b.png');
		expect(second.logoBase64).toBeUndefined();
		expect(createTenantDraft().logoBase64).toBeUndefined();
	});
	it('protects the configured default tenant without relying on the old hard-coded UI ID', () => {
		expect(isDefaultTenant({ id: 1300000000001 })).toBe(true);
		expect(isDefaultTenant({ id: 8, configId: '1300000000001' })).toBe(true);
		expect(isDefaultTenant({ id: 8, configId: '8' })).toBe(false);
	});
});
