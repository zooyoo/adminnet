import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const { read, utils } = createRequire(import.meta.url)('xlsx-js-style');
const records = [
	{ id: 1, name: '内置配置', code: 'Builtin', value: 'True', sysFlag: 1, groupCode: 'core', orderNo: 1 },
	{ id: 2, name: '业务配置', code: 'Business', value: '=literal', sysFlag: 2, groupCode: 'business', orderNo: 2 },
];
for (const [module, prefix] of [
	['config', 'sysConfig'],
	['tenantConfig', 'sysTenantConfig'],
] as const) {
	test(`${module} keeps its API scope and protects built-in configuration`, async ({ page }, testInfo) => {
		await mockAdminSession(page, module, { superAdmin: true });
		await page.route(`**/prod-api/api/${prefix}/page`, (route) => route.fulfill({ json: { code: 200, result: { items: records, total: 2 } } }));
		await page.route(`**/prod-api/api/${prefix}/groupList`, (route) => route.fulfill({ json: { code: 200, result: ['core', 'business'] } }));
		for (const endpoint of ['add', 'update', 'delete', 'batchDelete']) await page.route(`**/prod-api/api/${prefix}/${endpoint}`, (route) => route.fulfill({ json: { code: 200 } }));
		await loginAdmin(page, module);
		const builtin = page.locator('tr[data-row-key="1"]');
		await expect(builtin.getByRole('button', { name: '删除配置', exact: true })).toBeDisabled();
		await expect(builtin.getByRole('checkbox')).toBeDisabled();
		await builtin.getByRole('button', { name: '编辑配置', exact: true }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByLabel('配置编码', { exact: true })).toBeDisabled();
		await expect(dialog.getByLabel('分组编码', { exact: true })).toBeDisabled();
		await dialog.getByRole('button', { name: '选项', exact: true }).click();
		await page.getByRole('menuitem', { name: 'False', exact: true }).click();
		const [updated] = await Promise.all([page.waitForRequest((req) => req.url().endsWith(`/${prefix}/update`)), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
		expect(updated.postDataJSON()).toMatchObject({ id: 1, code: 'Builtin', value: 'False', sysFlag: 1 });
		expect(new URL(updated.url()).pathname).toBe(`/prod-api/api/${prefix}/update`);
		await expect(dialog).toBeHidden();
		await page.getByRole('button', { name: '新增配置', exact: true }).click();
		await dialog.getByLabel('配置名称', { exact: true }).fill('新配置');
		await dialog.getByLabel('配置编码', { exact: true }).fill('NewConfig');
		await dialog.getByLabel('值', { exact: true }).fill('hello');
		const [added] = await Promise.all([page.waitForRequest((req) => req.url().endsWith(`/${prefix}/add`)), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
		expect(added.postDataJSON()).toMatchObject({ name: '新配置', code: 'NewConfig', value: 'hello', sysFlag: 2 });
		await expect(dialog).toBeHidden();
		await page.locator('tr[data-row-key="2"]').getByRole('checkbox').check();
		await page.getByRole('button', { name: '批量删除', exact: true }).click();
		const [deleted] = await Promise.all([page.waitForRequest((req) => req.url().endsWith(`/${prefix}/batchDelete`)), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
		expect(deleted.postDataJSON()).toEqual([2]);
		await expect(page.getByRole('button', { name: '批量删除', exact: true })).toBeDisabled();
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.screenshot({ path: testInfo.outputPath(`${module}.png`), fullPage: true });
	});
}

test('configuration export follows filters and visible columns without changing page state', async ({ page }) => {
	await mockAdminSession(page, 'config');
	const exportQueries: Record<string, unknown>[] = [];
	await page.route('**/prod-api/api/sysConfig/page', (route) => {
		const body = route.request().postDataJSON();
		if (body.pageSize === 500) exportQueries.push(body);
		return route.fulfill({ json: { code: 200, result: { items: body.pageSize === 500 ? (body.page === 1 ? [records[0]] : [records[1]]) : records, total: 2 } } });
	});
	await page.route('**/prod-api/api/sysConfig/groupList', (route) => route.fulfill({ json: { code: 200, result: ['core'] } }));
	await loginAdmin(page, 'config');
	await page.getByRole('textbox', { name: /配置名称/ }).fill('filter');
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	await page.getByRole('button', { name: '列设置', exact: true }).click();
	await page.getByRole('checkbox', { name: '配置编码', exact: true }).uncheck();
	await page.getByRole('button', { name: '列设置', exact: true }).click();
	await page.getByRole('button', { name: '导出数据', exact: true }).click();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: '导出全部数据', exact: true }).click()]);
	expect(download.suggestedFilename()).toBe('系统参数.xlsx');
	const workbook = read(readFileSync((await download.path())!), { type: 'buffer' });
	const rows = utils.sheet_to_json(workbook.Sheets.Data!, { header: 1 });
	expect(rows).toEqual([
		['配置名称', '属性值', '内置参数', '分组编码', '排序'],
		['内置配置', 'True', '是', 'core', 1],
		['业务配置', '=literal', '否', 'business', 2],
	]);
	expect(exportQueries.map((query) => query.page)).toEqual([1, 2]);
	expect(exportQueries.every((query) => query.name === 'filter' && query.order === 'ascending')).toBe(true);
	await expect(page.getByRole('textbox', { name: /配置名称/ })).toHaveValue('filter');
});

test('configuration printing renders an escaped real print document', async ({ page }) => {
	await mockAdminSession(page, 'config');
	await page.route('**/prod-api/api/sysConfig/page', (route) => route.fulfill({ json: { code: 200, result: { items: [{ ...records[1], value: '<img src=x onerror=alert(1)>' }], total: 1 } } }));
	await page.route('**/prod-api/api/sysConfig/groupList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await page.goto('/#/auth/login');
	await page.addInitScript(() => {
		window.print = () => {
			(window as Window & { printInvoked?: boolean }).printInvoked = true;
		};
	});
	await loginAdmin(page, 'config');
	await page.getByRole('button', { name: '打印', exact: true }).click();
	const frame = page.frameLocator('#printJS');
	await expect(frame.locator('h1')).toHaveText('系统参数');
	await expect(frame.locator('td').filter({ hasText: '<img src=x onerror=alert(1)>' })).toHaveText('<img src=x onerror=alert(1)>');
	await expect(frame.locator('img')).toHaveCount(0);
});

test('read-only configuration hides mutations but retains read-only export', async ({ page }) => {
	await mockAdminSession(page, 'config', { readOnly: true });
	await page.route('**/prod-api/api/sysConfig/page', (route) => route.fulfill({ json: { code: 200, result: { items: records, total: 2 } } }));
	await page.route('**/prod-api/api/sysConfig/groupList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await loginAdmin(page, 'config');
	await expect(page.getByRole('cell', { name: 'Business', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: /新增配置|编辑配置|删除配置|批量删除/ })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '导出数据', exact: true })).toBeVisible();
});

test('configuration export failure never downloads a partial workbook', async ({ page }) => {
	await mockAdminSession(page, 'config');
	let downloads = 0;
	page.on('download', () => {
		downloads += 1;
	});
	await page.route('**/prod-api/api/sysConfig/page', (route) => {
		const query = route.request().postDataJSON();
		if (query.pageSize === 500 && query.page === 2) return route.fulfill({ json: { code: 400, message: '导出分页失败' } });
		return route.fulfill({ json: { code: 200, result: { items: query.pageSize === 500 ? [records[0]] : records, total: 2 } } });
	});
	await page.route('**/prod-api/api/sysConfig/groupList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await loginAdmin(page, 'config');
	await page.getByRole('button', { name: '导出数据', exact: true }).click();
	await page.getByRole('menuitem', { name: '导出全部数据', exact: true }).click();
	await expect(page.getByText('导出分页失败', { exact: true }).first()).toBeVisible();
	await expect(page.getByRole('button', { name: '导出数据', exact: true })).not.toHaveClass(/ant-btn-loading/);
	expect(downloads).toBe(0);
});
