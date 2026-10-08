import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'Web/package.json'));
const appRequire = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const { chromium, expect } = require('@playwright/test');
const { sm2 } = appRequire('sm-crypto-v2');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const base = new URL(marker.baseUrl);
assert.equal(base.hostname, '127.0.0.1');
assert.equal(base.protocol, 'http:');
const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
assert.ok(password && publicKey);
const db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
const role = db.prepare('SELECT * FROM SysRole WHERE Code = ?').get('isolated-online-read');
const reader = db.prepare('SELECT Id, LangCode FROM SysUser WHERE Account = ?').get('TestUser3');
const existingGrants = db.prepare('SELECT MenuId FROM SysRoleMenu WHERE RoleId = ?').all(role.Id).map((row) => row.MenuId);
const menuIds = [];
const report = { passed: false, proposalComplete: false, steps: [], pending: ['full-task-audit'] };
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const fixture = createServer((_request, response) => {
	response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
	response.end('<!doctype html><html><head><title>Isolated frame</title></head><body><h1>Isolated frame content</h1><button onclick="this.textContent=\'Interaction confirmed\'">Verify interaction</button></body></html>');
});
await new Promise((resolve) => fixture.listen(0, '127.0.0.1', resolve));
const fixtureUrl = `http://127.0.0.1:${fixture.address().port}/probe`;
const proxy = await startProductionProxy(join(root, 'Web/dist'), base);
const browser = await chromium.launch({ channel: 'msedge' });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
let admin;
let readerToken;

async function api(session, path, body, method = 'POST') {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' && body !== undefined ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	const result = await response.json();
	assert.equal(result.code, 200, `${path} returned ${result.code}`);
	return result.result;
}
const navigate = async (path) => {
	await page.evaluate((path) => { location.hash = `#${path}`; }, path);
	await expect(page).toHaveURL(new RegExp(`#${path}$`));
};
try {
	admin = await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	const suffix = Date.now();
	const prefix = `/acceptance-${suffix}`;
	const directory = await api(admin, 'sysMenu/add', { title: '运行验收目录', name: `runtime${suffix}`, path: prefix, component: 'layout/routerView/parent', type: 1, tenantId: role.TenantId, status: 1 });
	menuIds.push(directory);
	for (const item of [
		{ key: 'cached', title: '缓存验收页', component: '/system/pos/index', isKeepAlive: true, isAffix: true },
		{ key: 'uncached', title: '非缓存验收页', component: '/system/pos/index', isKeepAlive: false },
		{ key: 'hidden', title: '隐藏验收页', component: '/system/pos/index', isHide: true },
		{ key: 'frame', title: '内嵌验收页', isIframe: true, outLink: fixtureUrl },
		{ key: 'external', title: '外链验收页', isIframe: false, outLink: fixtureUrl },
	]) {
		const id = await api(admin, 'sysMenu/add', {
			pid: directory, type: 2, tenantId: role.TenantId, status: 1, name: `${item.key}${suffix}`, path: `${prefix}/${item.key}`, icon: 'ele-Setting', ...item,
		});
		menuIds.push(id);
	}
	const posQuery = db.prepare('SELECT Id FROM SysMenu WHERE Permission = ?').get('sysPos:list').Id;
	await api(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [...menuIds, posQuery] });
	await api(admin, 'sysLangText/batchSave', [{ entityName: 'SysMenu', entityId: menuIds[1], fieldName: 'Title', langCode: 'en-US', content: 'Translated cached page' }]);
	const credential = { account: 'TestUser3', password: sm2.doEncrypt(password, publicKey, 1) };
	readerToken = await api(undefined, 'sysAuth/login', credential);
	await api(readerToken, 'sysUser/setLangCode/en-US');
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=${encodeURIComponent(`${prefix}/cached`)}`);
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.getByLabel('账号', { exact: true }).fill('TestUser3');
	await page.getByLabel('密码', { exact: true }).fill(password);
	const loginResponse = page.waitForResponse((response) => response.url().endsWith('/sysAuth/login'));
	await page.locator('button[type=submit]').click();
	const result = await (await loginResponse).json();
	assert.equal(result.code, 200);
	readerToken = result.result;
	await expect(page).toHaveURL(new RegExp(`#${prefix}/cached$`));
	await expect(page.getByText('Translated cached page', { exact: true }).first()).toBeVisible();
	await expect(page.getByLabel('职位名称', { exact: true })).toBeVisible();
	report.steps.push('real-translated-menu-and-directory-render');

	await page.getByLabel('职位名称', { exact: true }).fill('keep-alive-draft');
	await navigate(`${prefix}/uncached`);
	await expect(page.getByLabel('职位名称', { exact: true })).toHaveValue('');
	await page.getByLabel('职位名称', { exact: true }).fill('discard-this-draft');
	await navigate(`${prefix}/cached`);
	await expect(page.getByLabel('职位名称', { exact: true })).toHaveValue('keep-alive-draft');
	await navigate(`${prefix}/uncached`);
	await expect(page.getByLabel('职位名称', { exact: true })).toHaveValue('');
	report.steps.push('real-keepalive-and-nonkeepalive-form-state');

	const nav = page.getByRole('menu');
	await expect(nav.getByText('隐藏验收页', { exact: true })).toHaveCount(0);
	await navigate(`${prefix}/hidden`);
	await expect(page.getByLabel('职位名称', { exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByLabel('职位名称', { exact: true })).toBeVisible();
	report.steps.push('hidden-menu-not-in-navigation-but-direct-refresh-works');

	await navigate(`${prefix}/frame`);
	const frame = page.frameLocator('iframe').first();
	await expect(frame.getByRole('heading', { name: 'Isolated frame content' })).toBeVisible();
	await frame.getByRole('button', { name: 'Verify interaction' }).click();
	await expect(frame.getByRole('button', { name: 'Interaction confirmed' })).toBeVisible();
	report.steps.push('real-local-iframe-content-and-interaction');

	const newPage = context.waitForEvent('page');
	await nav.getByText('外链验收页', { exact: true }).click();
	const external = await newPage;
	await expect(external).toHaveURL(fixtureUrl);
	await expect(external.getByRole('heading', { name: 'Isolated frame content' })).toBeVisible();
	await external.close();
	report.steps.push('real-local-external-link-new-window');

	await navigate(`${prefix}/cached`);
	const pinned = page.locator('[data-tab-item="true"]').filter({ hasText: 'Translated cached page' });
	await expect(pinned).toHaveClass(/affix-tab/);
	await expect(pinned.locator('svg.lucide-pin')).toBeVisible();
	await expect(pinned.locator('svg.lucide-x')).toBeHidden();
	await pinned.click({ button: 'middle' });
	await expect(pinned).toBeVisible();
	report.steps.push('fixed-tab-pin-and-middle-click-preserves-tab');
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	await expect(page.locator('.ant-message-notice')).toHaveCount(0);
	await page.screenshot({ path: join(evidence, 'menu-runtime-desktop.png'), fullPage: true, animations: 'disabled' });
	if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) {
		await page.getByRole('button', { name: 'light', exact: true }).click();
	}
	await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(false);
	await navigate(`${prefix}/frame`);
	await expect(frame.getByRole('heading', { name: 'Isolated frame content' })).toBeVisible();
	await expect.poll(async () => {
		const bounds = await page.locator('iframe').first().boundingBox();
		return Boolean(bounds && bounds.x >= 0 && bounds.width >= 900 && bounds.x + bounds.width <= 1440);
	}, { timeout: 15_000 }).toBe(true);
	await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: join(evidence, 'menu-runtime-desktop-light-frame.png'), fullPage: true, animations: 'disabled' });
	report.steps.push('desktop-light-iframe-visible-without-page-overflow');
	report.passed = true;
} catch (error) {
	report.error = String(error.message).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
	await page.screenshot({ path: join(evidence, 'menu-runtime-failure.png'), fullPage: true, animations: 'disabled' }).catch(() => {});
	process.exitCode = 1;
} finally {
	try {
		if (readerToken) await api(readerToken, `sysUser/setLangCode/${encodeURIComponent(reader.LangCode || 'zh-CN')}`);
		if (admin) {
			await api(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: existingGrants });
			for (const id of menuIds.reverse()) await api(admin, 'sysMenu/delete', { id });
		}
	} catch {
		report.cleanupFailed = true;
		report.passed = false;
		process.exitCode = 1;
	}
	await context.close();
	await browser.close();
	await proxy.close();
	await new Promise((resolve) => { fixture.close(resolve); fixture.closeAllConnections(); });
	db.close();
	writeFileSync(join(evidence, 'menu-runtime-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
