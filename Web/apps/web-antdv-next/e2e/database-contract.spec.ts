import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const connection = { configId: 'pg-test', dbNickName: '测试 PostgreSQL', dbType: 'PostgreSQL', canMoveColumn: false };
const columns = [
	{ dbColumnName: 'Id', dataType: 'bigint', isPrimarykey: true, isIdentity: true, isNullable: false, length: 0 },
	{ dbColumnName: 'Title', dataType: 'varchar', length: 64, defaultValue: "'initial'", columnDescription: '标题', isNullable: true },
];
test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'database');
	await page.route('**/prod-api/api/sysDatabase/list', (route) => route.fulfill({ json: { code: 200, result: [connection] } }));
	await page.route('**/prod-api/api/sysDatabase/tableList/*', (route) => route.fulfill({ json: { code: 200, result: [{ name: 'Sample', description: '中文描述' }] } }));
	await page.route('**/prod-api/api/sysDatabase/dbTypeList/*', (route) => route.fulfill({ json: { code: 200, result: ['bigint', 'varchar', 'numeric', 'text'] } }));
	await page.route('**/prod-api/api/sysDatabase/columnList/*/*', (route) => route.fulfill({ json: { code: 200, result: columns } }));
	await page.route('**/prod-api/api/sysDatabase/generationOptions', (route) => route.fulfill({ json: { code: 200, result: { namespaces: ['Admin.NET.Application'], baseClasses: ['EntityBase'] } } }));
	await page.route('**/prod-api/api/sysDatabase/previewEntity', (route) => route.fulfill({ json: { code: 200, result: { fileName: 'Sample.cs', relativePath: 'Admin.NET.Application/Entity/Sample.cs', content: 'public class Sample {}', hash: 'entity-hash', fileExists: false } } }));
	await page.route('**/prod-api/api/sysDatabase/createEntity', (route) => route.fulfill({ json: { code: 200 } }));
	await page.route('**/prod-api/api/sysDatabase/previewSeedData', (route) => route.fulfill({ json: { code: 200, result: { fileName: 'SampleSeedData.cs', relativePath: 'Admin.NET.Application/SeedData/SampleSeedData.cs', content: 'public class SampleSeedData {}', hash: 'seed-hash', fileExists: false } } }));
	await page.route('**/prod-api/api/sysDatabase/createSeedData', (route) => route.fulfill({ json: { code: 200 } }));
});
async function select(page: import('@playwright/test').Page, label: string, text: string) {
	const input = page.getByRole('combobox', { name: label, exact: true });
	await input.click();
	await input.fill(text);
	const dropdown = page.locator('.ant-select-dropdown:visible');
	await dropdown.locator('.ant-select-item-option').filter({ hasText: text }).click();
	await expect(dropdown).toHaveCount(0);
}
async function enter(page: import('@playwright/test').Page) {
	await loginAdmin(page, 'database');
	await select(page, '数据库', '测试 PostgreSQL');
	await select(page, '数据表', 'Sample');
	await expect(page.locator('tr[data-row-key="Title"]')).toBeVisible();
}
test('编辑字段失败保留草稿，既有类型约束不改写，默认值未改不发送', async ({ page }) => {
	await page.route('**/prod-api/api/sysDatabase/updateColumn', (route) => {
		expect(route.request().postDataJSON()).toEqual({ configId: connection.configId, tableName: 'Sample', oldColumnName: 'Title', columnName: 'Renamed', description: '草稿描述' });
		return route.fulfill({ json: { code: 403, message: '没有字段编辑权限' } });
	});
	await enter(page);
	await page.getByRole('button', { name: '编辑 Title', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '编辑字段', exact: true });
	await expect(editor.getByLabel('字段 1 类型', { exact: true })).toBeDisabled();
	await editor.getByLabel('字段 1 字段名', { exact: true }).fill('Renamed');
	await editor.getByLabel('字段 1 描述', { exact: true }).fill('草稿描述');
	await editor.getByRole('button', { name: '保存结构', exact: true }).click();
	await page.getByRole('dialog', { name: '确认保存结构', exact: true }).getByRole('button', { name: '确认执行', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('没有字段编辑权限');
	await expect(editor.getByLabel('字段 1 字段名', { exact: true })).toHaveValue('Renamed');
	await expect(editor.getByRole('button', { name: '保存结构', exact: true })).toBeEnabled();
});
test('建表校验与取消隔离，新草稿不复用旧输入', async ({ page }) => {
	await enter(page);
	await page.getByRole('button', { name: '增加表', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '增加表', exact: true });
	await editor.getByRole('button', { name: '保存结构', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('表名称');
	await editor.getByLabel('表名称', { exact: true }).fill('Unsaved');
	await editor.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.getByRole('button', { name: '增加表', exact: true }).click();
	await expect(editor.getByLabel('表名称', { exact: true })).toHaveValue('');
});
test('建表保存后立即改表，每次保存使用当前模式', async ({ page }) => {
	let created = false;
	await page.route('**/prod-api/api/sysDatabase/tableList/*', (route) =>
		route.fulfill({ json: { code: 200, result: [{ name: 'Sample', description: '中文描述' }, ...(created ? [{ name: 'Created', description: '新建' }] : [])] } })
	);
	await page.route('**/prod-api/api/sysDatabase/addTable', (route) => {
		created = true;
		return route.fulfill({ json: { code: 200 } });
	});
	await page.route('**/prod-api/api/sysDatabase/updateTable', (route) => route.fulfill({ json: { code: 200 } }));
	await enter(page);
	await page.getByRole('button', { name: '增加表', exact: true }).click();
	const add = page.getByRole('dialog', { name: '增加表', exact: true });
	await add.getByLabel('表名称', { exact: true }).fill('Created');
	await add.getByRole('button', { name: '保存结构', exact: true }).click();
	await page.getByRole('dialog', { name: '确认保存结构', exact: true }).getByRole('button', { name: '确认执行', exact: true }).click();
	await expect(add).toBeHidden();
	await expect(page.locator('.database-page h2')).toHaveText('Created');
	await page.getByRole('button', { name: '编辑表', exact: true }).click();
	const edit = page.getByRole('dialog', { name: '编辑表', exact: true });
	await edit.getByLabel('表描述', { exact: true }).fill('修改');
	await edit.getByRole('button', { name: '保存结构', exact: true }).click();
	const [result] = await Promise.all([
		page.waitForResponse('**/sysDatabase/updateTable'),
		page.getByRole('dialog', { name: '确认保存结构', exact: true }).getByRole('button', { name: '确认执行', exact: true }).click(),
	]);
	expect(result.request().postDataJSON()).toMatchObject({ oldTableName: 'Created', tableName: 'Created', description: '修改' });
	await expect(edit).toBeHidden();
});
test('删除确认包含完整目标，失败不显示成功', async ({ page }) => {
	await page.route('**/prod-api/api/sysDatabase/deleteColumn', (route) => route.fulfill({ status: 503, json: { message: '测试数据库不可达' } }));
	await enter(page);
	await page.getByRole('button', { name: '删除 Title', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确认删除字段', exact: true });
	await expect(dialog).toContainText('测试 PostgreSQL / Sample / Title');
	await dialog.getByRole('button', { name: '确认执行', exact: true }).click();
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(page.locator('tr[data-row-key="Title"]')).toBeVisible();
	await expect(page.locator('.ant-message-success')).toHaveCount(0);
});
test('PostgreSQL 顺序能力与旧禁用删除表策略保持一致', async ({ page }) => {
	await enter(page);
	await expect(page.getByRole('button', { name: '上移 Title', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: '下移 Id', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: '删除表', exact: true })).toBeDisabled();
});
test('只读授权不显示写入入口', async ({ page }) => {
	await mockAdminSession(page, 'database', { readOnly: true });
	await enter(page);
	await expect(page.getByRole('button', { name: '增加表', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '编辑 Title', exact: true })).toHaveCount(0);
	await expect(page.getByRole('button', { name: '删除 Title', exact: true })).toHaveCount(0);
});
test('字段查询失败禁止按未确认结构修改', async ({ page }) => {
	await page.route('**/prod-api/api/sysDatabase/columnList/*/*', (route) => route.fulfill({ status: 503, json: { message: '字段查询失败' } }));
	await loginAdmin(page, 'database');
	await select(page, '数据库', '测试 PostgreSQL');
	await select(page, '数据表', 'Sample');
	await expect(page.locator('.database-page > .ant-alert')).toBeVisible();
	await expect(page.getByRole('button', { name: '编辑表', exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: '增加字段', exact: true })).toBeDisabled();
});

test('实体与种子生成先预览，确认后沿用当前连接和表上下文', async ({ page }) => {
	await enter(page);
	await page.getByRole('button', { name: '生成实体', exact: true }).click();
	const entity = page.getByRole('dialog', { name: '生成实体', exact: true });
	await expect(entity.getByRole('combobox', { name: '存放位置', exact: true })).toBeVisible();
	await entity.getByRole('button', { name: '预览代码', exact: true }).click();
	await expect(entity.locator('.code-preview')).toContainText('public class Sample');
	await entity.getByRole('button', { name: '生成文件', exact: true }).click();
	const confirm = page.getByRole('dialog', { name: '确认生成文件', exact: true });
	await confirm.getByRole('button', { name: '确认生成', exact: true }).click();
	await expect(entity).toBeHidden();
	await page.getByRole('button', { name: '生成种子', exact: true }).click();
	const seed = page.getByRole('dialog', { name: '生成种子数据', exact: true });
	await seed.getByRole('button', { name: '预览代码', exact: true }).click();
	await expect(seed.locator('.code-preview')).toContainText('SampleSeedData');
});

test('生成失败保留预览与表单，修改字段后旧预览不能提交', async ({ page }) => {
	await page.route('**/prod-api/api/sysDatabase/createEntity', (route) => {
		expect(route.request().postDataJSON()).toMatchObject({ configId: 'pg-test', tableName: 'Sample', expectedHash: 'entity-hash', overwriteExisting: false });
		return route.fulfill({ status: 409, json: { message: '目标文件已变化' } });
	});
	await enter(page);
	await page.getByRole('button', { name: '生成实体', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '生成实体', exact: true });
	await editor.getByRole('button', { name: '预览代码', exact: true }).click();
	await expect(editor.locator('.code-preview')).toBeVisible();
	await editor.getByRole('button', { name: '生成文件', exact: true }).click();
	const confirm = page.getByRole('dialog', { name: '确认生成文件', exact: true });
	await confirm.getByRole('button', { name: '确认生成', exact: true }).click();
	await expect(confirm.getByRole('alert')).toContainText('目标文件已变化');
	await confirm.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(editor.locator('.code-preview')).toBeVisible();
	await editor.getByLabel('实体名称', { exact: true }).fill('Changed');
	await expect(editor.locator('.code-preview')).toHaveCount(0);
	await expect(editor.getByRole('button', { name: '生成文件', exact: true })).toBeDisabled();
});
