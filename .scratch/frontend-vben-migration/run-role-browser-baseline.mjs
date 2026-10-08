import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8')
	.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
assert.ok(password);
const db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
const role = db.prepare('SELECT * FROM SysRole WHERE Code = ?').get('isolated-online-read');
const queryMenu = db.prepare('SELECT * FROM SysMenu WHERE Permission = ?').get('sysPos:list');
const posMenu = db.prepare('SELECT * FROM SysMenu WHERE Path = ?').get('/system/pos');
assert.ok(role && queryMenu && posMenu);
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL(marker.baseUrl));
const browser = await chromium.launch({ channel: 'msedge' });
const report = { passed: false, proposalComplete: false, scenarios: [], pending: ['menu-runtime-flags', 'translation', 'custom-data-scope-results', 'complete-visual-review'] };
const contexts = [];
function grants() {
	return db.prepare('SELECT MenuId FROM SysRoleMenu WHERE RoleId = ?').all(role.Id).map((row) => String(row.MenuId));
}
async function login(page, account, path) {
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=${encodeURIComponent(path)}`);
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.getByLabel('账号', { exact: true }).fill(account);
	await page.getByLabel('密码', { exact: true }).fill(password);
	const response = page.waitForResponse((response) => response.url().endsWith('/sysAuth/login'));
	await page.locator('button[type=submit]').click();
	const result = await (await response).json();
	assert.equal(result.code, 200);
	await expect(page).toHaveURL(new RegExp(`#${path}$`), { timeout: 20_000 });
	return result.result;
}
function checkbox(page, dialog, title) {
	return dialog.locator('.ant-tree-treenode').filter({
		has: page.locator('.ant-tree-title').filter({ hasText: new RegExp(`^${title}$`) }),
	}).locator('.ant-tree-checkbox');
}
async function save(page, dialog) {
	const response = page.waitForResponse((response) => response.url().endsWith('/sysRole/update'));
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	assert.equal((await (await response).json()).code, 200);
	await expect(dialog).toBeHidden();
}
try {
	for (const device of [
		{ name: 'desktop', viewport: { width: 1440, height: 1000 } },
	]) {
		const context = await browser.newContext(device);
		contexts.push(context);
		const page = await context.newPage();
		page.setDefaultTimeout(20_000);
		const scenario = { device: device.name, passed: false, steps: [] };
		report.scenarios.push(scenario);
		try {
			const session = await login(page, 'superAdmin.NET', '/system/role');
			const prepared = await context.request.post(`${proxy.baseUrl}/prod-api/api/sysRole/grantMenu`, {
				headers: { Authorization: `Bearer ${session.accessToken}` }, data: { id: role.Id, menuIdList: [queryMenu.Id] },
			});
			assert.equal((await prepared.json()).code, 200);
			const leafGrants = grants().sort();
			const row = page.locator(`tr[data-row-key="${role.Id}"]`);
			await expect(row).toBeVisible();
			await page.reload();
			await expect(row).toBeVisible();
			await row.getByRole('button', { name: '编辑角色', exact: true }).click();
			const dialog = page.getByRole('dialog', { name: '编辑角色', exact: true });
			await expect(checkbox(page, dialog, posMenu.Title)).toHaveClass(/indeterminate/);
			await expect(checkbox(page, dialog, posMenu.Title)).not.toHaveClass(/checkbox-checked/);
			await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
			await expect(page.locator('.ant-message-notice')).toHaveCount(0);
			await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
			await checkbox(page, dialog, posMenu.Title).scrollIntoViewIfNeeded();
			await page.mouse.move(0, 0);
			await page.screenshot({ path: join(evidence, `role-${device.name}-editor.png`), fullPage: true, animations: 'disabled' });
			assert.ok(await dialog.getByRole('button', { name: /^确\s*定$/ }).evaluate((button) => {
				const rect = button.getBoundingClientRect();
				return rect.top >= 0 && rect.bottom <= innerHeight;
			}), 'Role editor confirmation must remain within the viewport.');
			await save(page, dialog);
			assert.ok(grants().includes(String(queryMenu.Id)));
			scenario.steps.push('real-partial-selection-roundtrip-and-refresh');

			await row.getByRole('button', { name: '编辑角色', exact: true }).click();
			await checkbox(page, dialog, posMenu.Title).click();
			await expect(checkbox(page, dialog, posMenu.Title)).toHaveClass(/checkbox-checked/);
			await save(page, dialog);
			const childIds = db.prepare('SELECT Id FROM SysMenu WHERE Pid = ?').all(posMenu.Id).map((row) => String(row.Id));
			assert.ok(childIds.every((id) => grants().includes(id)));
			scenario.steps.push('parent-select-all-persists-children');

			const targetContext = await browser.newContext(device);
			contexts.push(targetContext);
			const target = await targetContext.newPage();
			await login(target, 'TestUser3', '/system/pos');
			await expect(target.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
			await targetContext.close();
			scenario.steps.push('target-login-receives-real-button-permission');

			await row.getByRole('button', { name: '编辑角色', exact: true }).click();
			await expect(checkbox(page, dialog, posMenu.Title)).toHaveClass(/checkbox-checked/);
			await checkbox(page, dialog, posMenu.Title).click();
			await save(page, dialog);
			assert.deepEqual(grants(), []);
			scenario.steps.push('parent-uncheck-revokes-all');
			const revokedContext = await browser.newContext(device);
			contexts.push(revokedContext);
			const revokedPage = await revokedContext.newPage();
			await login(revokedPage, 'TestUser3', '/dashboard/notice');
			await revokedPage.goto(`${proxy.baseUrl}/#/system/pos`);
			await expect(revokedPage.getByRole('button', { name: '新增职位', exact: true })).toHaveCount(0);
			await expect(revokedPage.getByText('哎呀！未找到页面', { exact: true })).toBeVisible();
			await revokedPage.reload();
			await expect(revokedPage.getByText('哎呀！未找到页面', { exact: true })).toBeVisible();
			await revokedContext.close();
			scenario.steps.push('revoked-user-relogin-and-direct-refresh-denied');
			await row.getByRole('button', { name: '编辑角色', exact: true }).click();
			// 勾选精确叶子，避免同名“查询”按钮在其他模块中被选中。
			const queryNode = dialog.locator(`.ant-tree-checkbox[aria-labelledby$="-${queryMenu.Id}"]`);
			await queryNode.click();
			await save(page, dialog);
			assert.deepEqual(grants().sort(), leafGrants);
			scenario.steps.push('restore-leaf-permission');

			await row.getByRole('button', { name: '数据范围', exact: true }).click();
			const scope = page.getByRole('dialog', { name: '授权数据范围', exact: true });
			await expect(scope.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
			await scope.getByLabel('数据范围', { exact: true }).click();
			await page.getByRole('option', { name: '本部门数据', exact: true }).click();
			const response = page.waitForResponse((response) => response.url().endsWith('/sysRole/grantDataScope'));
			await scope.getByRole('button', { name: /^确\s*定$/ }).click();
			assert.equal((await (await response).json()).code, 200);
			await expect(scope).toBeHidden();
			assert.equal(db.prepare('SELECT DataScope FROM SysRole WHERE Id = ?').get(role.Id).DataScope, 3);
			scenario.steps.push('real-data-scope-save');

			await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
			await expect(page.locator('.ant-message-notice')).toHaveCount(0);
			await page.locator('.ant-table-content').evaluateAll((elements) => elements.forEach((element) => { element.scrollLeft = 0; }));
			await page.screenshot({ path: join(evidence, `role-${device.name}.png`), fullPage: true, animations: 'disabled' });
			await page.goto(`${proxy.baseUrl}/#/platform/menu`);
			await expect(page.getByRole('button', { name: '新增菜单', exact: true })).toBeVisible();
			await page.reload();
			await expect(page.getByRole('button', { name: '新增菜单', exact: true })).toBeVisible();
			await expect(page.locator('.admin-table tbody tr[data-row-key]').first()).toBeVisible();
			await expect(page.locator('.ant-message-notice')).toHaveCount(0);
			await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
			await page.screenshot({ path: join(evidence, 'menu-management-desktop.png'), fullPage: true, animations: 'disabled' });
			scenario.steps.push('legacy-platform-menu-direct-and-refresh');
			scenario.passed = true;
		} catch (error) {
			scenario.error = String(error.message).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
			await page.screenshot({ path: join(evidence, `role-${device.name}-failure.png`), fullPage: true, animations: 'disabled' }).catch(() => {});
			throw new Error(`${device.name}: role browser baseline failed; see report`);
		}
		await context.close();
	}
	report.passed = true;
} catch (error) {
	report.error = error.message;
	process.exitCode = 1;
} finally {
	for (const context of contexts) await context.close();
	await browser.close();
	await proxy.close();
	db.close();
	writeFileSync(join(evidence, 'role-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
