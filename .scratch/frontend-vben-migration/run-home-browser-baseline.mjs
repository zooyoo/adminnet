import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-isolated-api', steps: [], cleanupErrors: [] };
const prefix = `home-${randomBytes(5).toString('hex')}`;
const secrets = [];
let runtime, evidence, base, proxy, browser, context, page, db, password, publicKey, admin, ordinary, tenant, originalFavorites, stage = 'initialize';
const owners = [];
async function launchApi() {
	return new Promise((resolveLaunch, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture', '-BuildRoot', join(tmpdir(), 'adminnet-vben-build-16')],
			{ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated API startup timeout')); }, 180_000);
		child.stdout.on('data', (chunk) => {
			output += chunk.toString();
			if (!output.includes('Ready: real sysConfig/sysInfo returned code 200.')) return;
			clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy(); child.unref();
			resolveLaunch(realpathSync(output.match(/Runtime: ([^\r\n]+)/)[1]));
		});
		child.stderr.on('data', () => {});
		child.once('error', reject);
		child.once('exit', (code) => { if (code) { clearTimeout(timer); reject(new Error('Isolated API startup failed')); } });
	});
}
async function api(session, path, data, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
		secrets.push(session.accessToken, session.refreshToken);
	}
	if (refusal && [401, 403].includes(response.status)) return;
	const text = await response.text();
	assert.ok(text, `${path.split('?')[0]} returned empty HTTP ${response.status}`);
	const result = JSON.parse(text);
	if (refusal) { assert.notEqual(result.code, 200, `${path} should refuse`); return; }
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}`);
	return result.result;
}
async function login(account) {
	const result = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(result.accessToken, result.refreshToken);
	return result;
}
async function enter(session) {
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(session.accessToken)}&redirect=%2Fhome`);
	await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '添加日程', exact: true })).toBeEnabled();
}
async function shot(name) {
	if (!(await page.getByRole('dialog').count())) {
		await page.evaluate(() => {
			for (const element of document.querySelectorAll('*')) {
				if (element.scrollTop && element.scrollHeight > element.clientHeight) element.scrollTop = 0;
			}
			window.scrollTo(0, 0);
		});
	}
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
		animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), fullPage: true, mask: [page.locator('input[type=password]')] });
}
async function requestFrom(action, suffix) {
	const [response] = await Promise.all([page.waitForResponse((value) => value.url().endsWith(suffix) && value.request().method() === 'POST'), action()]);
	assert.equal((await response.json()).code, 200);
}
async function stopApi() {
	await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30_000 });
}
async function cleanup() {
	for (const { session, id } of owners) {
		try {
			const rows = db.prepare('SELECT Id FROM SysSchedule WHERE UserId = ? AND Content LIKE ?').all(id, `${prefix}%`);
			for (const row of rows) await api(session, 'sysSchedule/delete', { id: row.Id });
		} catch { report.cleanupErrors.push('schedule-cleanup'); }
	}
	if (originalFavorites) {
		try { await api(admin, 'sysUserMenu/add', { menuIdList: originalFavorites }); originalFavorites = undefined; }
		catch { report.cleanupErrors.push('favorites-restore'); }
	}
	try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysSchedule WHERE Content LIKE ?').get(`${prefix}%`).n, 0); }
	catch { report.cleanupErrors.push('schedule-database-cleanup'); }
	report.cleanupPassed = report.cleanupErrors.length === 0;
}
try {
	runtime = await launchApi();
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true }); db.exec('PRAGMA busy_timeout=5000');
	password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey); secrets.push(password);
	admin = await login('superAdmin.NET'); ordinary = await login('TestUser3'); tenant = await login('Admin.NET');
	for (const session of [admin, ordinary, tenant]) {
		const info = await api(session, 'sysAuth/userInfo', undefined, 'GET');
		owners.push({ session, id: info.id, tenantId: info.tenantId });
	}
	const today = new Date().toLocaleDateString('en-CA');
	const fixture = { content: `${prefix}-api`, scheduleTime: today, startTime: '09:00', endTime: '10:00', status: 0 };
	stage = 'real-owner-tenant-and-validation';
	await api(admin, 'sysSchedule/add', { ...fixture, userId: owners[1].id, tenantId: owners[2].tenantId });
	const stored = db.prepare('SELECT * FROM SysSchedule WHERE Content = ?').get(fixture.content);
	assert.ok(stored); assert.equal(stored.UserId, owners[0].id); assert.equal(stored.TenantId, owners[0].tenantId);
	for (const session of [ordinary, tenant]) {
		const list = await api(session, 'sysSchedule/page', {});
		assert.equal(list.some((item) => item.id === stored.Id), false);
		await api(session, `sysSchedule/detail/${stored.Id}`, undefined, 'GET', true);
		await api(session, 'sysSchedule/update', { ...fixture, id: stored.Id }, 'POST', true);
		await api(session, 'sysSchedule/delete', { id: stored.Id }, 'POST', true);
		await api(session, 'sysSchedule/setStatus', { id: stored.Id, status: 1 }, 'POST', true);
	}
	for (const changes of [{ content: '' }, { endTime: '08:00' }, { startTime: '24:00' }, { scheduleTime: null }, { status: 7 }]) {
		await api(admin, 'sysSchedule/add', { ...fixture, ...changes }, 'POST', true);
	}
	await api(ordinary, 'sysSchedule/add', { ...fixture, content: `${prefix}-ordinary`, userId: owners[0].id, tenantId: owners[2].tenantId });
	assert.equal(db.prepare('SELECT UserId FROM SysSchedule WHERE Content = ?').get(`${prefix}-ordinary`).UserId, owners[1].id);
	await api(undefined, 'sysSchedule/add', fixture, 'POST', true);
	originalFavorites = await api(admin, 'sysUserMenu/userMenuIdList', undefined, 'GET');
	await api(ordinary, 'sysUserMenu/add', { menuIdList: [999999999999] }, 'POST', true);
	report.steps.push(stage);
	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
	page = await context.newPage(); page.setDefaultTimeout(20_000);
	await enter(admin);
	stage = 'desktop-schedule-crud';
	await page.getByRole('button', { name: '添加日程', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '添加日程', exact: true });
	await dialog.getByRole('button', { name: '保存日程', exact: true }).click();
	await expect(dialog.getByRole('alert')).toContainText('日程内容');
	await page.getByLabel('日程内容', { exact: true }).fill(`${prefix}-browser`);
	await requestFrom(() => dialog.getByRole('button', { name: '保存日程', exact: true }).click(), '/sysSchedule/add');
	await expect(dialog).toBeHidden();
	const row = db.prepare('SELECT Id FROM SysSchedule WHERE Content = ?').get(`${prefix}-browser`);
	assert.ok(row);
	let item = page.locator(`[data-schedule-id="${row.Id}"]`);
	await item.getByRole('button', { name: '编辑日程', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑日程', exact: true });
	await page.getByLabel('日程内容', { exact: true }).fill(`${prefix}-edited`);
	await requestFrom(() => dialog.getByRole('button', { name: '保存日程', exact: true }).click(), '/sysSchedule/update');
	await expect(dialog).toBeHidden();
	await requestFrom(() => item.getByRole('button', { name: '标记完成', exact: true }).click(), '/sysSchedule/setStatus');
	await expect(item.getByText('已完成', { exact: true })).toBeVisible();
	assert.equal(db.prepare('SELECT Status FROM SysSchedule WHERE Id = ?').get(row.Id).Status, 1);
	await page.reload();
	await expect(item.getByText(`${prefix}-edited`, { exact: true })).toBeVisible();
	await requestFrom(() => item.getByRole('button', { name: '恢复未完成', exact: true }).click(), '/sysSchedule/setStatus');
	await shot('home-schedule.png');
	await item.getByRole('button', { name: '删除日程', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '确认删除日程', exact: true });
	await requestFrom(() => dialog.getByRole('button', { name: /^删\s*除$/ }).click(), '/sysSchedule/delete');
	await expect(item).toHaveCount(0);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysSchedule WHERE Id = ?').get(row.Id).n, 0);
	report.steps.push(stage);
	stage = 'favorite-save-refresh-clear';
	await page.getByRole('button', { name: '配置快捷入口', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '配置快捷入口', exact: true });
	await dialog.getByRole('checkbox', { name: '职位管理', exact: true }).check();
	await requestFrom(() => dialog.getByRole('button', { name: '保存快捷入口', exact: true }).click(), '/sysUserMenu/add');
	await expect(dialog).toBeHidden();
	await page.reload();
	await expect(page.locator('[data-widget="myapp"]').getByRole('button', { name: '职位管理', exact: true })).toBeVisible();
	await page.locator('[data-widget="myapp"]').getByRole('button', { name: '职位管理', exact: true }).click();
	await expect(page).toHaveURL(/#\/system\/pos$/);
	await page.goto(`${proxy.baseUrl}/#/home`);
	await expect(page.getByRole('button', { name: '配置快捷入口', exact: true })).toBeEnabled();
	await page.getByRole('button', { name: '配置快捷入口', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '配置快捷入口', exact: true });
	for (const checkbox of await dialog.getByRole('checkbox').all()) if (await checkbox.isChecked()) await checkbox.uncheck();
	await requestFrom(() => dialog.getByRole('button', { name: '保存快捷入口', exact: true }).click(), '/sysUserMenu/add');
	await expect(page.locator('[data-widget="myapp"]')).toContainText('暂无快捷入口');
	assert.equal((await api(admin, 'sysUserMenu/userMenuList', undefined, 'GET')).length, 0);
	report.steps.push(stage);
	stage = 'layout-save-cancel-reload-and-identity';
	await page.getByRole('button', { name: '自定义工作台', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '自定义工作台', exact: true });
	await dialog.getByRole('button', { name: '隐藏当前时钟', exact: true }).click();
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(page.locator('[data-widget="timer"]')).toBeVisible();
	await page.getByRole('button', { name: '自定义工作台', exact: true }).click();
	await dialog.getByRole('button', { name: '隐藏当前时钟', exact: true }).click();
	await dialog.getByRole('button', { name: '保存布局', exact: true }).click();
	await page.reload(); await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
	await expect(page.locator('[data-widget="timer"]')).toHaveCount(0);
	await enter(ordinary);
	await expect(page.locator('[data-widget="timer"]')).toBeVisible();
	await expect(page.getByText(`${prefix}-ordinary`, { exact: true })).toBeVisible();
	await expect(page.getByText(`${prefix}-api`, { exact: true })).toHaveCount(0);
	admin = await login('superAdmin.NET'); owners[0].session = admin;
	await enter(admin);
	await expect(page.locator('[data-widget="timer"]')).toHaveCount(0);
	await page.getByRole('button', { name: '自定义工作台', exact: true }).click();
	await dialog.getByRole('button', { name: '恢复默认布局', exact: true }).click();
	await dialog.getByRole('button', { name: '保存布局', exact: true }).click();
	await expect(page.locator('[data-widget="timer"]')).toBeVisible();
	await shot('home-layout.png');
	await page.getByRole('button', { name: 'light', exact: true }).click();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await shot('home-light.png');
	await page.locator('[data-widget="about"]').getByRole('button', { name: '关于项目', exact: true }).click();
	await expect(page.getByText('关于 Admin.NET', { exact: true })).toBeVisible();
	await page.getByRole('button', { name: '返回工作台', exact: true }).click();
	await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible();
	report.steps.push(stage);
	stage = 'external-updates-feedback';
	await page.getByRole('button', { name: '加载更新记录', exact: true }).click();
	await expect(page.getByRole('button', { name: '加载更新记录', exact: true })).toBeEnabled({ timeout: 25_000 });
	await expect.poll(async () => await page.locator('.workbench-commits li').count() > 0 || await page.locator('[data-widget="commit"]').getByRole('alert').count() > 0).toBe(true);
	report.externalUpdates = await page.locator('.workbench-commits li').count() > 0 ? 'real-public-response' : 'real-network-failure-visible';
	report.steps.push(stage);
	await cleanup(); assert.equal(report.cleanupPassed, true);
	stage = 'real-outage-draft';
	await page.getByRole('button', { name: '添加日程', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '添加日程', exact: true });
	await page.getByLabel('日程内容', { exact: true }).fill(`${prefix}-outage`);
	await stopApi();
	const [outage] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysSchedule/add')),
		dialog.getByRole('button', { name: '保存日程', exact: true }).click()]);
	assert.equal(outage.status(), 502);
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(page.getByLabel('日程内容', { exact: true })).toHaveValue(`${prefix}-outage`);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysSchedule WHERE Content = ?').get(`${prefix}-outage`).n, 0);
	await shot('home-outage.png');
	report.steps.push(stage); report.passed = true;
} catch (error) {
	let message = String(error.message ?? error);
	for (const value of secrets) if (value) message = message.replaceAll(value, '[REDACTED]');
	report.error = { stage, message }; process.exitCode = 1;
	if (evidence) {
		writeFileSync(join(evidence, 'home-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
		try { await page?.screenshot({ path: join(evidence, 'home-failed.png'), fullPage: true, mask: [page.locator('input[type=password]')] }); } catch {}
	}
} finally {
	if (!report.cleanupPassed && admin && db) await cleanup();
	for (const [name, action] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['database', () => db?.close()], ['api', () => runtime && stopApi()]]) {
		try { await action(); } catch { report.cleanupErrors.push(name); process.exitCode = 1; }
	}
	report.cleanupPassed = report.cleanupPassed && report.cleanupErrors.length === 0;
	if (evidence) writeFileSync(join(evidence, 'home-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
