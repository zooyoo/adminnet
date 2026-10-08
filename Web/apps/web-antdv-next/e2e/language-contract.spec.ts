import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const english = {
	id: 1,
	name: 'English',
	code: 'en',
	isoCode: 'en',
	urlCode: 'en-US',
	direction: 1,
	dateFormat: 'MM/dd/yyyy',
	timeFormat: 'HH:mm',
	weekStart: 7,
	grouping: '[3,0]',
	decimalPoint: '.',
	thousandsSep: ',',
	active: true,
};
test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'lang');
	await page.route('**/prod-api/api/sysLang/page', (route) => route.fulfill({ json: { code: 200, result: { items: [english], total: 1 } } }));
	await page.route('**/prod-api/api/sysLang/detail**', (route) => route.fulfill({ json: { code: 200, result: english } }));
});
test('language editor loads full details and preserves false booleans and formatting fields', async ({ page }, testInfo) => {
	await loginAdmin(page, 'lang');
	await page.route('**/prod-api/api/sysLang/update', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑语言', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('日期格式', { exact: true })).toHaveValue('MM/dd/yyyy');
	await dialog.getByLabel('语言名称', { exact: true }).fill('English Updated');
	await dialog.getByRole('switch', { name: '是否启用', exact: true }).uncheck();
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLang/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toEqual({ ...english, name: 'English Updated', active: false });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '高级查询', exact: true }).click();
	await page.getByRole('combobox', { name: /是否启用/ }).click();
	await page.getByRole('option', { name: '否', exact: true }).click();
	const [query] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLang/page')), page.getByRole('button', { name: /^查\s*询$/ }).click()]);
	expect(query.postDataJSON()).toMatchObject({ active: false, field: 'active', order: 'descending' });
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('languages.png'), fullPage: true });
});
test('language creation requires all configured fields and deletion uses the selected ID', async ({ page }) => {
	await loginAdmin(page, 'lang');
	await page.route('**/prod-api/api/sysLang/add', (route) => route.fulfill({ json: { code: 200, result: 2 } }));
	await page.route('**/prod-api/api/sysLang/delete', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '新增语言', exact: true }).click();
	const dialog = page.getByRole('dialog');
	for (const [label, value] of [
		['语言名称', 'Deutsch'],
		['语言代码', 'de'],
		['ISO 语言代码', 'de'],
		['URL 语言代码', 'de-DE'],
		['日期格式', 'dd.MM.yyyy'],
		['时间格式', 'HH:mm'],
		['分组符号', '[3,0]'],
		['小数点符号', ','],
	]) {
		await dialog.getByLabel(label!, { exact: true }).fill(value!);
	}
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLang/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ name: 'Deutsch', code: 'de', active: false, direction: 1, weekStart: 7 });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '删除语言', exact: true }).click();
	const [removed] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLang/delete')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(removed.postDataJSON()).toEqual({ id: 1 });
});
