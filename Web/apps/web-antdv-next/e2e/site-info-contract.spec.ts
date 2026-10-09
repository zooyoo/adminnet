import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const info = {
	title: 'Admin.NET',
	viceTitle: '管理平台',
	viceDesc: '描述',
	logo: '/logo.png',
	watermark: '测试水印',
	copyright: 'Test',
	icp: '',
	icpUrl: '',
	enableReg: 2,
	regWayId: 7,
	captcha: 2,
	secondVer: 2,
	hideTenantForLogin: true,
	wayList: [{ value: 7, label: '默认注册方案' }],
};

test('system information uses authenticated tenant data and validates registration choices', async ({ page }, testInfo) => {
	await mockAdminSession(page, 'infoSetting');
	const requests: boolean[] = [];
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) => {
		requests.push(Boolean(route.request().headers().authorization));
		return route.fulfill({ json: { code: 200, result: info } });
	});
	await page.route('**/prod-api/api/sysConfig/saveSysInfo', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'infoSetting');
	await expect(page.getByRole('textbox', { name: '系统主标题', exact: true })).toHaveValue('Admin.NET');
	await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled();
	expect(requests).toContain(false);
	expect(requests).toContain(true);
	await page.getByRole('radio', { name: '启用', exact: true }).check();
	await page.getByRole('combobox', { name: /注册方案/ }).click();
	await page.getByRole('option', { name: '默认注册方案', exact: true }).click();
	await page.getByRole('textbox', { name: '系统主标题', exact: true }).fill('新标题');
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysConfig/saveSysInfo')), page.getByRole('button', { name: /^保\s*存$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ title: '新标题', enableReg: 1, regWayId: 7, watermark: '测试水印' });
	await expect(page.getByRole('textbox', { name: '系统主标题', exact: true })).toHaveValue('Admin.NET');
	await page.getByRole('radio', { name: '禁用', exact: true }).check();
	const [disabled] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysConfig/saveSysInfo')), page.getByRole('button', { name: /^保\s*存$/ }).click()]);
	expect(disabled.postDataJSON()).not.toHaveProperty('regWayId');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('site-info.png'), fullPage: true });
});

test('system logo submits base64 once and an authenticated load failure blocks save', async ({ page }) => {
	await mockAdminSession(page, 'infoSetting');
	let fail = false;
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) =>
		fail && route.request().headers().authorization ? route.fulfill({ status: 500, json: { message: '系统信息不可用' } }) : route.fulfill({ json: { code: 200, result: info } })
	);
	await page.route('**/prod-api/api/sysConfig/saveSysInfo', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'infoSetting');
	await page.getByRole('textbox', { name: '系统主标题', exact: true }).waitFor();
	await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled();
	await page.locator('input[type=file]').setInputFiles({ name: 'site-logo.png', mimeType: 'image/png', buffer: readFileSync(new URL('../public/logo.png', import.meta.url)) });
	await expect(page.getByText('site-logo.png', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: '取消 Logo 更改', exact: true }).click();
	const [cancelled] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysConfig/saveSysInfo')), page.getByRole('button', { name: /^保\s*存$/ }).click()]);
	expect(cancelled.postDataJSON()).not.toHaveProperty('logoBase64');
	expect(cancelled.postDataJSON()).not.toHaveProperty('logoFileName');
	await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled();
	await page.locator('input[type=file]').setInputFiles({ name: 'site-logo.png', mimeType: 'image/png', buffer: readFileSync(new URL('../public/logo.png', import.meta.url)) });
	await expect(page.getByText('site-logo.png', { exact: true })).toBeVisible();
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysConfig/saveSysInfo')), page.getByRole('button', { name: /^保\s*存$/ }).click()]);
	expect(saved.postDataJSON().logoBase64).toMatch(/^data:image\/png;base64,/);
	expect(saved.postDataJSON().logoFileName).toBe('site-logo.png');
	await expect(page.getByText('site-logo.png', { exact: true })).toHaveCount(0);
	fail = true;
	await page.getByRole('button', { name: '重新加载系统信息', exact: true }).click();
	await expect(page.locator('.site-info-page').getByRole('alert')).toContainText('系统信息不可用');
	await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeDisabled();
});

test('read-only site settings cannot save', async ({ page }) => {
	await mockAdminSession(page, 'infoSetting', { readOnly: true });
	await loginAdmin(page, 'infoSetting');
	await expect(page.getByRole('textbox', { name: '系统主标题', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /^保\s*存$/ })).toHaveCount(0);
});
