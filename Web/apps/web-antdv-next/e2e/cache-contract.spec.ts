import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'cache');
	await page.route('**/prod-api/api/sysCache/keyList', (route) => route.fulfill({ json: { code: 200, result: ['standalone', 'user:中文/%?key', 'user:second', 'other:1'] } }));
	await page.route('**/prod-api/api/sysCache/value/**', (route) => route.fulfill({ json: { code: 200, result: '{"example":"缓存内容"}' } }));
	await page.route('**/prod-api/api/sysCache/delete/**', (route) => route.fulfill({ json: { code: 200, result: 1 } }));
	await page.route('**/prod-api/api/sysCache/clear', (route) => route.fulfill({ json: { code: 200 } }));
});

test('cache namespaces are not deletable and cache keys remain correctly encoded', async ({ page }, testInfo) => {
	await loginAdmin(page, 'cache');
	await expect(page.getByRole('button', { name: '删除缓存', exact: true })).toBeDisabled();
	await page
		.locator('.ant-tree-title')
		.filter({ hasText: /^user$/ })
		.click();
	await expect(page.getByRole('button', { name: '删除缓存', exact: true })).toBeDisabled();
	const [read] = await Promise.all([
		page.waitForRequest((req) => req.url().includes('/sysCache/value/')),
		page
			.locator('.ant-tree-title')
			.filter({ hasText: /^中文\/%\?key$/ })
			.click(),
	]);
	expect(decodeURIComponent(new URL(read.url()).pathname)).toBe('/prod-api/api/sysCache/value/user:中文/%?key');
	await expect(page.locator('.cache-detail')).toContainText('缓存内容');
	await page.getByRole('button', { name: '删除缓存', exact: true }).click();
	const [deleted] = await Promise.all([page.waitForRequest((req) => req.url().includes('/sysCache/delete/')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(decodeURIComponent(new URL(deleted.url()).pathname)).toBe('/prod-api/api/sysCache/delete/user:中文/%?key');
	await expect(page.getByRole('button', { name: '删除缓存', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: '清空全部缓存', exact: true }).click();
	const [cleared] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysCache/clear')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(cleared.method()).toBe('POST');
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('cache.png'), fullPage: true });
});

test('cache value failures leave the key selected for retry without showing stale data', async ({ page }) => {
	await loginAdmin(page, 'cache');
	await page
		.locator('.ant-tree-title')
		.filter({ hasText: /^standalone$/ })
		.click();
	await expect(page.locator('.cache-detail')).toContainText('缓存内容');
	await page.route('**/prod-api/api/sysCache/value/**', (route) => route.fulfill({ status: 500, json: { message: '缓存值读取失败' } }));
	await page
		.locator('.ant-tree-title')
		.filter({ hasText: /^second$/ })
		.click();
	await expect(page.locator('.cache-detail').getByRole('alert')).toContainText('缓存值读取失败');
	await expect(page.locator('.cache-detail')).not.toContainText('缓存内容');
});
