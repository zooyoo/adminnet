import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const row = { id: 1, tenantId: 1, name: '默认注册方案', roleId: 10, roleName: '普通员工', orgId: 20, orgName: '研发部', posId: 30, posName: '工程师', accountType: 777, orderNo: 100 };
test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'userRegWay');
	await page.route('**/prod-api/api/sysUserRegWay/list', (route) => route.fulfill({ json: { code: 200, result: [row] } }));
	await page.route('**/prod-api/api/sysOrg/tree**', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ id: 20, name: '研发部', tenantId: 1 },
					{ id: 200, name: '其他机构', tenantId: 2 },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysRole/list', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ id: 10, name: '普通员工', tenantId: 1 },
					{ id: 100, name: '其他角色', tenantId: 2 },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysPos/list**', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ id: 30, name: '工程师', tenantId: 1 },
					{ id: 300, name: '其他职位', tenantId: 2 },
				],
			},
		})
	);
	for (const endpoint of ['add', 'update', 'delete']) await page.route(`**/prod-api/api/sysUserRegWay/${endpoint}`, (route) => route.fulfill({ json: { code: 200 } }));
});

test('registration edit loads tenant-specific choices and excludes administrator account types', async ({ page }, testInfo) => {
	await loginAdmin(page, 'userRegWay');
	await page.getByRole('button', { name: '编辑注册方案', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await dialog.getByLabel('账户类型', { exact: true }).click();
	await expect(page.getByRole('option', { name: '超级管理员', exact: true })).toHaveCount(0);
	await expect(page.getByRole('option', { name: '系统管理员', exact: true })).toHaveCount(0);
	await dialog.getByLabel('方案名称', { exact: true }).click();
	await dialog.getByLabel('绑定角色', { exact: true }).click();
	await expect(page.getByRole('option', { name: '普通员工', exact: true })).toBeVisible();
	await expect(page.getByRole('option', { name: '其他角色', exact: true })).toHaveCount(0);
	await dialog.getByLabel('方案名称', { exact: true }).fill('修改方案');
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUserRegWay/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ id: 1, tenantId: 1, name: '修改方案', roleId: 10, orgId: 20, posId: 30, accountType: 777 });
	await expect(dialog).toBeHidden();
	await page.screenshot({ path: testInfo.outputPath('registration.png'), fullPage: true });
});

test('registration creation requires role, organization and position and deletion uses ID', async ({ page }) => {
	await loginAdmin(page, 'userRegWay');
	await page.getByRole('button', { name: '新增注册方案', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await dialog.getByLabel('方案名称', { exact: true }).fill('新方案');
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByText('请选择角色', { exact: true })).toBeVisible();
	await dialog.getByLabel('绑定角色', { exact: true }).click();
	await page.getByRole('option', { name: '普通员工', exact: true }).click();
	await dialog.getByLabel('绑定机构', { exact: true }).click();
	await page.locator('.ant-select-dropdown').getByText('研发部', { exact: true }).click();
	await dialog.getByLabel('绑定职位', { exact: true }).click();
	await page.getByRole('option', { name: '工程师', exact: true }).click();
	const [added] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUserRegWay/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(added.postDataJSON()).toMatchObject({ name: '新方案', roleId: 10, orgId: 20, posId: 30, accountType: 777 });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '删除注册方案', exact: true }).click();
	const [deleted] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysUserRegWay/delete')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(deleted.postDataJSON()).toEqual({ id: 1 });
});

test('read-only registration page cannot create, edit or delete schemes', async ({ page }) => {
	await mockAdminSession(page, 'userRegWay', { readOnly: true });
	await loginAdmin(page, 'userRegWay');
	await expect(page.getByRole('cell', { name: '默认注册方案', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /新增注册方案|编辑注册方案|删除注册方案/ })).toHaveCount(0);
});
