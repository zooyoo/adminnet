import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/**', (route) => route.fulfill({ status: 503, json: { message: 'Undeclared contract endpoint' } }));
	await page.route('**/prod-api/api/sysConfig/sysInfo*', (route) => route.fulfill({
		json: { code: 200, result: { title: '测试站点', hideTenantForLogin: true, captcha: 2, secondVer: 2, enableReg: 1, regWayId: 7, wayList: [{ label: '默认方案', value: 7 }] } },
	}));
	await page.route('**/prod-api/api/sysAuth/captcha', (route) => route.fulfill({
		json: { code: 200, result: { id: 42, expirySeconds: 60, img: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=' } },
	}));
});

test('SMS pending request locks phone input and rejects duplicate sends', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	let sent = 0;
	await page.route('**/prod-api/api/sysSms/sendSms/**', async (route) => {
		sent++;
		await pending;
		await route.fulfill({ json: { code: 200 } });
	});
	await page.goto('/#/auth/code-login');
	await page.getByLabel('手机号码', { exact: true }).fill('13900000001');
	await page.getByRole('button', { name: '获取验证码', exact: true }).click();
	await expect(page.getByLabel('手机号码', { exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: /^登\s*录$/ })).toBeDisabled();
	expect(sent).toBe(1);
	release();
	await expect(page.getByRole('button', { name: /\d+ 秒/ })).toBeDisabled();
	await expect(page.getByLabel('手机号码', { exact: true })).toBeEnabled();
});

test('SMS failure keeps input and allows another request without a false countdown', async ({ page }) => {
	await page.route('**/prod-api/api/sysSms/sendSms/**', (route) => route.fulfill({ json: { code: 400, message: '隔离网关不可用' } }));
	await page.goto('/#/auth/code-login');
	await page.getByLabel('手机号码', { exact: true }).fill('13900000001');
	await page.getByRole('button', { name: '获取验证码', exact: true }).click();
	await expect(page.locator('.account-form').getByRole('alert')).toContainText('隔离网关不可用');
	await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue('13900000001');
	await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled();
});

test('registration pending request blocks repeat submission and late success cannot navigate a new page', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	let registered = 0;
	await page.route('**/prod-api/api/sysAuth/userRegistration', async (route) => {
		registered++;
		expect(route.request().postDataJSON()).toMatchObject({ wayId: 7, codeId: 42, account: 'isolated-account' });
		await pending;
		await route.fulfill({ json: { code: 200 } });
	});
	await page.goto('/#/auth/register');
	await page.getByLabel('账号', { exact: true }).fill('isolated-account');
	await page.getByLabel('姓名', { exact: true }).fill('测试注册');
	await page.getByLabel('手机号码', { exact: true }).fill('13900000001');
	await page.getByLabel('验证码', { exact: true }).fill('1234');
	await page.getByRole('button', { name: /^注\s*册$/ }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeDisabled();
	expect(registered).toBe(1);
	await page.getByRole('button', { name: '返回账号登录', exact: true }).click();
	await expect(page.getByRole('heading', { name: '登录 测试站点', exact: true })).toBeVisible();
	release();
	await expect(page).toHaveURL(/#\/auth\/login/);
	await expect(page.getByText('注册成功，请使用默认密码或手机验证码登录', { exact: true })).toHaveCount(0);
});
