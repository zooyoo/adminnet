import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'onlineUser', { superAdmin: true });
	await page.route('**/prod-api/api/sysOnlineUser/page', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					total: 2,
					items: [
						{ id: '11', userId: '42', userName: 'same-user', realName: '测试用户', tenantId: '1', connectionId: 'first', ip: '127.0.0.1', browser: 'Edge', os: 'Windows', time: '2026-10-08 12:00:00' },
						{
							id: '12',
							userId: '42',
							userName: 'same-user',
							realName: '测试用户',
							tenantId: '1',
							connectionId: 'second',
							ip: '127.0.0.1',
							browser: 'Edge',
							os: 'Windows',
							time: '2026-10-08 12:01:00',
						},
					],
				},
			},
		})
	);
});

test('online filters preserve paging contracts and reset explicitly', async ({ page }) => {
	await loginAdmin(page, 'onlineUser');
	await expect(page.getByRole('cell', { name: 'same-user', exact: true })).toHaveCount(2);
	await page.getByLabel('在线用户账号').fill('alice');
	await page.getByLabel('在线用户姓名').fill('测试');
	const query = page.waitForRequest((request) => request.url().endsWith('/sysOnlineUser/page'));
	await page.getByRole('button', { name: /查询/ }).click();
	expect((await query).postDataJSON()).toMatchObject({ page: 1, userName: 'alice', realName: '测试' });
	const reset = page.waitForRequest((request) => request.url().endsWith('/sysOnlineUser/page'));
	await page.getByRole('button', { name: '重置在线用户筛选' }).click();
	expect((await reset).postDataJSON()).toMatchObject({ page: 1, userName: '', realName: '' });
});

test('force offline sends only the selected session after confirmation', async ({ page }) => {
	const bodies: unknown[] = [];
	await page.route('**/prod-api/api/sysOnlineUser/forceOffline', async (route) => {
		bodies.push(route.request().postDataJSON());
		await route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'onlineUser');
	const button = page.locator('tr[data-row-key="12"]').getByRole('button', { name: '强制下线 same-user' });
	await button.click();
	await page
		.locator('.ant-modal:visible')
		.getByRole('button', { name: /^取\s*消$/ })
		.click();
	expect(bodies).toHaveLength(0);
	await button.click();
	await page
		.locator('.ant-modal:visible')
		.getByRole('button', { name: /^确\s*定$/ })
		.click();
	await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
	expect(bodies).toEqual([{ id: '12', connectionId: 'second' }]);
});

test('offline failures keep the selected target and allow retry', async ({ page }) => {
	await page.route('**/prod-api/api/sysOnlineUser/forceOffline', (route) => route.fulfill({ status: 500, json: { message: '下线服务暂不可用' } }));
	await loginAdmin(page, 'onlineUser');
	await page.locator('tr[data-row-key="11"]').getByRole('button', { name: '强制下线 same-user' }).click();
	const modal = page.locator('.ant-modal:visible');
	await modal.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByText('下线服务暂不可用', { exact: true })).toBeVisible();
	await expect(modal).toBeVisible();
	await expect(modal.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await expect(page.getByRole('cell', { name: 'same-user', exact: true })).toHaveCount(2);
});

test('users without force permission can inspect but cannot remove sessions', async ({ page }) => {
	await mockAdminSession(page, 'onlineUser', { readOnly: true });
	await loginAdmin(page, 'onlineUser');
	await expect(page.getByRole('cell', { name: 'same-user', exact: true })).toHaveCount(2);
	await expect(page.getByRole('button', { name: /^强制下线 / })).toHaveCount(0);
	await expect(page.getByLabel('在线用户租户')).toHaveCount(0);
});

test('header drawer remains usable on desktop and mobile', async ({ page }, testInfo) => {
	await loginAdmin(page, 'onlineUser');
	await page.getByRole('button', { name: '在线用户', exact: true }).click();
	const drawer = page.getByRole('dialog', { name: '在线用户', exact: true });
	await expect(drawer.getByRole('cell', { name: 'same-user', exact: true })).toHaveCount(2);
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await drawer.locator('tr[data-row-key="12"]').getByRole('button', { name: '强制下线 same-user' }).click();
	await expect(page.locator('.ant-modal:visible')).toBeVisible();
	await page
		.locator('.ant-modal:visible')
		.getByRole('button', { name: /^取\s*消$/ })
		.click();
	await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath('online-drawer.png'), fullPage: true, animations: 'disabled' });
});
