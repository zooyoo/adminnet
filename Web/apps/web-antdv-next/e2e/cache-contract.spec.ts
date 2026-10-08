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
	await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('cache.png'), fullPage: true });
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`mobile cache actions stay clear of preferences and login notifications (${colorScheme})`, async ({ page, isMobile }, testInfo) => {
		test.skip(!isMobile, 'Mobile overlay regression');
		await page.emulateMedia({ colorScheme });
		await page.setViewportSize({ width: 320, height: 740 });
		await loginAdmin(page, 'cache');
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) {
			await page.setViewportSize({ width: 1024, height: 740 });
			await page.getByRole('button', { name: colorScheme, exact: true }).click();
			await page.setViewportSize({ width: 320, height: 740 });
		}
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await page
			.locator('.ant-tree-title')
			.filter({ hasText: /^standalone$/ })
			.click();
		const remove = page.getByRole('button', { name: '删除缓存', exact: true });
		await expect(remove).toBeEnabled();
		// 检查整个按钮命中区域，而不仅是 Playwright 默认点击的中心点。
		expect(
			await remove.evaluate((button) => {
				const rect = button.getBoundingClientRect();
				return [0.1, 0.5, 0.9].every((fraction) => button.contains(document.elementFromPoint(rect.left + rect.width * fraction, rect.top + rect.height / 2)));
			})
		).toBe(true);
		await remove.tap();
		const modal = page.locator('.ant-modal:visible');
		await expect(modal).toBeVisible();
		const title = modal.locator('.ant-modal-title');
		expect(
			await title.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return element.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
			})
		).toBe(true);
		await modal.getByRole('button', { name: /^取\s*消$/ }).tap();
		await expect(modal).toHaveCount(0);
		await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
		await expect(page.locator('.cache-detail')).toContainText('缓存内容');
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({ path: testInfo.outputPath('cache-mobile-stable.png'), fullPage: true });
		await page.getByRole('button', { name: '测试用户', exact: true }).tap();
		await expect(page.getByRole('menuitem', { name: /偏好设置/ })).toBeVisible();
	});
}

test('failed deletion preserves the selected key and confirmation for retry', async ({ page }) => {
	await page.route('**/prod-api/api/sysCache/delete/**', (route) => route.fulfill({ status: 500, json: { message: '缓存删除失败' } }));
	await loginAdmin(page, 'cache');
	await page
		.locator('.ant-tree-title')
		.filter({ hasText: /^standalone$/ })
		.click();
	await page.getByRole('button', { name: '删除缓存', exact: true }).click();
	const modal = page.locator('.ant-modal:visible');
	await modal.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByText('缓存删除失败', { exact: true })).toBeVisible();
	await expect(modal).toBeVisible();
	await expect(modal.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await expect(page.locator('.cache-detail')).toContainText('缓存内容');
	await modal.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(modal).toHaveCount(0);
});

test('read-only cache permissions expose no destructive controls', async ({ page }) => {
	await mockAdminSession(page, 'cache', { readOnly: true });
	await loginAdmin(page, 'cache');
	await expect(page.getByRole('heading', { name: '缓存列表', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '清空全部缓存', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '删除缓存', exact: true })).toHaveCount(0);
});

test('cache scalar values retain false, zero, null and literal text', async ({ page }) => {
	await loginAdmin(page, 'cache');
	for (const value of [false, 0, null, 'plain text']) {
		await page.route('**/prod-api/api/sysCache/value/**', (route) => route.fulfill({ json: { code: 200, result: value } }));
		await page
			.locator('.ant-tree-title')
			.filter({ hasText: /^standalone$/ })
			.click();
		await expect(page.locator('.cache-scalar')).toHaveText(String(value));
		await page.getByRole('button', { name: '刷新缓存列表' }).click();
		await expect(page.getByRole('button', { name: '删除缓存', exact: true })).toBeDisabled();
	}
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
