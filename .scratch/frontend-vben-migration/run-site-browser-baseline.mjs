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
const base = new URL(marker.baseUrl);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const appRequire = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-api-readonly-sqlite', cleanupScope: '恢复站点文本和注册设置，删除测试注册方案；隔离目录中的 Logo 与数据库作为证据保留', steps: [], cleanupErrors: [] };
const name = `accept10-${Date.now()}`;
const created = [];
let db, proxy, browser, context, page, admin, ordinary, original, originalTenantSelector, tenantId, schemeId, stopped = false;
let stage = 'initialize';

async function request(session, path, body, method = 'POST') {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(30_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	return response;
}
async function ok(session, path, body, method) {
	const result = await (await request(session, path, body, method)).json();
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}; ${JSON.stringify(result.errors ?? result.message ?? '')}`);
	return result.result;
}
async function denied(session, path, body, method) {
	const response = await request(session, path, body, method);
	if ([401, 403].includes(response.status)) return;
	assert.notEqual((await response.json()).code, 200, path);
}
async function shot(file) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.screenshot({ path: join(evidence, file), animations: 'disabled' });
}
async function saveSite() {
	const [response] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith('/api/sysConfig/saveSysInfo') && item.request().method() === 'POST'),
		page.getByRole('button', { name: /^保\s*存$/ }).click(),
	]);
	assert.equal((await response.json()).code, 200);
	await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled();
}
async function cleanup() {
	if (originalTenantSelector) {
		try { await ok(admin, 'sysConfig/update', originalTenantSelector); originalTenantSelector = undefined; }
		catch { report.cleanupErrors.push('restore-tenant-selector'); }
	}
	if (original && admin) {
		try { await ok(admin, 'sysConfig/saveSysInfo', original); original = undefined; }
		catch { report.cleanupErrors.push('restore-site'); }
	}
	for (const item of [...created].reverse()) {
		try {
			await ok(admin, `${item.endpoint}/delete`, { id: item.id });
			assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${item.table} WHERE Id = ?`).get(item.id).n, 0);
			created.splice(created.indexOf(item), 1);
		} catch { report.cleanupErrors.push(item.endpoint); }
	}
	report.cleanupPassed = !original && !originalTenantSelector && created.length === 0 && report.cleanupErrors.length === 0;
}
try {
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	const { sm2 } = appRequire('sm-crypto-v2');
	admin = await ok(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	ordinary = await ok(undefined, 'sysAuth/login', { account: 'TestUser3', password: sm2.doEncrypt(password, publicKey, 1) });
	const user = await ok(admin, 'sysAuth/userInfo', undefined, 'GET');
	tenantId = user.currentTenantId;
	assert.ok(tenantId);
	original = await ok(admin, 'sysConfig/sysInfo', undefined, 'GET');
	original.regWayId ??= 0;
	const org = db.prepare('SELECT Id FROM SysOrg WHERE TenantId = ? ORDER BY Id LIMIT 1').get(tenantId);
	const role = db.prepare('SELECT Id FROM SysRole WHERE TenantId = ? ORDER BY Id LIMIT 1').get(tenantId);
	const pos = db.prepare('SELECT Id FROM SysPos WHERE TenantId = ? ORDER BY Id LIMIT 1').get(tenantId);
	assert.ok(org && role && pos);
	const draft = { tenantId, name, accountType: 777, roleId: role.Id, orgId: org.Id, posId: pos.Id, orderNo: 100 };
	stage = 'real-scheme-crud-validation-permission-and-tenant';
	schemeId = await ok(admin, 'sysUserRegWay/add', draft);
	assert.ok(schemeId);
	created.push({ endpoint: 'sysUserRegWay', table: 'SysUserRegWay', id: schemeId });
	await ok(admin, 'sysUserRegWay/update', { ...draft, id: schemeId, name: `${name}-更新` });
	assert.equal(db.prepare('SELECT Name FROM SysUserRegWay WHERE Id = ?').get(schemeId).Name, `${name}-更新`);
	await denied(admin, 'sysUserRegWay/add', { ...draft, name: '' });
	await denied(admin, 'sysUserRegWay/add', { ...draft, name: `${name}-admin`, accountType: 999 });
	await denied(admin, 'sysUserRegWay/add', { ...draft, name: `${name}-foreign`, orgId: 1300000990001 });
	await denied(ordinary, 'sysUserRegWay/update', { ...draft, id: schemeId, name: 'denied' });
	await denied(ordinary, 'sysConfig/saveSysInfo', { ...original, title: 'denied' });
	await denied(admin, 'sysConfig/saveSysInfo', { ...original, enableReg: 1, regWayId: -100 });
	assert.equal(db.prepare('SELECT Title FROM SysTenant WHERE Id = ?').get(tenantId).Title, original.title);
	const foreign = await ok(undefined, 'sysConfig/sysInfo?tenantId=1300000990001', undefined, 'GET');
	assert.equal(foreign.title, 'isolated-online');
	assert.ok(!foreign.wayList.some((item) => item.value === schemeId));
	assert.equal((await ok(admin, 'sysConfig/sysInfo?tenantId=1300000990001', undefined, 'GET')).title, original.title);
	report.steps.push(stage);

	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
	stage = 'production-desktop-site-login';
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fplatform%2FinfoSetting`);
	await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
	await page.getByLabel('密码', { exact: true }).fill(password);
	const [loginResponse] = await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysAuth/login')), page.locator('button[type=submit]').click()]);
	const loginPayload = loginResponse.request().postDataJSON();
	assert.equal(loginPayload.account, 'superAdmin.NET');
	assert.ok(loginPayload.password.length > 192);
	assert.equal((await loginResponse.json()).code, 200, 'Production browser login must succeed');
	await expect(page.getByRole('textbox', { name: '系统主标题', exact: true })).toBeVisible();
	report.steps.push(stage);

	stage = 'logo-cancel-brand-and-registration-persist';
	const logoFile = { name: 'site-logo.png', mimeType: 'image/png', buffer: readFileSync(join(root, 'Web/apps/web-antdv-next/public/logo.png')) };
	await page.locator('input[type=file]').setInputFiles(logoFile);
	await expect(page.getByText('site-logo.png', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: '取消 Logo 更改', exact: true }).click();
	await page.getByLabel('系统主标题', { exact: true }).fill(name);
	await page.getByRole('radio', { name: '启用', exact: true }).check();
	await page.getByLabel('注册方案', { exact: true }).click();
	await page.getByRole('option', { name: `${name}-更新`, exact: true }).click();
	const [cancelled] = await Promise.all([page.waitForRequest((r) => r.url().endsWith('/sysConfig/saveSysInfo')), saveSite()]);
	assert.equal(cancelled.postDataJSON().logoBase64, undefined);
	assert.equal(db.prepare('SELECT Logo FROM SysTenant WHERE Id = ?').get(tenantId).Logo, original.logo);
	await page.reload();
	await expect(page.getByLabel('系统主标题', { exact: true })).toHaveValue(name);
	await expect(page.getByRole('radio', { name: '启用', exact: true })).toBeChecked();
	await page.locator('input[type=file]').setInputFiles(logoFile);
	await expect(page.getByText('site-logo.png', { exact: true })).toBeVisible();
	await saveSite();
	const stored = db.prepare('SELECT Logo, EnableReg, RegWayId FROM SysTenant WHERE Id = ?').get(tenantId);
	assert.equal(stored.EnableReg, 1);
	assert.equal(stored.RegWayId, schemeId);
	assert.match(stored.Logo, /^\/upload\/logo-[a-f0-9]{32}\.png$/);
	const logoResponse = await fetch(new URL(stored.Logo, base));
	assert.equal(logoResponse.status, 200);
	assert.deepEqual(Buffer.from(await logoResponse.arrayBuffer()), logoFile.buffer);
	await expect.poll(() => page.locator('.site-info-page img.ant-image-img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	report.logoResource = stored.Logo;
	await shot('site-desktop-saved.png');
	report.steps.push(stage);

	stage = 'production-registration-editor-reopen';
	await page.goto(`${proxy.baseUrl}/#/platform/regWay`);
	await expect(page.getByRole('button', { name: '新增注册方案', exact: true })).toBeVisible();
	await page.locator(`tr[data-row-key="${schemeId}"]`).getByRole('button', { name: '编辑注册方案', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑注册方案', exact: true });
	await expect(dialog.getByLabel('方案名称', { exact: true })).toHaveValue(`${name}-更新`);
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await dialog.getByLabel('方案名称', { exact: true }).fill(`${name}-桌面`);
	await shot('registration-desktop-editor.png');
	const [updated] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysUserRegWay/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.equal((await updated.json()).code, 200);
	await expect(dialog).toBeHidden();
	assert.equal(db.prepare('SELECT Name FROM SysUserRegWay WHERE Id = ?').get(schemeId).Name, `${name}-桌面`);
	report.steps.push(stage);

	stage = 'anonymous-brand-registration-and-tenant-selection';
	originalTenantSelector = (await ok(admin, 'sysConfig/page', { page: 1, pageSize: 10, code: 'sys_hide_tenant_login' })).items.find((item) => item.code === 'sys_hide_tenant_login');
	assert.ok(originalTenantSelector);
	await ok(admin, 'sysConfig/update', { ...originalTenantSelector, value: 'False' });
	const anonymous = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	try {
		const publicPage = await anonymous.newPage();
		await publicPage.goto(`${proxy.baseUrl}/#/auth/login`);
		await expect(publicPage.getByRole('heading', { name: `登录 ${name}`, exact: true })).toBeVisible();
		await expect(publicPage.getByText(original.copyright, { exact: true })).toBeVisible();
		await expect(publicPage.getByRole('link', { name: original.icp, exact: true })).toHaveAttribute('href', new URL(original.icpUrl).href);
		await publicPage.getByRole('button', { name: '注册账号', exact: true }).click();
		await expect(publicPage.locator('.ant-form-item').filter({ has: publicPage.getByLabel('注册方案', { exact: true }) })).toContainText(`${name}-桌面`);
		await publicPage.screenshot({ path: join(evidence, 'site-registration-public.png'), animations: 'disabled' });
		await publicPage.getByLabel('租户', { exact: true }).click();
		const tenantOptions = await ok(undefined, 'sysTenant/list', undefined, 'GET');
		report.tenantOptionDom = await publicPage.locator('.ant-select-dropdown [role=option], .ant-select-item-option').evaluateAll((elements) =>
			elements.map((item) => ({ tag: item.tagName, class: item.className, text: item.textContent, visible: item.getBoundingClientRect().height > 0 && getComputedStyle(item).visibility !== 'hidden' })));
		console.log(JSON.stringify({ tenantOptionDom: report.tenantOptionDom }));
		await publicPage.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: tenantOptions.find((item) => item.value === 1300000990001).label }).click();
		await expect(publicPage.getByText('当前租户未开放注册', { exact: true })).toBeVisible();
		assert.equal(await publicPage.getByLabel('注册方案', { exact: true }).count(), 0);
		await publicPage.getByLabel('租户', { exact: true }).click();
		await publicPage.locator('.ant-select-dropdown:visible .ant-select-item-option').filter({ hasText: tenantOptions.find((item) => item.value === tenantId).label }).click();
		await expect(publicPage.locator('.ant-form-item').filter({ has: publicPage.getByLabel('注册方案', { exact: true }) })).toContainText(`${name}-桌面`);
	} finally { await anonymous.close(); }
	report.steps.push(stage);

	stage = 'restore-and-disable-default-scheme';
	await ok(admin, 'sysConfig/saveSysInfo', original);
	original = undefined;
	await cleanup();
	assert.equal(report.cleanupPassed, true);
	report.steps.push(stage);
	if (process.argv.includes('--outage')) {
		stage = 'real-outage-preserves-site-draft';
		await page.goto(`${proxy.baseUrl}/#/platform/infoSetting`);
		await page.getByLabel('系统主标题', { exact: true }).fill(`${name}-停机草稿`);
		const before = db.prepare('SELECT Title FROM SysTenant WHERE Id = ?').get(tenantId).Title;
		execFileSync('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, stdio: 'pipe' });
		stopped = true;
		const [failure] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysConfig/saveSysInfo')), page.getByRole('button', { name: /^保\s*存$/ }).click()]);
		assert.equal(failure.status(), 502);
		await expect(page.getByLabel('系统主标题', { exact: true })).toHaveValue(`${name}-停机草稿`);
		await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeEnabled();
		assert.equal(db.prepare('SELECT Title FROM SysTenant WHERE Id = ?').get(tenantId).Title, before);
		await page.screenshot({ path: join(evidence, 'site-desktop-outage.png'), animations: 'disabled' });
		await page.getByRole('button', { name: '重新加载系统信息', exact: true }).click();
		await expect(page.getByRole('button', { name: /^保\s*存$/ })).toBeDisabled();
		report.steps.push(stage);
	}
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = error.message;
	process.exitCode = 1;
	if (page) await page.screenshot({ path: join(evidence, 'site-failure.png'), mask: [page.locator('input[type=password]')] }).catch(() => {});
} finally {
	if (!stopped) await cleanup();
	await context?.close();
	await browser?.close();
	await proxy?.close();
	db?.close();
	writeFileSync(join(evidence, 'site-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
