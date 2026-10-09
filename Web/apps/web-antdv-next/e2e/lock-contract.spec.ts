import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'cache');
	await page.route('**/prod-api/api/sysCache/keyList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await page.route('**/prod-api/api/sysAuth/logout', (route) => route.fulfill({ json: { code: 200, result: null } }));
});

test('锁屏使用加密账号密码，错误可重试，成功恢复页面', async ({ page }) => {
	let requests = 0;
	await page.route('**/prod-api/api/sysAuth/unLockScreen?*', (route) => {
		const password = new URL(route.request().url()).searchParams.get('password');
		expect(password).toMatch(/^[\da-f]{192,}$/i);
		requests++;
		return route.fulfill({ json: requests === 1 ? { code: 400, message: '账号密码错误' } : { code: 200, result: true } });
	});
	await loginAdmin(page, 'cache');
	await page.getByRole('button', { name: '锁定屏幕', exact: true }).click();
	const lock = page.getByRole('dialog', { name: '屏幕已锁定', exact: true });
	await expect(lock).toBeVisible();
	await expect(page.getByRole('button', { name: '清空全部缓存', exact: true })).toBeHidden();
	await lock.getByRole('button', { name: /^解\s*锁$/ }).click();
	await expect(lock.getByRole('alert')).toContainText('请输入账号密码');
	expect(requests).toBe(0);
	await lock.getByLabel('账号密码', { exact: true }).fill('fixture-unlock-secret');
	await lock.getByRole('button', { name: /^解\s*锁$/ }).click();
	await expect(lock.getByRole('alert')).toContainText('账号密码错误');
	await expect(lock.getByLabel('账号密码', { exact: true })).toHaveValue('');
	await lock.getByLabel('账号密码', { exact: true }).fill('fixture-unlock-secret');
	await lock.getByRole('button', { name: /^解\s*锁$/ }).click();
	await expect(lock).toBeHidden();
	await expect(page.getByRole('button', { name: '清空全部缓存', exact: true })).toBeVisible();
	expect(await page.evaluate(() => JSON.stringify(localStorage).includes('fixture-unlock-secret'))).toBe(false);
});

test('刷新和 Escape 保持锁定，服务失败不解锁', async ({ page }) => {
	await page.route('**/prod-api/api/sysAuth/unLockScreen?*', (route) => route.fulfill({ status: 503, json: { message: '解锁服务不可用' } }));
	await loginAdmin(page, 'cache');
	await page.keyboard.press('Alt+l');
	await expect(page.getByRole('dialog', { name: '屏幕已锁定' })).toBeVisible();
	await page.reload();
	const lock = page.getByRole('dialog', { name: '屏幕已锁定' });
	await expect(lock).toBeVisible();
	await page.keyboard.press('Escape');
	await expect(lock).toBeVisible();
	await lock.getByLabel('账号密码', { exact: true }).fill('fixture-password');
	await lock.getByRole('button', { name: /^解\s*锁$/ }).click();
	await expect(lock.getByRole('alert')).toContainText('503');
	await expect(page.getByRole('button', { name: '清空全部缓存', exact: true })).toBeHidden();
});

test('退出取消迟到解锁响应并清理锁定身份', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	await page.route('**/prod-api/api/sysAuth/unLockScreen?*', async (route) => {
		await pending;
		await route.fulfill({ json: { code: 200, result: true } }).catch(() => {});
	});
	await loginAdmin(page, 'cache');
	await page.getByRole('button', { name: '锁定屏幕', exact: true }).click();
	const lock = page.getByRole('dialog', { name: '屏幕已锁定' });
	await lock.getByLabel('账号密码', { exact: true }).fill('fixture-password');
	await Promise.all([
		page.waitForRequest((request) => request.url().includes('/sysAuth/unLockScreen?')),
		lock.getByRole('button', { name: /^解\s*锁$/ }).click(),
	]);
	await lock.getByRole('button', { name: '退出登录', exact: true }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	release();
	await page.goto('/#/system/cache');
	await expect(page).toHaveURL(/#\/auth\/login/);
	await expect(lock).toHaveCount(0);
});

test('认证失效不能通过解锁恢复旧身份', async ({ page }) => {
	await page.route('**/prod-api/api/sysAuth/unLockScreen?*', (route) => route.fulfill({ status: 401, json: { message: '登录已失效' } }));
	await loginAdmin(page, 'cache');
	await page.getByRole('button', { name: '锁定屏幕', exact: true }).click();
	const lock = page.getByRole('dialog', { name: '屏幕已锁定' });
	await lock.getByLabel('账号密码', { exact: true }).fill('fixture-password');
	await lock.getByRole('button', { name: /^解\s*锁$/ }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await expect(lock).toHaveCount(0);
});
