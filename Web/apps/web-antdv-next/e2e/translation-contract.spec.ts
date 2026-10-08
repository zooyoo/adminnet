import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const record = { id: 1, entityName: 'SysMenu', entityId: 100, fieldName: 'Title', langCode: 'en', content: 'Users' };
const spreadsheet = Buffer.from('spreadsheet-fixture');
const spreadsheetType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'langText');
	await page.route('**/prod-api/api/sysLangText/page', (route) => route.fulfill({ json: { code: 200, result: { items: [record], total: 1 } } }));
	await page.route('**/prod-api/api/sysLangText/detail**', (route) => route.fulfill({ json: { code: 200, result: record } }));
});

test('translation CRUD and selection deletion preserve entity and ID contracts', async ({ page }, testInfo) => {
	await loginAdmin(page, 'langText');
	for (const endpoint of ['add', 'update', 'batchDelete', 'delete']) await page.route(`**/prod-api/api/sysLangText/${endpoint}`, (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑翻译', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('翻译内容', { exact: true })).toHaveValue('Users');
	await dialog.getByLabel('翻译内容', { exact: true }).fill('User Management');
	const [updated] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLangText/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(updated.postDataJSON()).toEqual({ ...record, content: 'User Management' });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '新增翻译', exact: true }).click();
	for (const [label, value] of [
		['所属实体名', 'SysOrg'],
		['字段名', 'Name'],
		['语言代码', 'en'],
		['翻译内容', 'Head Office'],
	])
		await dialog.getByLabel(label!, { exact: true }).fill(value!);
	await dialog.getByLabel('所属实体 ID', { exact: true }).fill('200');
	const [added] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLangText/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(added.postDataJSON()).toMatchObject({ entityName: 'SysOrg', entityId: 200, content: 'Head Office' });
	await expect(dialog).toBeHidden();
	await page.locator('tr[data-row-key="1"]').getByRole('checkbox').check();
	await page.getByRole('button', { name: '批量删除', exact: true }).click();
	const [removed] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLangText/batchDelete')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(removed.postDataJSON()).toEqual([{ id: 1 }]);
	await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeDisabled();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('translations.png'), fullPage: true });
});

test('selected translation export uses server workbook and UTF-8 filename', async ({ page }) => {
	await loginAdmin(page, 'langText');
	await page.route('**/prod-api/api/sysLangText/export', (route) =>
		route.fulfill({ body: spreadsheet, headers: { 'content-type': spreadsheetType, 'content-disposition': "attachment; filename*=UTF-8''%E7%BF%BB%E8%AF%91.xlsx" } })
	);
	await page.locator('tr[data-row-key="1"]').getByRole('checkbox').check();
	await page.getByRole('button', { name: '导出翻译', exact: true }).click();
	const [download, request] = await Promise.all([
		page.waitForEvent('download'),
		page.waitForRequest((req) => req.url().endsWith('/sysLangText/export')),
		page.getByRole('menuitem', { name: '导出选中数据', exact: true }).click(),
	]);
	expect(request.postDataJSON()).toMatchObject({ page: 1, selectKeyList: [1] });
	expect(download.suggestedFilename()).toBe('翻译.xlsx');
	expect(readFileSync((await download.path())!)).toEqual(spreadsheet);
});

test('translation import handles template, JSON errors and partial-error workbook', async ({ page }) => {
	await loginAdmin(page, 'langText');
	let result: 'error' | 'partial' | 'success' = 'error';
	await page.route('**/prod-api/api/sysLangText/import', async (route) => {
		if (route.request().method() === 'GET') return route.fulfill({ body: spreadsheet, headers: { 'content-type': spreadsheetType } });
		if (result === 'error') return route.fulfill({ json: { code: 400, message: '导入数据格式错误' } });
		if (result === 'success') return route.fulfill({ json: { code: 200, message: '导入成功' } });
		return route.fulfill({ body: spreadsheet, headers: { 'content-type': spreadsheetType, 'content-disposition': "attachment; filename*=UTF-8''errors.xlsx" } });
	});
	await page.getByRole('button', { name: '导入翻译', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '导入翻译' });
	const [template] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '下载模板', exact: true }).click()]);
	expect(template.suggestedFilename()).toBe('翻译表导入模板.xlsx');
	await dialog.locator('input[type=file]').setInputFiles({ name: 'translations.xlsx', mimeType: spreadsheetType, buffer: spreadsheet });
	const [request] = await Promise.all([
		page.waitForRequest((req) => req.method() === 'POST' && req.url().endsWith('/sysLangText/import')),
		dialog.getByRole('button', { name: '开始导入', exact: true }).click(),
	]);
	expect(request.headers()['content-type']).toContain('multipart/form-data; boundary=');
	expect(request.postData()).toContain('name="file"; filename="translations.xlsx"');
	await expect(dialog.getByRole('alert')).toContainText('导入数据格式错误');
	result = 'partial';
	await dialog.getByRole('button', { name: '开始导入', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('部分数据需要修正');
	const [errors] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '下载错误明细', exact: true }).click()]);
	expect(errors.suggestedFilename()).toBe('errors.xlsx');
	result = 'success';
	await dialog.getByRole('button', { name: '开始导入', exact: true }).click();
	await expect(dialog).toBeHidden();
});

test('translation read-only user cannot mutate or import', async ({ page }) => {
	await mockAdminSession(page, 'langText', { readOnly: true });
	await loginAdmin(page, 'langText');
	await expect(page.getByRole('cell', { name: 'Users', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /新增翻译|编辑翻译|删除翻译|批量删除|导入翻译|导出翻译/ })).toHaveCount(0);
});
