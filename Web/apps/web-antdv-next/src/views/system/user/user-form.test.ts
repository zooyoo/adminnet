import { describe, expect, it } from 'vitest';

import { createUserDraft, validateAssignments } from './user-form';

describe('user editor model', () => {
	it('copies profile values without reusing identity, credentials or audit data', () => {
		const user = {
			id: 12,
			account: 'existing',
			realName: '员工',
			tenantId: 2,
			orgId: 20,
			posId: 4,
			birthday: new Date('2000-02-03T00:00:00'),
			lastLoginIp: '127.0.0.1',
			password: 'not-a-real-secret',
		};
		const draft = createUserDraft(user, true);
		expect(draft).toMatchObject({ id: undefined, account: '', realName: '员工', tenantId: 2, orgId: 20, posId: 4, birthday: '2000-02-03', roleIdList: [], extOrgIdList: [] });
		expect(draft).not.toHaveProperty('password');
		expect(draft).not.toHaveProperty('lastLoginIp');
		expect(user.id).toBe(12);
	});
	it('creates an ordinary account in the selected tenant and organization', () => {
		expect(createUserDraft(undefined, false, 2, 20)).toMatchObject({ accountType: 777, tenantId: 2, orgId: 20, orderNo: 100 });
	});
	it('validates complete and non-duplicated extended assignments', () => {
		const draft = createUserDraft();
		draft.extOrgIdList = [{ orgId: 1 }];
		expect(validateAssignments(draft)).toContain('补全');
		draft.extOrgIdList = [
			{ orgId: 1, posId: 2 },
			{ orgId: 1, posId: 2 },
		];
		expect(validateAssignments(draft)).toContain('重复');
		draft.extOrgIdList = [
			{ orgId: 1, posId: 2 },
			{ orgId: 1, posId: 3 },
		];
		expect(validateAssignments(draft)).toBe('');
	});
});
