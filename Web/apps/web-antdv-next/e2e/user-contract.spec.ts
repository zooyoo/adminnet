import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const employee = {
	id: 11,
	account: 'worker',
	realName: '员工甲',
	phone: '13800000000',
	tenantId: 1,
	orgId: 100,
	orgName: '研发部',
	posId: 20,
	posName: '工程师',
	accountType: 777,
	status: 1,
	langCode: 'zh-CN',
	roleName: '员工角色',
	birthday: '2000-02-03T00:00:00',
	joinDate: '2020-05-06T00:00:00',
	remark: '保留备注',
};

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/**', (route) => route.fulfill({ status: 503, json: { message: 'Contract fixture: undeclared request' } }));
	await mockAdminSession(page, 'user');
	await page.route('**/prod-api/api/sysUser/page', (route) => route.fulfill({ json: { code: 200, result: { items: [employee], total: 1 } } }));
	await page.route('**/prod-api/api/sysOrg/tree**', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ id: 100, name: '研发部', tenantId: 1 },
					{ id: 200, name: '其他租户部门', tenantId: 2 },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysPos/list**', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ id: 20, name: '工程师', tenantId: 1 },
					{ id: 30, name: '其他租户职位', tenantId: 2 },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysRole/list', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ id: 40, name: '员工角色', tenantId: 1 },
					{ id: 50, name: '未授予角色', tenantId: 1 },
					{ id: 60, name: '其他租户角色', tenantId: 2 },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysLang/dropdownData', (route) => route.fulfill({ json: { code: 200, result: [{ code: 'zh-CN', value: 'zh-CN', label: '中文' }] } }));
	await page.route('**/prod-api/api/sysUser/ownRoleList/**', (route) => route.fulfill({ json: { code: 200, result: [40] } }));
	await page.route('**/prod-api/api/sysUser/ownExtOrgList/**', (route) => route.fulfill({ json: { code: 200, result: [{ id: 90, userId: 11, orgId: 100, posId: 20 }] } }));
});

test('user edit preserves profile, roles, date values and extended assignments', async ({ page }, testInfo) => {
	await loginAdmin(page, 'user');
	await page.route('**/prod-api/api/sysUser/update', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑账号', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('账号名称', { exact: true })).toBeDisabled();
	await expect(dialog.getByLabel('附属职位 1', { exact: true })).toBeVisible();
	await dialog.getByLabel('真实姓名', { exact: true }).fill('更新姓名');
	await dialog.getByRole('tab', { name: '角色授权' }).click();
	await expect(dialog.getByText('员工角色', { exact: true })).toBeVisible();
	await expect(dialog.getByText('其他租户角色', { exact: true })).toHaveCount(0);
	await dialog.getByRole('tab', { name: '档案信息' }).click();
	await expect(dialog.getByLabel('备注', { exact: true })).toHaveValue('保留备注');
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUser/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(new URL(saved.url()).pathname).toBe('/prod-api/api/sysUser/update');
	expect(saved.postDataJSON()).toMatchObject({
		id: 11,
		account: 'worker',
		realName: '更新姓名',
		roleIdList: [40],
		extOrgIdList: [{ orgId: 100, posId: 20 }],
		birthday: '2000-02-03T00:00:00.000Z',
		joinDate: '2020-05-06T00:00:00.000Z',
	});
	await expect(dialog).toBeHidden();
	await page.locator('.ant-table-content, .ant-table-body').evaluateAll((elements) =>
		elements.forEach((element) => {
			element.scrollLeft = 0;
		})
	);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('user.png'), fullPage: true });
});

test('copying an account clears identity and loads the source assignments', async ({ page }) => {
	await loginAdmin(page, 'user');
	await page.getByRole('button', { name: '更多账号操作' }).click();
	await page.getByRole('menuitem', { name: '复制账号' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('账号名称', { exact: true })).toHaveValue('');
	await expect(dialog.getByLabel('账号名称', { exact: true })).toBeEnabled();
	await expect(dialog.getByLabel('附属机构 1', { exact: true })).toBeVisible();
	await dialog.getByLabel('账号类型', { exact: true }).click();
	await expect(page.getByRole('option', { name: '系统管理员', exact: true })).toHaveCount(0);
	await expect(page.getByRole('option', { name: '超级管理员', exact: true })).toHaveCount(0);
});

test('incomplete extended assignments block saving and authorization loading errors block all saves', async ({ page }) => {
	await loginAdmin(page, 'user');
	await page.getByRole('button', { name: '编辑账号', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('附属机构 1', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: '增加附属机构' }).click();
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByRole('alert')).toContainText('补全附属机构');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.route('**/prod-api/api/sysUser/ownRoleList/**', (route) => route.fulfill({ status: 500, json: { message: '角色读取失败' } }));
	await page.getByRole('button', { name: '编辑账号', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('角色读取失败');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeDisabled();
});

test('reset password and unlock require confirmation and send the selected user ID', async ({ page }) => {
	await loginAdmin(page, 'user');
	await page.route('**/prod-api/api/sysUser/resetPwd', (route) => route.fulfill({ json: { code: 200, result: 'temporary-test-password' } }));
	await page.route('**/prod-api/api/sysUser/unlockLogin', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '更多账号操作' }).click();
	await page.getByRole('menuitem', { name: '重置密码' }).click();
	const [reset] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/resetPwd')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(reset.postDataJSON()).toEqual({ id: 11 });
	await expect(page.getByLabel('重置后的密码')).toHaveValue('temporary-test-password');
	await page.getByRole('dialog', { name: '密码重置成功' }).getByRole('button', { name: '关闭' }).click();
	await page.getByRole('button', { name: '更多账号操作' }).click();
	await page.getByRole('menuitem', { name: '解除登录锁定' }).click();
	const [unlock] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/unlockLogin')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(unlock.postDataJSON()).toEqual({ id: 11 });
});

test('read-only user cannot access mutations or reset-password actions', async ({ page }) => {
	await mockAdminSession(page, 'user', { readOnly: true });
	await loginAdmin(page, 'user');
	await expect(page.getByRole('cell', { name: 'worker', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /新增账号|编辑账号|删除账号|更多账号操作/ })).toHaveCount(0);
	await expect(page.getByRole('switch')).toHaveCount(0);
});

test('user roles can be changed and all extended assignments can be removed', async ({ page }, testInfo) => {
	await loginAdmin(page, 'user');
	await page.route('**/prod-api/api/sysUser/update', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑账号', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('附属机构 1', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: '删除附属机构 1', exact: true }).click();
	await dialog.getByRole('tab', { name: '角色授权' }).click();
	await dialog.getByRole('listitem', { name: '员工角色', exact: true }).click();
	await dialog.getByRole('button', { name: /撤销/ }).click();
	await dialog.getByRole('listitem', { name: '未授予角色', exact: true }).click();
	await dialog.getByRole('button', { name: /授权/ }).click();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('user-roles.png'), fullPage: true });
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUser/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ id: 11, roleIdList: [50], extOrgIdList: [] });
});

test('user status failure keeps the server-confirmed state without unhandled errors', async ({ page }) => {
	await loginAdmin(page, 'user');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/prod-api/api/sysUser/setStatus', (route) => route.fulfill({ json: { code: 400, message: '状态更新失败' } }));
	const toggle = page.getByRole('switch', { name: '切换worker状态' });
	await toggle.click();
	await expect(page.getByText('状态更新失败', { exact: true }).first()).toBeVisible();
	await expect(toggle).toBeChecked();
	expect(errors).toEqual([]);
});

test('copy creation and deletion use different endpoints and do not retain the original identity', async ({ page }) => {
	await loginAdmin(page, 'user');
	await page.route('**/prod-api/api/sysUser/add', (route) => route.fulfill({ json: { code: 200, result: 99 } }));
	await page.route('**/prod-api/api/sysUser/delete', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '更多账号操作' }).click();
	await page.getByRole('menuitem', { name: '复制账号' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('附属职位 1', { exact: true })).toBeVisible();
	await dialog.getByLabel('账号名称', { exact: true }).fill('new-worker');
	const [added] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUser/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(added.postDataJSON()).toMatchObject({ account: 'new-worker', roleIdList: [40] });
	expect(added.postDataJSON()).not.toHaveProperty('id');
	expect(added.postDataJSON().extOrgIdList[0]).not.toHaveProperty('userId');
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '删除账号', exact: true }).click();
	const [removed] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUser/delete')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(removed.postDataJSON()).toEqual({ id: 11 });
});

test('opening accounts in different tenants does not reuse filtered role or position options', async ({ page }) => {
	const other = { ...employee, id: 12, tenantId: 2, account: 'other', realName: '其他用户', orgId: 200, posId: 30 };
	await mockAdminSession(page, 'user', { superAdmin: true });
	await page.route('**/prod-api/api/sysUser/page', (route) => route.fulfill({ json: { code: 200, result: { items: [employee, other], total: 2 } } }));
	await loginAdmin(page, 'user');
	await page.locator('tr[data-row-key="11"]').getByRole('button', { name: '编辑账号', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('职位', { exact: true })).toBeVisible();
	await dialog.getByRole('tab', { name: '角色授权' }).click();
	await expect(dialog.getByText('其他租户角色', { exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(dialog).toBeHidden();
	await page.locator('tr[data-row-key="12"]').getByRole('button', { name: '编辑账号', exact: true }).click();
	await dialog.getByRole('tab', { name: '角色授权' }).click();
	await expect(dialog.getByText('其他租户角色', { exact: true })).toBeVisible();
	await expect(dialog.getByText('未授予角色', { exact: true })).toHaveCount(0);
});

test('pending save keeps the account editor open until the server confirms the result', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/prod-api/api/sysUser/update', async (route) => {
		await pending;
		await route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'user');
	await page.getByRole('button', { name: '编辑账号', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑账号', exact: true });
	await expect(dialog.getByLabel('附属机构 1', { exact: true })).toBeVisible();
	try {
		await Promise.all([
			page.waitForRequest((request) => request.url().endsWith('/sysUser/update')),
			dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
		]);
		await expect(dialog.getByRole('button', { name: /^取\s*消$/ })).toBeDisabled();
		await page.keyboard.press('Escape');
		await expect(dialog).toBeVisible();
	} finally {
		release();
	}
	await expect(dialog).toBeHidden();
});
