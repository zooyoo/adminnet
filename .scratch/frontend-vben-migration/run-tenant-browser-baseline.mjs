import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const apiUrl = new URL(marker.baseUrl);
assert.equal(apiUrl.hostname, '127.0.0.1');
assert.equal(apiUrl.protocol, 'http:');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const report = { passed: false, cleanupPassed: false, proposalComplete: false, steps: [] };
const account = `browser07-${Date.now()}`;
let proxy, browser, context, page, db, session;
let stage = 'initialize';
let serviceStopped = false;
const errors = [];
const extraSessions = [];
const tenant = (name = account) => db.prepare('SELECT t.* FROM SysTenant t JOIN SysUser u ON u.Id = t.UserId WHERE u.Account = ?').get(name);
function saveReport() {
	writeFileSync(join(evidence, 'tenant-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
}
async function api(path, data) {
	const response = await fetch(new URL(`/api/${path}`, apiUrl), {
		method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` },
		body: JSON.stringify(data), signal: AbortSignal.timeout(20_000),
	});
	if (response.headers.get('access-token')) {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	assert.equal((await response.json()).code, 200, path);
}
async function save(dialog, endpoint) {
	const [response] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith(`/api/${endpoint}`) && item.request().method() === 'POST'),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	assert.equal((await response.json()).code, 200);
	await expect(dialog).toBeHidden();
}
async function more(title) {
	await page.locator(`tr[data-row-key="${tenant().Id}"]`).getByRole('button', { name: '更多租户操作' }).click();
	await page.getByRole('menuitem', { name: title, exact: true }).click();
}
async function screenshot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.locator('.ant-table-content, .ant-table-body').evaluateAll((elements) => elements.forEach((element) => { element.scrollLeft = 0; }));
	await page.screenshot({ path: join(evidence, name), fullPage: true, animations: 'disabled' });
}
try {
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	proxy = await startProductionProxy(join(root, 'Web/dist'), apiUrl);
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
	page.on('pageerror', (error) => errors.push(error.name));
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	stage = 'production-login-tenant-route';
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fplatform%2Ftenant`);
	await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
	await page.getByLabel('密码', { exact: true }).fill(password);
	const [loginResponse] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith('/sysAuth/login')),
		page.locator('button[type=submit]').click(),
	]);
	const login = await loginResponse.json();
	assert.equal(login.code, 200);
	session = login.result;
	await expect(page).toHaveURL(/#\/platform\/tenant$/);
	report.steps.push(stage);

	stage = 'tenant-create-validation-and-persistence';
	await page.getByRole('button', { name: '新增租户', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '添加租户', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByText('请输入租户名称', { exact: true })).toBeVisible();
	await dialog.getByLabel('租户名称', { exact: true }).fill(account);
	await dialog.getByLabel('租管账号', { exact: true }).fill(account);
	await dialog.getByLabel('电话', { exact: true }).fill(`139${String(Date.now()).slice(-8)}`);
	await save(dialog, 'sysTenant/add');
	assert.ok(tenant());
	report.steps.push(stage);

	stage = 'tenant-edit-and-reopen';
	await page.locator('form[name="tenant-query"]').getByLabel('租户名称', { exact: true }).fill(account);
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	let row = page.locator(`tr[data-row-key="${tenant().Id}"]`);
	await row.getByRole('button', { name: '编辑租户' }).click();
	dialog = page.getByRole('dialog', { name: '编辑租户', exact: true });
	await dialog.getByLabel('备注', { exact: true }).fill('桌面真实租户编辑');
	await screenshot('tenant-desktop-editor.png');
	await save(dialog, 'sysTenant/update');
	assert.equal(tenant().Remark, '桌面真实租户编辑');
	await row.getByRole('button', { name: '编辑租户' }).click();
	await expect(dialog.getByLabel('备注', { exact: true })).toHaveValue('桌面真实租户编辑');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await screenshot('tenant-desktop-list.png');
	report.steps.push(stage);

	stage = 'tenant-menu-load-and-save';
	await more('授权菜单');
	dialog = page.getByRole('dialog', { name: `授权菜单：${account}`, exact: true });
	await expect(dialog.getByRole('tree')).toBeVisible();
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await screenshot('tenant-desktop-menu.png');
	await save(dialog, 'sysTenant/grantMenu');
	report.steps.push(stage);

	stage = 'tenant-menu-revoke-all-and-restore';
	const originalGrants = db.prepare('SELECT MenuId FROM SysTenantMenu WHERE TenantId = ?').all(tenant().Id).map((entry) => entry.MenuId);
	await more('授权菜单');
	await expect(dialog.getByRole('tree')).toBeVisible();
	let clicks = 0;
	while (await dialog.locator('.ant-tree-checkbox-checked').count()) {
		assert.ok(++clicks < 200, 'Menu selection must converge to empty.');
		await dialog.locator('.ant-tree-checkbox-checked').first().click();
	}
	await save(dialog, 'sysTenant/grantMenu');
	assert.equal(db.prepare('SELECT COUNT(*) AS count FROM SysTenantMenu WHERE TenantId = ?').get(tenant().Id).count, 0);
	await api('sysTenant/grantMenu', { id: tenant().Id, menuIdList: originalGrants });
	report.steps.push(stage);

	stage = 'tenant-reset-password-confirmation';
	await more('重置密码');
	await save(page.getByRole('dialog').filter({ hasText: `确定为“${account}”重置租管密码？` }), 'sysTenant/resetPwd');
	dialog = page.getByRole('dialog', { name: '租管密码已重置', exact: true });
	await expect(dialog.getByLabel('重置后的密码')).not.toHaveValue('');
	await dialog.getByRole('button', { name: '关闭', exact: true }).click();
	report.steps.push(stage);

	stage = 'tenant-status-toggle';
	row = page.locator(`tr[data-row-key="${tenant().Id}"]`);
	const [statusResponse] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith('/sysTenant/setStatus')),
		row.getByRole('switch').click(),
	]);
	assert.equal((await statusResponse.json()).code, 200);
	assert.equal(tenant().Status, 2);
	await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysTenant/setStatus')), row.getByRole('switch').click()]);
	assert.equal(tenant().Status, 1);
	report.steps.push(stage);

	stage = 'database-create-confirmation-and-light-theme';
	const databasePath = join(runtime, `${account}-db.db`);
	await api('sysTenant/add', {
		name: `${account}-db`, adminAccount: `${account}-db`, tenantType: 1, dbType: 2,
		connection: `Data Source=${databasePath}`, status: 1, enableReg: 2,
	});
	const databaseTenant = tenant(`${account}-db`);
	assert.ok(databaseTenant);
	await page.locator('form[name="tenant-query"]').getByLabel('租户名称', { exact: true }).fill(`${account}-db`);
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	await page.locator(`tr[data-row-key="${databaseTenant.Id}"]`).getByRole('button', { name: '创建数据库', exact: true }).click();
	await save(page.getByRole('dialog').filter({ hasText: `确定为“${account}-db”创建数据库？` }), 'sysTenant/createDb');
	const businessDb = new DatabaseSync(databasePath, { readOnly: true });
	try { assert.equal(businessDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok'); }
	finally { businessDb.close(); }
	if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) await page.getByRole('button', { name: 'light', exact: true }).click();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await screenshot('tenant-desktop-light-database.png');
	report.steps.push(stage);
	stage = 'real-candidate-profile-failure-preserves-original-session';
	let candidateToken;
	let transitionError;
	const transition = async (route) => {
		try {
			// 转发真实切换响应前删除本脚本的测试租户，制造真实资料失效，未伪造 API 内容。
			const response = await route.fetch();
			const body = await response.json();
			assert.equal(body.code, 200);
			candidateToken = body.result.accessToken;
			await api('sysTenant/delete', { id: databaseTenant.Id });
			await route.fulfill({ response });
		} catch (error) {
			transitionError = error.name;
			await route.abort();
		}
	};
	await page.route('**/prod-api/api/sysTenant/goTenant', transition);
	try {
		await page.locator(`tr[data-row-key="${databaseTenant.Id}"]`).getByRole('button', { name: '更多租户操作' }).click();
		await page.getByRole('menuitem', { name: '进入租管端', exact: true }).click();
		const [profile] = await Promise.all([
			page.waitForResponse((item) => item.url().endsWith('/sysAuth/userInfo') && item.request().headers().authorization === `Bearer ${candidateToken}`),
			page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/ }).click(),
		]);
		assert.equal(transitionError, undefined);
		assert.ok(profile.status() === 401 || (await profile.json()).code === 401);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		await expect(page).toHaveURL(/#\/platform\/tenant$/);
		await expect(page.getByRole('button', { name: '新增租户', exact: true })).toBeVisible();
		const [originalRequest] = await Promise.all([
			page.waitForResponse((item) => item.url().endsWith('/sysTenant/page')),
			page.getByRole('button', { name: /^查\s*询$/ }).click(),
		]);
		assert.equal((await originalRequest.json()).code, 200);
		assert.notEqual(originalRequest.request().headers().authorization, `Bearer ${candidateToken}`);
	} finally { await page.unroute('**/prod-api/api/sysTenant/goTenant', transition); }
	assert.equal(tenant(`${account}-db`), undefined);
	await page.locator('form[name="tenant-query"]').getByLabel('租户名称', { exact: true }).fill(account);
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	report.steps.push(stage);

	stage = 'production-switch-and-enter-tenant';
	for (const [label, endpoint] of [['切换租户', 'changeTenant'], ['进入租管端', 'goTenant']]) {
		const identityContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
		try {
			const identityPage = await identityContext.newPage();
			await identityPage.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fplatform%2Ftenant`);
			await identityPage.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
			await identityPage.getByLabel('密码', { exact: true }).fill(password);
			await identityPage.locator('button[type=submit]').click();
			await expect(identityPage).toHaveURL(/#\/platform\/tenant$/);
			await identityPage.locator(`tr[data-row-key="${tenant().Id}"]`).getByRole('button', { name: '更多租户操作' }).click();
			await identityPage.getByRole('menuitem', { name: label, exact: true }).click();
			const [switched, info] = await Promise.all([
				identityPage.waitForResponse((item) => item.url().endsWith(`/sysTenant/${endpoint}`)),
				identityPage.waitForResponse((item) => item.url().endsWith('/sysAuth/userInfo')),
				identityPage.getByRole('dialog').getByRole('button', { name: /^确\s*定$/ }).click(),
			]);
			const response = await switched.json();
			assert.equal(response.code, 200);
			extraSessions.push(response.result);
			const user = (await info.json()).result;
			assert.equal(String(user.currentTenantId), String(tenant().Id));
			assert.equal(user.account, endpoint === 'goTenant' ? account : 'superAdmin.NET');
			await expect(identityPage.locator('.ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
			await expect(identityPage.getByRole('dialog')).toHaveCount(0);
			await expect(identityPage).toHaveURL(/#\/dashboard\/notice$/);
			await expect(identityPage.getByLabel('接收通知标题', { exact: true })).toBeVisible();
			await expect(identityPage.getByText('哎呀！未找到页面', { exact: true })).toHaveCount(0);
			await identityPage.screenshot({ path: join(evidence, `tenant-desktop-${endpoint}.png`), fullPage: true });
			await identityPage.reload();
			await expect(identityPage).toHaveURL(/#\/dashboard\/notice$/);
			await expect(identityPage.getByLabel('接收通知标题', { exact: true })).toBeVisible();
			await expect(identityPage.getByText('哎呀！未找到页面', { exact: true })).toHaveCount(0);
			await expect(identityPage.getByRole('button', { name: '切换租户', exact: true })).toHaveCount(endpoint === 'goTenant' ? 0 : 1);
		} finally { await identityContext.close(); }
	}
	report.steps.push(stage);

	stage = 'tenant-delete-confirmation-and-cascade';
	const record = tenant();
	await more('删除租户');
	await save(page.getByRole('dialog').filter({ hasText: `确定为“${account}”删除租户？` }), 'sysTenant/delete');
	assert.equal(tenant(), undefined);
	assert.equal(db.prepare('SELECT Id FROM SysUser WHERE Id = ?').get(record.UserId), undefined);
	await page.reload();
	await expect(page.getByRole('button', { name: '新增租户', exact: true })).toBeVisible();
	assert.deepEqual(errors, []);
	report.steps.push(stage);
	if (process.argv.includes('--outage')) {
		stage = 'real-service-outage-preserves-tenant-draft';
		await page.getByRole('button', { name: '新增租户', exact: true }).click();
		dialog = page.getByRole('dialog', { name: '添加租户', exact: true });
		await dialog.getByLabel('租户名称', { exact: true }).fill(`${account}-outage`);
		await dialog.getByLabel('租管账号', { exact: true }).fill(`${account}-outage`);
		await dialog.getByLabel('电话', { exact: true }).fill('13900000007');
		execFileSync('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
		serviceStopped = true;
		const [failed] = await Promise.all([
			page.waitForResponse((item) => item.url().endsWith('/sysTenant/add')),
			dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
		]);
		assert.equal(failed.status(), 502);
		await expect(dialog.getByRole('alert')).toBeVisible();
		await expect(dialog.getByLabel('租户名称', { exact: true })).toHaveValue(`${account}-outage`);
		await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
		assert.equal(db.prepare('SELECT Id FROM SysUser WHERE Account = ?').get(`${account}-outage`), undefined);
		await screenshot('tenant-desktop-service-outage.png');
		report.steps.push(stage);
	}
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = { name: error.name, code: error.code ?? null };
	if (stage === 'tenant-reset-password-confirmation' && page) {
		report.passwordStageButtons = await page.getByRole('dialog').getByRole('button').evaluateAll((buttons) => buttons.map((button) => ({
			text: button.textContent, label: button.getAttribute('aria-label'),
		}))).catch(() => []);
		report.passwordDialogVisible = await page.getByRole('dialog', { name: '租管密码已重置', exact: true }).isVisible().catch(() => false);
	}
	if (stage !== 'tenant-reset-password-confirmation') {
		report.diagnostic = String(error.message).split('\n').slice(0, 9).join('\n');
		if (page) report.dialogs = await page.getByRole('dialog').evaluateAll((elements) => elements.map((element) => ({
			label: element.getAttribute('aria-label'), labelledBy: element.getAttribute('aria-labelledby'),
			buttons: [...element.querySelectorAll('button')].map((button) => ({ text: button.textContent, label: button.getAttribute('aria-label') })),
		}))).catch(() => []);
	}
	process.exitCode = 1;
	saveReport();
	// 失败时可能停留于密码弹窗，不自动截图敏感内容。
} finally {
	saveReport();
	const cleanupErrors = [];
	for (const identity of serviceStopped ? [] : extraSessions) {
		try {
			const response = await fetch(new URL('/api/sysAuth/logout', apiUrl), {
				method: 'POST', headers: { Authorization: `Bearer ${identity.accessToken}`, 'X-Authorization': `Bearer ${identity.refreshToken}` },
				signal: AbortSignal.timeout(20_000),
			});
			assert.equal((await response.json()).code, 200);
		} catch { cleanupErrors.push('logout-switched-identity'); }
	}
	for (const name of [account, `${account}-db`]) {
		try { const record = db && tenant(name); if (record && session) await api('sysTenant/delete', { id: record.Id }); }
		catch { cleanupErrors.push('delete-tenant'); }
		try { if (db) assert.equal(tenant(name), undefined); } catch { cleanupErrors.push('verify-delete'); }
	}
	try { if (session && !serviceStopped) await api('sysAuth/logout'); } catch { cleanupErrors.push('logout'); }
	try { await context?.close(); await browser?.close(); } catch { cleanupErrors.push('browser'); }
	try { await proxy?.close(); } catch { cleanupErrors.push('proxy'); }
	try { db?.close(); } catch { cleanupErrors.push('database'); }
	report.cleanupPassed = cleanupErrors.length === 0;
	report.cleanupErrors = cleanupErrors;
	if (!report.cleanupPassed) process.exitCode = 1;
	saveReport();
	console.log(JSON.stringify({ passed: report.passed, cleanupPassed: report.cleanupPassed, failedStage: report.failedStage, report: join(evidence, 'tenant-browser-baseline.json') }));
}
