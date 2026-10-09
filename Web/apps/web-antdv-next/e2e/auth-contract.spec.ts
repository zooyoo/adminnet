import { expect, test } from '@playwright/test';

// 仅验证浏览器与 API 的契约，不替代真实后端、多角色和多租户联调。
test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/sysConfig/sysInfo*', (route) =>
		route.fulfill({
			json: { code: 200, result: { title: 'Admin.NET', captcha: 1, secondVer: 2, hideTenantForLogin: false, enableReg: 1, wayList: [] } },
		})
	);
	await page.route('**/prod-api/api/sysTenant/list', (route) =>
		route.fulfill({
			json: { code: 200, result: [{ label: '测试租户', value: 1, host: '127.0.0.1' }] },
		})
	);
	await page.route('**/prod-api/api/sysAuth/captcha', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					id: 12,
					expirySeconds: 60,
					img: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=',
				},
			},
		})
	);
});

test('encrypts the password, sends tenant and captcha, then handles rejection', async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/prod-api/api/sysAuth/login', (route) =>
		route.fulfill({
			json: { code: 400, message: '验证码错误', result: null },
		})
	);
	await page.goto('/#/login', { waitUntil: 'networkidle' });
	await expect(page).toHaveURL(/#\/auth\/login$/);
	await page.getByLabel('账号', { exact: true }).fill('contract-user');
	await page.getByLabel('密码', { exact: true }).fill('contract-password');
	await page.getByLabel('验证码', { exact: true }).fill('1234');
	const [request] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/api/sysAuth/login')), page.locator('button[type=submit]').click()]);
	const payload = request.postDataJSON();
	expect(payload.password).not.toBe('contract-password');
	expect(payload.password).toMatch(/^[\da-f]+$/i);
	expect(payload.password.length).toBeGreaterThan(192);
	expect(payload).toMatchObject({ account: 'contract-user', tenantId: 1, codeId: 12, code: '1234' });
	await expect(page.getByRole('alert').filter({ hasText: '验证码错误' }).first()).toBeVisible();
	await expect(page.getByLabel('验证码', { exact: true })).toHaveValue('');
	expect(errors).toEqual([]);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('login.png'), fullPage: true });
});

test('does not allow submission when system configuration is unavailable', async ({ page }) => {
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) => route.fulfill({ status: 503, json: { message: '系统维护中' } }));
	await page.goto('/#/auth/login', { waitUntil: 'networkidle' });
	await expect(page.getByRole('alert').filter({ hasText: '系统维护中' }).first()).toBeVisible();
	await expect(page.locator('button[type=submit]')).toBeDisabled();
	await expect(page.getByRole('button', { name: '重新加载' })).toBeVisible();
});

test('slider verification preserves the login page during mouse and touch dragging', async ({ page, context, isMobile }) => {
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) =>
		route.fulfill({
			json: { code: 200, result: { title: 'Admin.NET', captcha: 2, secondVer: 1, hideTenantForLogin: true, enableReg: 2, wayList: [] } },
		})
	);
	let loginRequests = 0;
	await page.route('**/prod-api/api/sysAuth/login', (route) => {
		loginRequests++;
		return route.fulfill({ json: { code: 400, message: '测试账号拒绝登录', result: null } });
	});
	await page.goto('/#/auth/login');
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.getByLabel('账号', { exact: true }).fill('contract-user');
	await page.getByLabel('密码', { exact: true }).fill('contract-password');
	await page.locator('button[type=submit]').click();
	await expect(page.getByRole('alert').filter({ hasText: '请先完成验证' })).toBeVisible();
	expect(loginRequests).toBe(0);
	const handle = page.locator('[name=captcha-action]');
	const handleBox = await handle.boundingBox();
	const sliderBox = await handle.locator('..').boundingBox();
	expect(handleBox).not.toBeNull();
	expect(sliderBox).not.toBeNull();
	const x = handleBox!.x + handleBox!.width / 2;
	const y = handleBox!.y + handleBox!.height / 2;
	const endX = sliderBox!.x + sliderBox!.width - 2;
	if (isMobile) {
		const cdp = await context.newCDPSession(page);
		try {
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
			for (let step = 1; step <= 12; step++) {
				await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + ((endX - x) * step) / 12, y }] });
			}
			await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
		} finally {
			await cdp.detach();
		}
	} else {
		await page.mouse.move(x, y);
		await page.mouse.down();
		await page.mouse.move(endX, y, { steps: 12 });
		await page.mouse.up();
	}
	await expect(page).toHaveURL(/#\/auth\/login$/);
	await expect(page.getByText('验证通过', { exact: true })).toBeVisible();
	await page.locator('button[type=submit]').click();
	await expect(page.getByRole('alert').filter({ hasText: '测试账号拒绝登录' }).first()).toBeVisible();
	expect(loginRequests).toBe(1);
});

test('validates phone number before requesting an SMS code', async ({ page }) => {
	let sent = 0;
	await page.route('**/prod-api/api/sysSms/sendSms/**', (route) => {
		sent += 1;
		return route.fulfill({ json: { code: 200, result: null } });
	});
	await page.goto('/#/auth/code-login');
	await page.getByLabel('手机号码', { exact: true }).fill('invalid');
	await page.getByRole('button', { name: '获取验证码' }).click();
	await expect(page.getByRole('alert').filter({ hasText: '请输入有效的手机号码' })).toBeVisible();
	expect(sent).toBe(0);
	await page.getByLabel('手机号码', { exact: true }).fill('13800000000');
	await page.getByRole('button', { name: '获取验证码' }).click();
	await expect(page.getByRole('button', { name: /\d+ 秒/ })).toBeDisabled();
	expect(sent).toBe(1);
});
