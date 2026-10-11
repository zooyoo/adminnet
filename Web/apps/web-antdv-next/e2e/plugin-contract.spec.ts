import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test('新增与删除确认闭环，取消删除不发请求', async ({ page }) => {
	const unexpected: string[] = [];
	await page.route('**/prod-api/**', async (route) => {
		unexpected.push(new URL(route.request().url()).pathname);
		await route.fulfill({ status: 501, json: { code: 501 } });
	});
	await mockAdminSession(page, 'plugin');
	let rows: Record<string, unknown>[] = [];
	let deletes = 0;
	let added: Record<string, unknown> | undefined;
	await page.route('**/prod-api/api/sysPlugin/page', (route) => route.fulfill({ json: { code: 200, result: { items: rows, total: rows.length } } }));
	await page.route('**/prod-api/api/sysPlugin/add', async (route) => {
		added = route.request().postDataJSON();
		rows = [{ ...added, id: '34001', assemblyName: 'GeneratedProbe' }];
		await route.fulfill({ json: { code: 200, result: null } });
	});
	await page.route('**/prod-api/api/sysPlugin/delete', async (route) => {
		expect(route.request().postDataJSON()).toEqual({ id: '34001' });
		deletes += 1;
		rows = [];
		await route.fulfill({ json: { code: 200, result: null } });
	});
	await loginAdmin(page, 'plugin');
	await page.getByRole('button', { name: '新增插件', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '添加动态插件' });
	await dialog.getByRole('textbox', { name: '功能名称', exact: true }).fill('浏览器新增插件');
	await expect(dialog.locator('.monaco-editor')).toBeVisible();
	await dialog.getByRole('textbox', { name: 'C# 代码', exact: true }).focus();
	await page.keyboard.type('public class BrowserProbe {}');
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog).not.toBeVisible();
	await expect(page.getByRole('cell', { name: '浏览器新增插件', exact: true })).toBeVisible();
	expect(added).toMatchObject({ name: '浏览器新增插件', csharpCode: 'public class BrowserProbe {}', orderNo: 100, status: 1 });
	expect(added).not.toHaveProperty('id');
	await page.getByRole('button', { name: '删除', exact: true }).click();
	const confirmation = page.getByRole('dialog', { name: '删除动态插件' });
	await confirmation.getByRole('button', { name: '取消', exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	expect(deletes).toBe(0);
	await page.getByRole('button', { name: '删除', exact: true }).click();
	await confirmation.getByRole('button', { name: '删除', exact: true }).click();
	await expect(confirmation).not.toBeVisible();
	await expect(page.getByRole('cell', { name: '浏览器新增插件', exact: true })).toHaveCount(0);
	expect(deletes).toBe(1);
	expect(unexpected).toEqual([]);
});

test('只读权限不提供增改删操作', async ({ page }) => {
	const unexpected: string[] = [];
	await page.route('**/prod-api/**', async (route) => {
		unexpected.push(new URL(route.request().url()).pathname);
		await route.fulfill({ status: 501, json: { code: 501 } });
	});
	await mockAdminSession(page, 'plugin', { readOnly: true });
	await page.route('**/prod-api/api/sysPlugin/page', (route) =>
		route.fulfill({ json: { code: 200, result: { items: [{ id: '34', name: '只读插件', assemblyName: 'ReadOnlyProbe', csharpCode: 'public class A {}', orderNo: 100, status: 1 }], total: 1 } } })
	);
	await loginAdmin(page, 'plugin');
	await expect(page.getByRole('cell', { name: '只读插件', exact: true })).toBeVisible();
	for (const name of ['新增插件', '编辑', '删除']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	expect(unexpected).toEqual([]);
});

// 生产页面 + Mock API 合同，不代替真实数据库与授权验收。
test('Monaco 编辑、取消、保存失败及重开原文', async ({ page }) => {
	const unexpected: string[] = [];
	const source = '  // 中文原文\r\npublic class ProbeController { public string Get() => "原文"; }\r\n';
	await page.route('**/prod-api/**', async (route) => {
		unexpected.push(new URL(route.request().url()).pathname);
		await route.fulfill({ status: 501, json: { code: 501, message: '未声明 Mock API' } });
	});
	await mockAdminSession(page, 'plugin');
	await page.route('**/prod-api/api/sysPlugin/page', (route) =>
		route.fulfill({ json: { code: 200, result: { items: [{ id: '34', name: '测试插件', assemblyName: 'Probe', csharpCode: source, orderNo: 100, status: 1, tenantId: 1 }], total: 1 } } })
	);
	let submitted: Record<string, unknown> | undefined;
	await page.route('**/prod-api/api/sysPlugin/update', async (route) => {
		submitted = route.request().postDataJSON();
		await route.fulfill({ json: { code: 500, message: '编译失败', result: null } });
	});
	await loginAdmin(page, 'plugin');
	await expect(page.getByRole('cell', { name: '测试插件', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '编辑', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑动态插件' });
	await expect(dialog.locator('.monaco-editor')).toBeVisible();
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect(dialog.getByRole('alert', { name: '插件保存错误' })).toBeFocused();
	expect(submitted?.csharpCode).toBe(source);
	const input = dialog.getByRole('textbox', { name: 'C# 代码', exact: true });
	await input.focus();
	await page.keyboard.press('Control+End');
	await page.keyboard.type('// changed');
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect.poll(() => String(submitted?.csharpCode)).toContain('// changed');
	await dialog.getByRole('button', { name: '取消', exact: true }).click();
	await expect(page.locator('.monaco-editor')).toHaveCount(0);
	await page.getByRole('button', { name: '编辑', exact: true }).click();
	await expect(dialog.locator('.monaco-editor')).toBeVisible();
	await dialog.getByRole('button', { name: '保存', exact: true }).click();
	await expect.poll(() => submitted?.csharpCode).toBe(source);
	expect(unexpected).toEqual([]);
});
