import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const record = { id: 12, tenantId: 1, host: 'directory.test', port: 389, baseDn: 'dc=test', bindDn: 'cn=admin,dc=test', version: 3,
	authFilter: '(uid=%s)', bindAttrAccount: 'uid', bindAttrEmployeeId: 'employeeNumber', bindAttrCode: 'ou', status: 1 };
test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/**', (route) => route.fulfill({ status: 503, json: { message: 'Undeclared contract endpoint' } }));
	await mockAdminSession(page, 'ldap');
	await page.route('**/prod-api/api/sysLdap/page', (route) => route.fulfill({ json: { code: 200, result: { items: [record], total: 1 } } }));
	await page.route('**/prod-api/api/sysLdap/detail*', (route) => route.fulfill({ json: { code: 200, result: record } }));
});

test('LDAP edit keeps password empty and sends the retained configuration', async ({ page }) => {
	await page.route('**/prod-api/api/sysLdap/update', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'ldap');
	await page.getByRole('button', { name: '编辑域配置', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑域配置', exact: true });
	await expect(dialog.getByLabel('主机', { exact: true })).toHaveValue('directory.test');
	await expect(dialog.getByLabel('绑定密码', { exact: true })).toHaveValue('');
	await dialog.getByLabel('主机', { exact: true }).fill('updated.test');
	const [request] = await Promise.all([page.waitForRequest((item) => item.url().endsWith('/sysLdap/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(request.postDataJSON()).toMatchObject({ id: 12, tenantId: 1, bindPass: '', host: 'updated.test', bindAttrEmployeeId: 'employeeNumber' });
	await expect(dialog).toBeHidden();
});

test('LDAP detail failure blocks saving an empty form', async ({ page }) => {
	await page.route('**/prod-api/api/sysLdap/detail*', (route) => route.fulfill({ status: 503, json: { message: '域配置不可用' } }));
	await loginAdmin(page, 'ldap');
	await page.getByRole('button', { name: '编辑域配置', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('alert')).toContainText('域配置不可用');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeDisabled();
});

test('LDAP organization sync uses the existing syncDept endpoint after confirmation', async ({ page }) => {
	await page.route('**/prod-api/api/sysLdap/syncDept', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'ldap');
	await page.getByRole('button', { name: '同步域组织', exact: true }).click();
	const [request] = await Promise.all([page.waitForRequest((item) => item.url().endsWith('/sysLdap/syncDept')), page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(request.postDataJSON()).toEqual({ id: 12 });
	await expect(page.getByText('同步域组织成功', { exact: true })).toBeVisible();
});

test('read-only LDAP page hides all mutations', async ({ page }) => {
	await mockAdminSession(page, 'ldap', { readOnly: true });
	await loginAdmin(page, 'ldap');
	await expect(page.getByRole('cell', { name: 'directory.test', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /新增域配置|编辑域配置|同步域账户|同步域组织|^删\s*除$/ })).toHaveCount(0);
});
