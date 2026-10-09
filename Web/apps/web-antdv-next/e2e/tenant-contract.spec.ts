import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { loginAdmin, mockAdminSession, testToken } from './fixtures/admin-session';

const tenant = {
	id: 2,
	userId: 22,
	name: '租户二',
	adminAccount: 'tenant-admin',
	phone: '13800000000',
	status: 1,
	tenantType: 1,
	dbType: 2,
	configId: '2',
	connection: 'Data Source=test.db',
	host: '',
	orderNo: 100,
};

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'tenant', { superAdmin: true });
	await page.route('**/prod-api/api/sysTenant/page', (route) => route.fulfill({ json: { code: 200, result: { items: [tenant], total: 1 } } }));
	await page.route('**/prod-api/api/sysMenu/list**', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{
						id: 10,
						title: '用户',
						children: [
							{ id: 11, title: '查询用户' },
							{ id: 12, title: '编辑用户' },
						],
					},
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysTenant/tenantMenuList**', (route) => route.fulfill({ json: { code: 200, result: [11] } }));
});

test('tenant save blocks closing and preserves the draft after failure', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/prod-api/api/sysTenant/update', async (route) => {
		await pending;
		await route.fulfill({ status: 500, json: { message: '租户保存失败测试' } });
	});
	await loginAdmin(page, 'tenant');
	await page.getByRole('button', { name: '编辑租户', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑租户', exact: true });
	await dialog.getByLabel('备注', { exact: true }).fill('保留的租户草稿');
	try {
		await Promise.all([page.waitForRequest((request) => request.url().endsWith('/sysTenant/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
		await expect(dialog.getByRole('button', { name: /^取\s*消$/ })).toBeDisabled();
		await expect(dialog.getByRole('button', { name: '关闭', exact: true })).toHaveCount(0);
		await page.keyboard.press('Escape');
		await expect(dialog).toBeVisible();
	} finally {
		release();
	}
	await expect(dialog.getByRole('alert')).toContainText('租户保存失败测试');
	await expect(dialog.getByLabel('备注', { exact: true })).toHaveValue('保留的租户草稿');
	await expect(dialog.getByRole('button', { name: /^取\s*消$/ })).toBeEnabled();
});

test('late tenant password response cannot reopen the password dialog after leaving the page', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/prod-api/api/sysTenant/resetPwd', async (route) => {
		await pending;
		await route.fulfill({ json: { code: 200, result: 'late-test-only-password' } });
	});
	await loginAdmin(page, 'tenant');
	await page.getByRole('button', { name: '更多租户操作' }).click();
	await page.getByRole('menuitem', { name: '重置密码', exact: true }).click();
	const response = page.waitForResponse((item) => item.url().endsWith('/sysTenant/resetPwd'));
	try {
		await Promise.all([
			page.waitForRequest((request) => request.url().endsWith('/sysTenant/resetPwd')),
			page
				.getByRole('dialog')
				.getByRole('button', { name: /^确\s*定$/ })
				.click(),
		]);
		await page.evaluate(() => {
			window.location.hash = '/dashboard/notice';
		});
		await expect(page).toHaveURL(/#\/dashboard\/notice$/);
	} finally {
		release();
	}
	await response;
	await expect(page.getByRole('dialog').filter({ hasText: '重置租管密码？' })).toHaveCount(0);
	await expect(page.getByRole('dialog', { name: '租管密码已重置', exact: true })).toHaveCount(0);
	await expect(page.getByLabel('重置后的密码')).toHaveCount(0);
});

test('tenant editing preserves isolation type and uses numeric database types', async ({ page }, testInfo) => {
	await loginAdmin(page, 'tenant');
	await page.route('**/prod-api/api/sysTenant/update', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑租户', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('radio', { name: '数据库隔离', exact: true })).toBeDisabled();
	await dialog.getByLabel('租户名称', { exact: true }).fill('租户二更新');
	await dialog.getByLabel('数据库类型', { exact: true }).click();
	await page.getByRole('option', { name: 'Odbc', exact: true }).click();
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysTenant/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ id: 2, name: '租户二更新', tenantType: 1, dbType: 15 });
	expect(new URL(saved.url()).pathname).toBe('/prod-api/api/sysTenant/update');
	await expect(dialog).toBeHidden();
	await page.screenshot({ path: testInfo.outputPath('tenant.png'), fullPage: true });
});

test('tenant menu grants preserve partial checks and failed loading blocks submission', async ({ page }) => {
	await loginAdmin(page, 'tenant');
	await page.route('**/prod-api/api/sysTenant/grantMenu', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '更多租户操作' }).click();
	await page.getByRole('menuitem', { name: '授权菜单' }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.locator('.ant-tree-checkbox-checked')).toHaveCount(1);
	const [granted] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysTenant/grantMenu')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(granted.postDataJSON()).toEqual({ id: 2, menuIdList: [11] });
	await expect(dialog).toBeHidden();
	await page.route('**/prod-api/api/sysTenant/tenantMenuList**', (route) => route.fulfill({ status: 500, json: { message: '菜单权限加载失败' } }));
	await page.getByRole('button', { name: '更多租户操作' }).click();
	await page.getByRole('menuitem', { name: '授权菜单' }).click();
	await expect(dialog.getByRole('alert')).toContainText('菜单权限加载失败');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeDisabled();
});

test('database creation and reset password use distinct tenant and administrator identifiers', async ({ page }) => {
	await loginAdmin(page, 'tenant');
	await page.route('**/prod-api/api/sysTenant/createDb', (route) => route.fulfill({ json: { code: 200 } }));
	await page.route('**/prod-api/api/sysTenant/resetPwd', (route) => route.fulfill({ json: { code: 200, result: 'temporary-tenant-test' } }));
	await page.getByRole('button', { name: '创建数据库', exact: true }).click();
	const [created] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysTenant/createDb')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(created.postDataJSON()).toEqual({ id: 2 });
	await page.getByRole('button', { name: '更多租户操作' }).click();
	await page.getByRole('menuitem', { name: '重置密码' }).click();
	const [reset] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysTenant/resetPwd')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(reset.postDataJSON()).toEqual({ userId: 22 });
	await expect(page.getByLabel('重置后的密码')).toHaveValue('temporary-tenant-test');
});

test('failed tenant switch preserves current session and successful switching reloads permissions', async ({ page }) => {
	await loginAdmin(page, 'tenant');
	await page.route('**/prod-api/api/sysTenant/changeTenant', (route) => route.fulfill({ status: 500, json: { message: '切换失败' } }));
	await page.getByRole('button', { name: '切换租户', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '切换租户' });
	await dialog.getByLabel('租户', { exact: true }).click();
	await page.getByRole('option', { name: '租户二', exact: true }).click();
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByText('切换失败', { exact: true }).first()).toBeVisible();
	await expect(page).toHaveURL(/#\/system\/tenant$/);
	await expect(dialog).toBeVisible();
	const nextToken = testToken(2);
	await page.route('**/prod-api/api/sysTenant/changeTenant', (route) =>
		route.fulfill({ json: { code: 200, result: { accessToken: nextToken, refreshToken: 'refresh-two', homepage: '/system/tenant' } } })
	);
	await page.route('**/prod-api/api/sysAuth/userInfo', (route) =>
		route.fulfill({ json: { code: 200, result: { id: 10, account: 'contract', realName: '租户二用户', accountType: 777, currentTenantId: 2, roleIds: [2], buttons: ['sysTenant:page'] } } })
	);
	const [info] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysAuth/userInfo')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(info.headers().authorization).toBe(`Bearer ${nextToken}`);
	await expect(page.getByRole('button', { name: '编辑租户', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '更多租户操作' })).toHaveCount(0);
});

test('field-isolated and default tenants cannot create databases or disable the default tenant', async ({ page }) => {
	await page.route('**/prod-api/api/sysTenant/page', (route) =>
		route.fulfill({ json: { code: 200, result: { items: [{ ...tenant, id: 1300000000001, configId: '1300000000001', tenantType: 0 }], total: 1 } } })
	);
	await loginAdmin(page, 'tenant');
	await expect(page.getByRole('button', { name: '创建数据库', exact: true })).toBeDisabled();
	await expect(page.getByRole('switch', { name: '切换租户二状态' })).toBeDisabled();
});

test('tenant creation, synchronization and deletion each require their matching contracts', async ({ page }) => {
	await loginAdmin(page, 'tenant');
	for (const endpoint of ['add', 'syncGrantMenu', 'delete']) {
		await page.route(`**/prod-api/api/sysTenant/${endpoint}`, (route) => route.fulfill({ json: { code: 200 } }));
	}
	await page.getByRole('button', { name: '新增租户', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('租户名称', { exact: true }).fill('新租户');
	await dialog.getByLabel('租管账号', { exact: true }).fill('new-admin');
	await dialog.getByLabel('电话', { exact: true }).fill('13900000000');
	const [added] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysTenant/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(added.postDataJSON()).toMatchObject({ name: '新租户', adminAccount: 'new-admin', tenantType: 0 });
	await expect(dialog).toBeHidden();
	for (const [label, endpoint] of [
		['同步授权', 'syncGrantMenu'],
		['删除租户', 'delete'],
	]) {
		await page.getByRole('button', { name: '更多租户操作' }).click();
		await page.getByRole('menuitem', { name: label!, exact: true }).click();
		const [request] = await Promise.all([page.waitForRequest((req) => req.url().endsWith(`/sysTenant/${endpoint}`)), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
		expect(request.postDataJSON()).toEqual({ id: 2 });
		await expect(page.getByRole('dialog')).toBeHidden();
	}
});

test('cancelled logo selection does not leak into a later tenant save', async ({ page }, testInfo) => {
	const site = { ...tenant, host: 'tenant.example.test', title: '租户站点', viceTitle: '副标题', viceDesc: '站点描述', copyright: 'Tenant', logo: '/logo.png' };
	await page.route('**/prod-api/api/sysTenant/page', (route) => route.fulfill({ json: { code: 200, result: { items: [site], total: 1 } } }));
	await page.route('**/prod-api/api/sysTenant/update', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'tenant');
	await page.getByRole('button', { name: '编辑租户', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByRole('tab', { name: '站点信息' }).click();
	await dialog.locator('input[type=file]').setInputFiles({ name: 'changed-logo.png', mimeType: 'image/png', buffer: readFileSync(new URL('../public/logo.png', import.meta.url)) });
	await expect(dialog.getByText('changed-logo.png', { exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '编辑租户', exact: true }).click();
	await dialog.getByRole('tab', { name: '站点信息' }).click();
	await expect(dialog.getByText('changed-logo.png', { exact: true })).toHaveCount(0);
	await expect(dialog.locator('img').first()).toHaveAttribute('src', '/logo.png');
	await page.screenshot({ path: testInfo.outputPath('tenant-site.png'), fullPage: true });
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysTenant/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).not.toHaveProperty('logoBase64');
	expect(saved.postDataJSON()).not.toHaveProperty('logoFileName');
});

test('entering the tenant administrator uses goTenant and adopts that identity', async ({ page }) => {
	await loginAdmin(page, 'tenant');
	const nextToken = testToken(2);
	await page.route('**/prod-api/api/sysTenant/goTenant', (route) =>
		route.fulfill({ json: { code: 200, result: { accessToken: nextToken, refreshToken: 'admin-refresh', homepage: '/system/tenant' } } })
	);
	await page.route('**/prod-api/api/sysAuth/userInfo', (route) =>
		route.fulfill({ json: { code: 200, result: { id: 22, account: 'tenant-admin', realName: '租户管理员', accountType: 888, currentTenantId: 2, roleIds: [2], buttons: ['sysTenant:page'] } } })
	);
	await page.getByRole('button', { name: '更多租户操作' }).click();
	await page.getByRole('menuitem', { name: '进入租管端', exact: true }).click();
	const [request, info] = await Promise.all([
		page.waitForRequest((req) => req.url().endsWith('/sysTenant/goTenant')),
		page.waitForRequest((req) => req.url().endsWith('/sysAuth/userInfo')),
		page.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	expect(request.postDataJSON()).toEqual({ id: 2 });
	expect(info.headers().authorization).toBe(`Bearer ${nextToken}`);
	await expect(page.getByRole('button', { name: '更多租户操作' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '切换租户', exact: true })).toHaveCount(0);
});

test('read-only tenant view exposes no management actions', async ({ page }) => {
	await mockAdminSession(page, 'tenant', { readOnly: true });
	await loginAdmin(page, 'tenant');
	await expect(page.getByRole('cell', { name: 'tenant-admin', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /新增租户|编辑租户|创建数据库|更多租户操作/ })).toHaveCount(0);
});

for (const failedEndpoint of ['sysAuth/userInfo', 'sysMenu/vbenMenuTree']) {
	test(`failed candidate ${failedEndpoint} preserves the active tenant and token`, async ({ page }) => {
		const initialRequest = page.waitForRequest((item) => item.url().endsWith('/sysTenant/page'));
		await loginAdmin(page, 'tenant');
		const originalAuthorization = (await initialRequest).headers().authorization;
		const candidateToken = testToken(2);
		await page.route('**/prod-api/api/sysTenant/changeTenant', (route) =>
			route.fulfill({
				headers: { 'access-token': candidateToken, 'x-access-token': 'candidate-refresh' },
				json: { code: 200, result: { accessToken: candidateToken, refreshToken: 'candidate-refresh', homepage: '/system/tenant' } },
			})
		);
		await page.route(`**/prod-api/api/${failedEndpoint}`, async (route) => {
			if (route.request().headers().authorization === `Bearer ${candidateToken}`) {
				await route.fulfill({ status: 500, json: { message: '候选身份初始化失败' } });
			} else {
				await route.fallback();
			}
		});
		await page.getByRole('button', { name: '切换租户', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '切换租户', exact: true });
		await dialog.getByLabel('租户', { exact: true }).click();
		await page.getByRole('option', { name: '租户二', exact: true }).click();
		await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
		await expect(page.getByText('候选身份初始化失败', { exact: true }).first()).toBeVisible();
		await expect(dialog).toBeVisible();
		await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
		await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
		await expect(page.getByRole('button', { name: '编辑租户', exact: true })).toBeVisible();
		const [request] = await Promise.all([page.waitForRequest((item) => item.url().endsWith('/sysTenant/page')), page.getByRole('button', { name: /^查\s*询$/ }).click()]);
		expect(request.headers().authorization).toBe(originalAuthorization);
		await expect(page).toHaveURL(/#\/system\/tenant$/);
	});
}

test('a candidate identity arriving after logout cannot recreate the session', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await loginAdmin(page, 'tenant');
	const candidateToken = testToken(2);
	await page.route('**/prod-api/api/sysAuth/logout', (route) => route.fulfill({ json: { code: 200 } }));
	await page.route('**/prod-api/api/sysTenant/changeTenant', (route) =>
		route.fulfill({
			json: { code: 200, result: { accessToken: candidateToken, refreshToken: 'candidate-refresh', homepage: '/system/tenant' } },
		})
	);
	await page.route('**/prod-api/api/sysAuth/userInfo', async (route) => {
		if (route.request().headers().authorization !== `Bearer ${candidateToken}`) return route.fallback();
		await pending;
		await route.fulfill({ json: { code: 200, result: { id: 22, account: 'candidate', realName: '候选身份', roleIds: [], buttons: [] } } }).catch(() => {});
	});
	try {
		await page.getByRole('button', { name: '切换租户', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '切换租户', exact: true });
		await dialog.getByLabel('租户', { exact: true }).click();
		await page.getByRole('option', { name: '租户二', exact: true }).click();
		await Promise.all([
			page.waitForRequest((request) => request.url().endsWith('/sysAuth/userInfo') && request.headers().authorization === `Bearer ${candidateToken}`),
			dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
		]);
		await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
		await expect(dialog).toBeHidden();
		await page.keyboard.press('Alt+q');
		await page
			.getByRole('dialog')
			.getByRole('button', { name: /^确\s*认$/ })
			.click();
		await expect(page).toHaveURL(/#\/auth\/login/);
	} finally {
		release();
	}
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await page.reload();
	await expect(page).toHaveURL(/#\/auth\/login/);
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
});
