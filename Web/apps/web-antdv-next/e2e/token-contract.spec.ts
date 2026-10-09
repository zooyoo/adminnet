import { expect, test } from '@playwright/test';

import { mockAdminSession, testToken } from './fixtures/admin-session';

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'cache');
	await page.route('**/prod-api/api/sysCache/keyList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
});

test('旧登录地址交换双令牌并恢复业务回跳，刷新后保持身份', async ({ page }) => {
	const token = testToken();
	let exchanges = 0;
	await page.route('**/prod-api/api/sysAuth/refreshToken?*', (route) => {
		exchanges++;
		expect(route.request().headers().authorization).toBe(`Bearer ${token}`);
		expect(new URL(route.request().url()).searchParams.get('accessToken')).toBe(token);
		return route.fulfill({ json: { code: 200, result: { accessToken: testToken(2), refreshToken: 'refresh-two' } } });
	});
	await page.goto(`/#/login?token=${token}&redirect=%2Fsystem%2Fcache&params=${encodeURIComponent('{"from":"legacy"}')}`);
	await expect(page).toHaveURL(/#\/system\/cache\?from=legacy$/);
	await expect(page.getByRole('button', { name: '清空全部缓存', exact: true })).toBeVisible();
	expect(exchanges).toBe(1);
	await page.reload();
	await expect(page.getByRole('button', { name: '清空全部缓存', exact: true })).toBeVisible();
});

test('菜单预检失败不采用候选身份，并从地址栏移除令牌', async ({ page }) => {
	await page.route('**/prod-api/api/sysAuth/refreshToken?*', (route) =>
		route.fulfill({ json: { code: 200, result: { accessToken: testToken(), refreshToken: 'candidate-refresh' } } }));
	await page.route('**/prod-api/api/sysMenu/vbenMenuTree', (route) => route.fulfill({ status: 503, json: { message: '候选菜单不可用' } }));
	await page.goto(`/#/login?token=${testToken()}&redirect=%2Fsystem%2Fcache`);
	await expect(page.locator('#app').getByRole('alert').filter({ hasText: '候选菜单不可用' })).toBeVisible();
	expect(page.url()).not.toContain('token=');
	await page.getByRole('button', { name: '返回账号登录' }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await page.goto('/#/system/cache');
	await expect(page).toHaveURL(/#\/auth\/login/);
});

test('离开令牌页后迟到响应不能重新登录', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	await page.route('**/prod-api/api/sysAuth/refreshToken?*', async (route) => {
		await pending;
		await route.fulfill({ json: { code: 200, result: { accessToken: testToken(), refreshToken: 'late-refresh' } } }).catch(() => {});
	});
	const requested = page.waitForRequest((request) => request.url().includes('/sysAuth/refreshToken?'));
	await page.goto(`/#/login?token=${testToken()}`);
	await requested;
	await page.getByRole('button', { name: '返回账号登录' }).click();
	release();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await page.goto('/#/system/cache');
	await expect(page).toHaveURL(/#\/auth\/login/);
});

test('刷新中间页没有可重用令牌，扫码页明确未开通', async ({ page }) => {
	await page.goto('/#/auth/token');
	await expect(page.getByRole('alert')).toContainText('登录令牌缺失');
	await page.goto('/#/auth/qrcode-login');
	await expect(page.getByRole('alert')).toContainText('当前站点未开通扫码登录');
});

test('连续旧登录链接重新消费令牌并更新错误状态', async ({ page }) => {
	await page.route('**/prod-api/api/sysAuth/refreshToken?*', (route) => route.fulfill({ status: 401, json: { message: '候选令牌已撤销' } }));
	await page.goto(`/#/login?token=${testToken()}`);
	await expect(page.locator('#app').getByRole('alert')).toBeVisible();
	await page.goto('/#/login?token=invalid');
	await expect(page.locator('#app').getByRole('alert')).toContainText('登录令牌无效或已过期');
});
