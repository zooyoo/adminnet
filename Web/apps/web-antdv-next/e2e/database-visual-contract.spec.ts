import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const connection = { configId: 'pg-test', dbNickName: '测试 PostgreSQL', dbType: 'PostgreSQL', canMoveColumn: false };
const graph = {
	visualTableList: [
		{ tableName: 'orders', tableComents: '订单', x: 0, y: 0 },
		{ tableName: 'users', tableComents: '用户', x: 420, y: 0 },
	],
	visualColumnList: [
		{ tableName: 'orders', columnName: 'user_id', dataType: 'bigint', dataLength: '', columnDescription: '用户' },
		{ tableName: 'users', columnName: 'id', dataType: 'bigint', dataLength: '', columnDescription: '主键' },
	],
	columnRelationList: [{ sourceTableName: 'orders', sourceColumnName: 'user_id', type: 'ONE_TO_MANY', targetTableName: 'users', targetColumnName: 'id' }],
};

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'database');
	await page.route('**/prod-api/api/sysDatabase/list', (route) => route.fulfill({ json: { code: 200, result: [connection] } }));
	await page.route('**/prod-api/api/sysDatabase/tableList/*', (route) => route.fulfill({ json: { code: 200, result: [{ name: 'orders', description: '订单' }] } }));
	await page.route('**/prod-api/api/sysDatabase/dbTypeList/*', (route) => route.fulfill({ json: { code: 200, result: ['bigint', 'varchar'] } }));
	await page.route('**/prod-api/api/sysDatabase/columnList/*/*', (route) => route.fulfill({ json: { code: 200, result: [{ tableName: 'orders', dbColumnName: 'user_id', dataType: 'bigint', isPrimarykey: false, isIdentity: false, isNullable: false, length: 0, decimalDigits: 0, columnDescription: '用户' }] } }));
	await page.route('**/prod-api/api/sysDatabase/visualDbTable*', (route) => route.fulfill({ json: { code: 200, result: graph } }));
});

async function select(page: import('@playwright/test').Page, label: string, text: string) {
	const input = page.getByRole('combobox', { name: label, exact: true });
	await input.click();
	await input.fill(text);
	const dropdown = page.locator('.ant-select-dropdown:visible');
	await dropdown.locator('.ant-select-item-option').filter({ hasText: text }).click();
	await expect(dropdown).toHaveCount(0);
}

test('关系图使用真实结构契约，定位、节点与连线交互可用', async ({ page }) => {
	await loginAdmin(page, 'database');
	await select(page, '数据库', connection.dbNickName);
	await select(page, '数据表', 'orders');
	await page.getByRole('button', { name: '查看关系图', exact: true }).click();
	await expect(page.locator('.database-visual-page')).toBeVisible();
	await expect(page.locator('.graph-node')).toHaveCount(2);
	await expect(page.locator('.graph-node').filter({ hasText: '订单' })).toHaveClass(/selected/);
	await expect(page.getByRole('button', { name: '查看表 users', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '适配画布', exact: true }).click();
	await page.getByRole('button', { name: '居中画布', exact: true }).click();
	await expect.poll(async () => (await page.locator('.relation-graph').boundingBox())?.height ?? 0).toBeGreaterThan(400);
	const stage = await page.locator('.visual-stage').boundingBox();
	const node = await page.locator('.graph-node').filter({ hasText: '订单' }).boundingBox();
	expect(node && stage && node.y >= stage.y && node.y + node.height <= stage.y + stage.height).toBe(true);
	await page.getByRole('button', { name: '查看表 users', exact: true }).click();
	await expect(page.locator('.selection-panel')).toContainText('users');
	await expect(page.locator('.graph-legend')).toContainText('外键关系');
});

test('关系图加载失败时保留错误边界且不显示旧图', async ({ page }) => {
	await page.route('**/prod-api/api/sysDatabase/visualDbTable*', (route) => route.fulfill({ status: 503, json: { message: '关系查询失败' } }));
	await loginAdmin(page, 'database');
	await select(page, '数据库', connection.dbNickName);
	await select(page, '数据表', 'orders');
	await page.getByRole('button', { name: '查看关系图', exact: true }).click();
	await expect(page.locator('.database-visual-page > .ant-alert')).toContainText('关系查询失败');
	await expect(page.locator('.graph-node')).toHaveCount(0);
});
