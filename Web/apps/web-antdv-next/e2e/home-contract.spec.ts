import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'cache');
	await page.route('**/prod-api/api/sysCache/keyList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await page.route('**/prod-api/api/sysSchedule/page', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await page.route('**/prod-api/api/sysMenu/loginMenuTree', (route) => route.fulfill({ json: { code: 200, result: [
		{ id: 1, name: 'cache', path: '/system/cache', type: 2, status: 1, meta: { title: '缓存管理' } },
		{ id: 2, name: 'hidden', path: '/hidden', type: 2, status: 1, meta: { title: '隐藏菜单', isHide: true } },
	] } }));
	await page.route('**/prod-api/api/sysUserMenu/userMenuList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await loginAdmin(page, 'cache');
	await page.goto('/#/home');
	await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
});

test('保存校验及服务失败保留草稿，重复点击只发一次请求', async ({ page }) => {
	let requests = 0;
	await page.route('**/prod-api/api/sysSchedule/add', async (route) => {
		requests++;
		await new Promise((resolve) => setTimeout(resolve, 200));
		await route.fulfill({ json: { code: 400, message: '日程服务拒绝保存' } });
	});
	await page.getByRole('button', { name: '添加日程', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '添加日程', exact: true });
	await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('日程内容');
	expect(requests).toBe(0);
	await page.getByLabel('日程内容', { exact: true }).fill('失败时保留');
	await page.getByLabel('结束时间', { exact: true }).fill('08:00');
	await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('结束时间');
	expect(requests).toBe(0);
	await page.getByLabel('结束时间', { exact: true }).fill('10:00');
	await dialog.getByRole('button', { name: '保存日程', exact: true }).dblclick();
	await expect(dialog.getByRole('alert')).toContainText('日程服务拒绝保存');
	expect(requests).toBe(1);
	await expect(page.getByLabel('日程内容', { exact: true })).toHaveValue('失败时保留');
});

test('快捷入口加载失败不能覆盖原配置，隐藏菜单不能选', async ({ page }) => {
	await page.getByRole('button', { name: '配置快捷入口', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '配置快捷入口', exact: true });
	await expect(dialog.getByRole('checkbox', { name: '缓存管理', exact: true })).toBeVisible();
	await expect(dialog.getByRole('checkbox', { name: '隐藏菜单', exact: true })).toHaveCount(0);
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.route('**/prod-api/api/sysUserMenu/userMenuList', (route) => route.fulfill({ json: { code: 400, message: '收藏读取失败' } }));
	await page.getByRole('button', { name: '刷新快捷入口', exact: true }).click();
	await expect(page.locator('[data-widget="myapp"]').getByRole('alert')).toContainText('收藏读取失败');
	await expect(page.getByRole('button', { name: '配置快捷入口', exact: true })).toBeDisabled();
});

test('日程读取失败有错误状态且不把失败显示为空列表', async ({ page }) => {
	await page.route('**/prod-api/api/sysSchedule/page', (route) => route.fulfill({ json: { code: 403, message: '无权读取日程' } }));
	await page.getByRole('button', { name: '刷新日程', exact: true }).click();
	await expect(page.locator('[data-widget="schedule"]').getByRole('alert')).toContainText('无权读取日程');
	await expect(page.getByText('当天暂无日程', { exact: true })).toHaveCount(0);
});

test('配置恢复保留取消行为，外部更新服务失败明确提示', async ({ page }) => {
	await page.getByRole('button', { name: '自定义工作台', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '自定义工作台', exact: true });
	await dialog.getByRole('button', { name: '隐藏当前时钟', exact: true }).click();
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(page.locator('[data-widget="timer"]')).toBeVisible();
	await page.route('https://gitee.com/api/**', (route) => route.fulfill({ status: 503, body: '' }));
	await page.getByRole('button', { name: '加载更新记录', exact: true }).click();
	await expect(page.locator('[data-widget="commit"]').getByRole('alert')).toContainText('更新记录暂时无法加载');
});

test('离开页面后的迟到保存不恢复日程弹窗', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => { release = resolve; });
	let received!: () => void;
	const started = new Promise<void>((resolve) => { received = resolve; });
	await page.route('**/prod-api/api/sysSchedule/add', async (route) => {
		received();
		await pending;
		await route.fulfill({ json: { code: 200, result: null } }).catch(() => {});
	});
	await page.getByRole('button', { name: '添加日程', exact: true }).click();
	await page.getByLabel('日程内容', { exact: true }).fill('迟到结果');
	await page.getByRole('dialog', { name: '添加日程', exact: true }).getByRole('button', { name: '保存日程', exact: true }).click();
	await started;
	await page.goto('/#/about');
	release();
	await expect(page.getByText('关于 Admin.NET', { exact: true })).toBeVisible();
	await expect(page.getByRole('dialog')).toHaveCount(0);
});
