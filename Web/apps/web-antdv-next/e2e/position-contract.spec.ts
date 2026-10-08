import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

async function loginToPositions(page: Page, readOnly = false) {
	const accessToken = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.signature`;
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) =>
		route.fulfill({
			json: { code: 200, result: { title: 'Admin.NET', captcha: 2, secondVer: 2, hideTenantForLogin: true, enableReg: 2 } },
		})
	);
	await page.route('**/prod-api/api/sysAuth/login', (route) =>
		route.fulfill({
			json: { code: 200, result: { accessToken, refreshToken: 'test-refresh', homepage: '/system/pos' } },
		})
	);
	await page.route('**/prod-api/api/sysAuth/userInfo', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					id: 1,
					account: 'contract-user',
					realName: '测试用户',
					accountType: 777,
					roleIds: [1],
					buttons: readOnly ? ['sysPos:list'] : ['sysPos:list', 'sysPos:add', 'sysPos:update', 'sysPos:delete'],
				},
			},
		})
	);
	await page.route('**/prod-api/api/sysMenu/vbenMenuTree', (route) =>
		route.fulfill({
			json: { code: 200, result: [{ name: 'sysPos', path: '/system/pos', component: '/system/pos/index', meta: { title: '职位管理', icon: 'lucide:briefcase' } }] },
		})
	);
	await page.goto('/#/auth/login');
	await page.getByLabel('账号', { exact: true }).fill('contract-user');
	await page.getByLabel('密码', { exact: true }).fill('contract-password');
	await page.locator('button[type=submit]').click();
	await expect(page).toHaveURL(/#\/system\/pos$/);
}

test('clears a revoked session and shows one expiry notice', async ({ page }, testInfo) => {
	await page.route('**/prod-api/api/sysPos/list**', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await loginToPositions(page);
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
	await page.route('**/prod-api/api/sysPos/list**', (route) =>
		route.fulfill({ headers: { 'access-token': 'invalid_token' }, json: { code: 403, result: null } })
	);
	await page.getByRole('button', { name: '查询', exact: true }).click();
	await expect(page).toHaveURL(/#\/auth\/login/);
	await expect(page.getByText('登录已失效', { exact: true })).toBeVisible();
	await expect(page.getByText('登录已失效', { exact: true })).toHaveCount(1);
	await expect(page.getByText('请求失败（403）', { exact: true })).toHaveCount(0);
	await page.screenshot({ path: testInfo.outputPath('session-expired.png'), fullPage: true });
	await page.reload();
	await page.goto('/#/system/pos');
	await expect(page).toHaveURL(/#\/auth\/login/);
});

test('supports position CRUD, copying, personnel details and column visibility', async ({ page }, testInfo) => {
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	const positions = [{ id: 1, name: '工程师', code: 'engineer', status: 1, orderNo: 100, remark: '', userList: [{ id: 1, account: 'worker', realName: '员工甲' }] }];
	await page.route('**/prod-api/api/sysPos/list**', (route) => route.fulfill({ json: { code: 200, result: positions } }));
	await page.route('**/prod-api/api/sysPos/add', (route) => {
		const value = route.request().postDataJSON();
		positions.push({ ...value, id: positions.length + 1, userList: [] });
		return route.fulfill({ json: { code: 200, result: null } });
	});
	await page.route('**/prod-api/api/sysPos/update', (route) => {
		const value = route.request().postDataJSON();
		Object.assign(
			positions.find((position) => position.id === value.id)!,
			value
		);
		return route.fulfill({ json: { code: 200, result: null } });
	});
	await page.route('**/prod-api/api/sysPos/delete', (route) => {
		const { id } = route.request().postDataJSON();
		positions.splice(
			positions.findIndex((position) => position.id === id),
			1
		);
		return route.fulfill({ json: { code: 200, result: null } });
	});
	await loginToPositions(page);
	await expect(page.getByRole('cell', { name: '工程师', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '人员明细', exact: true }).click();
	await expect(page.getByRole('cell', { name: '员工甲', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '人员明细', exact: true }).click();
	await page.getByRole('button', { name: '新增职位', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('职位名称', { exact: true }).fill('高级工程师');
	await dialog.getByLabel('职位编码', { exact: true }).fill('senior');
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog).toBeHidden();
	await expect(page.getByRole('cell', { name: '高级工程师', exact: true })).toBeVisible();
	await expect(page.locator('.admin-table')).not.toContainText('"userList"');
	await page.getByRole('row').filter({ hasText: '高级工程师' }).getByRole('button', { name: '复制职位' }).click();
	await expect(dialog.getByLabel('职位名称', { exact: true })).toHaveValue('');
	await expect(dialog.getByLabel('职位编码', { exact: true })).toHaveValue('senior');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.getByRole('row').filter({ hasText: '高级工程师' }).getByRole('button', { name: '编辑职位' }).click();
	await dialog.getByLabel('职位名称', { exact: true }).fill('资深工程师');
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByRole('cell', { name: '资深工程师', exact: true })).toBeVisible();
	await page.getByRole('row').filter({ hasText: '资深工程师' }).getByRole('button', { name: '删除职位' }).click();
	await page.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByRole('cell', { name: '资深工程师', exact: true })).toHaveCount(0);
	await page.getByRole('button', { name: '列设置', exact: true }).click();
	await page.getByRole('checkbox', { name: '职位编码', exact: true }).uncheck();
	await expect(page.getByRole('columnheader', { name: '职位编码', exact: true })).toBeHidden();
	await page.getByRole('button', { name: '列设置', exact: true }).click();
	await expect(page.getByRole('checkbox', { name: '序号', exact: true })).toBeHidden();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('position.png'), fullPage: true });
	expect(errors).toEqual([]);
});

test('hides mutation actions from a read-only user', async ({ page }) => {
	await page.route('**/prod-api/api/sysPos/list**', (route) =>
		route.fulfill({
			json: { code: 200, result: [{ id: 1, name: '工程师', code: 'engineer', status: 1, orderNo: 100, userList: [] }] },
		})
	);
	await loginToPositions(page, true);
	await expect(page.getByRole('cell', { name: '工程师', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '编辑职位', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '删除职位', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '复制职位', exact: true })).toHaveCount(0);
});
