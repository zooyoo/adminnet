import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const types = [
	{ id: 10, name: '业务状态', code: 'business_status', sysFlag: 2, isTenant: 2, status: 1, orderNo: 100 },
	{ id: 20, name: '内置状态', code: 'StatusEnum', sysFlag: 1, isTenant: 2, status: 1, orderNo: 100 },
];
const values = [{ id: 101, dictTypeId: 10, label: '已完成', value: 'done', code: 'DONE', tagType: 'success', status: 1, orderNo: 100, extData: '{"checked":true}' }];
test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'dict');
	await page.route('**/prod-api/api/sysDictType/page', (route) => route.fulfill({ json: { code: 200, result: { items: types, total: 2 } } }));
	await page.route('**/prod-api/api/sysDictData/page', (route) =>
		route.fulfill({ json: { code: 200, result: { items: values.map((value) => ({ ...value, dictTypeId: route.request().postDataJSON().dictTypeId })), total: 1 } } })
	);
});

test('selecting a dictionary loads its values and edits preserve style and extension data', async ({ page }, testInfo) => {
	await loginAdmin(page, 'dict');
	let cacheRefreshes = 0;
	await page.route('**/prod-api/api/sysDictType/allDictList', (route) => {
		cacheRefreshes += 1;
		return route.fulfill({ json: { code: 200, result: {} } });
	});
	await page.route('**/prod-api/api/sysDictData/update', (route) => route.fulfill({ json: { code: 200 } }));
	const [query] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysDictData/page')), page.getByRole('button', { name: '业务状态', exact: true }).click()]);
	expect(query.postDataJSON()).toMatchObject({ dictTypeId: 10, page: 1, pageSize: 50 });
	await page.getByRole('button', { name: '编辑字典值', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('扩展数据', { exact: true })).toHaveValue('{"checked":true}');
	await dialog.getByLabel('显示文本', { exact: true }).fill('完成');
	await dialog.getByLabel('样式 Style', { exact: true }).fill('font-weight:600');
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysDictData/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ id: 101, dictTypeId: 10, label: '完成', tagType: 'success', styleSetting: 'font-weight:600', extData: '{"checked":true}' });
	await expect(dialog).toBeHidden();
	await expect.poll(() => cacheRefreshes).toBe(1);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('dictionary.png'), fullPage: true });
});

test('dictionary value deletion reloads the selected type and sorting keeps the backend vocabulary', async ({ page }) => {
	await loginAdmin(page, 'dict');
	await page.route('**/prod-api/api/sysDictData/delete', (route) => route.fulfill({ json: { code: 200 } }));
	const [sort] = await Promise.all([
		page.waitForRequest((req) => req.url().endsWith('/sysDictType/page')),
		page
			.locator('.dict-types')
			.getByRole('columnheader', { name: /字典名称/ })
			.click(),
	]);
	expect(sort.postDataJSON()).toMatchObject({ field: 'name', order: 'ascending', page: 1 });
	await page.getByRole('button', { name: '业务状态', exact: true }).click();
	await page.getByRole('button', { name: '删除字典值', exact: true }).click();
	const [removed] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysDictData/delete')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(removed.postDataJSON()).toEqual({ id: 101 });
});

test('system dictionary restrictions prevent structural changes but allow display customization', async ({ page }) => {
	await loginAdmin(page, 'dict');
	const builtin = page.locator('.dict-types tr[data-row-key="20"]');
	await expect(builtin.getByRole('button', { name: '编辑字典', exact: true })).toBeDisabled();
	await expect(builtin.getByRole('button', { name: '删除字典', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: '内置状态', exact: true }).click();
	await expect(page.getByRole('button', { name: '新增字典值', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: '复制字典值', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: '编辑字典值', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByLabel('字典值', { exact: true })).toBeDisabled();
	await expect(dialog.getByLabel('编码', { exact: true })).toBeDisabled();
	await expect(dialog.getByLabel('显示文本', { exact: true })).toBeEnabled();
});

test('dictionary and copied values use separate create contracts and refreshed cache', async ({ page }) => {
	await loginAdmin(page, 'dict');
	await page.route('**/prod-api/api/sysDictType/add', (route) => route.fulfill({ json: { code: 200 } }));
	await page.route('**/prod-api/api/sysDictData/add', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '新增字典', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('字典名称', { exact: true }).fill('新字典');
	await dialog.getByLabel('字典编码', { exact: true }).fill('new_dict');
	const [type] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysDictType/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(type.postDataJSON()).toMatchObject({ name: '新字典', code: 'new_dict', sysFlag: 2, isTenant: 2 });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '业务状态', exact: true }).click();
	await page.getByRole('button', { name: '复制字典值', exact: true }).click();
	await dialog.getByLabel('字典值', { exact: true }).fill('copied');
	const [data] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysDictData/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(data.postDataJSON()).toMatchObject({ dictTypeId: 10, label: '已完成', value: 'copied' });
	expect(data.postDataJSON()).not.toHaveProperty('id');
});

test('deleting a selected dictionary clears its values and cannot delete a system dictionary even as superadmin', async ({ page }) => {
	await mockAdminSession(page, 'dict', { superAdmin: true });
	await page.route('**/prod-api/api/sysDictType/delete', (route) => route.fulfill({ json: { code: 200 } }));
	await loginAdmin(page, 'dict');
	await expect(page.locator('.dict-types tr[data-row-key="20"]').getByRole('button', { name: '删除字典', exact: true })).toBeDisabled();
	await page.getByRole('button', { name: '业务状态', exact: true }).click();
	await expect(page.locator('.dict-values').getByRole('cell', { name: 'done', exact: true })).toBeVisible();
	await page.locator('.dict-types tr[data-row-key="10"]').getByRole('button', { name: '删除字典', exact: true }).click();
	await page.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.locator('.dict-values').getByRole('cell', { name: 'done', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '新增字典值', exact: true })).toBeDisabled();
});
