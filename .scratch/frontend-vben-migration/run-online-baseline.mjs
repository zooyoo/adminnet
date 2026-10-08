import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'Web/package.json'));
const appRequire = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const { chromium, expect } = require('@playwright/test');
const { HubConnectionBuilder, LogLevel } = appRequire('@microsoft/signalr');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const seed = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8');
const password = seed.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
assert.ok(password);
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL(marker.baseUrl));
const browser = await chromium.launch({ channel: 'msedge' });
const report = { passed: false, steps: [] };
const database = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
const contexts = [];
const connections = [];
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let admin;

async function login(account, mobile = false) {
	const context = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 1000 } });
	contexts.push(context);
	const page = await context.newPage();
	page.setDefaultTimeout(15_000);
	const state = { context, page, token: '', refresh: '', sockets: [], connectionId: '', loginPayload: undefined };
	page.on('websocket', (socket) => {
		if (socket.url().includes('/hubs/onlineUser')) state.sockets.push(new URL(socket.url()).searchParams.get('access_token'));
	});
	page.on('response', async (response) => {
		const headers = response.headers();
		if (headers['access-token'] && headers['access-token'] !== 'invalid_token') state.token = headers['access-token'];
		if (headers['x-access-token']) state.refresh = headers['x-access-token'];
		if (response.url().includes('/hubs/onlineUser/negotiate')) {
			try { state.connectionId = (await response.json()).connectionId ?? ''; } catch {}
		}
	});
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Fpos`);
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.getByLabel('账号', { exact: true }).fill(account);
	await page.getByLabel('密码', { exact: true }).fill(password);
	const response = page.waitForResponse((value) => new URL(value.url()).pathname.endsWith('/sysAuth/login'));
	await page.locator('button[type=submit]').click();
	const loginResponse = await response;
	state.loginPayload = loginResponse.request().postDataJSON();
	const result = await loginResponse.json();
	assert.equal(result.code, 200);
	state.token = result.result.accessToken;
	state.refresh = result.result.refreshToken;
	await expect(page.getByRole('button', { name: '在线用户', exact: true })).toBeVisible({ timeout: 15_000 });
	return state;
}

async function api(state, path, body, method = 'POST') {
	const response = await state.context.request.fetch(`${proxy.baseUrl}/prod-api/api/${path}`, {
		method, data: body,
		headers: { Authorization: `Bearer ${state.token}`, 'X-Authorization': `Bearer ${state.refresh}` },
	});
	return { status: response.status(), ...(await response.json()) };
}
async function rows(userName) {
	const result = await api(admin, 'sysOnlineUser/page', { page: 1, pageSize: 100, userName });
	assert.equal(result.code, 200);
	return result.result.items;
}

try {
	const anonymous = await fetch(`${marker.baseUrl}/hubs/onlineUser/negotiate?negotiateVersion=1`, { method: 'POST' });
	const anonymousBody = await anonymous.json();
	assert.ok(anonymous.status === 401 || anonymousBody.code === 401);
	assert.ok(!anonymousBody.connectionToken);
	report.steps.push('anonymous-negotiate-denied');
	admin = await login('superAdmin.NET');
	await expect.poll(async () => (await rows('superAdmin.NET')).length, { timeout: 20_000 }).toBe(1);
	assert.ok(admin.sockets.includes(admin.token), 'The browser must use the real JWT in the WebSocket handshake.');
	report.steps.push('real-browser-websocket');
	const target = await login('TestUser3', true);
	await expect.poll(async () => (await rows('TestUser3')).length, { timeout: 20_000 }).toBe(1);
	// 分隔签发时间，避免同一秒的相同账号生成相同令牌。
	await pause(1100);
	const peer = await login('TestUser3', true);
	await expect.poll(async () => (await rows('TestUser3')).length, { timeout: 20_000 }).toBe(2);
	assert.ok(target.token !== peer.token, 'Separate logins must issue distinct session tokens.');
	report.steps.push('multiple-browser-sessions');
	const foreignResponse = await admin.context.request.post(`${proxy.baseUrl}/prod-api/api/sysAuth/login`, {
		data: { ...admin.loginPayload, account: 'OnlineForeign', tenantId: 1300000990001 },
	});
	const foreignResult = await foreignResponse.json();
	assert.equal(foreignResult.code, 200);
	const foreignHub = new HubConnectionBuilder().withUrl(`${marker.baseUrl}/hubs/onlineUser`, { accessTokenFactory: () => foreignResult.result.accessToken }).configureLogging(LogLevel.None).build();
	connections.push(foreignHub);
	await foreignHub.start();
	await expect.poll(async () => (await rows('OnlineForeign')).length, { timeout: 15_000 }).toBe(1);
	const foreignRow = (await rows('OnlineForeign'))[0];
	assert.equal(String(foreignRow.tenantId), '1300000990001');
	const tenantAdmin = await login('Admin.NET');
	const ownIdentity = await api(tenantAdmin, 'sysAuth/userInfo', undefined, 'GET');
	assert.ok(ownIdentity.result.buttons.includes('sysOnlineUser:forceOffline'));
	const ownList = await api(tenantAdmin, 'sysOnlineUser/page', { page: 1, pageSize: 100, tenantId: 1300000990001 });
	assert.equal(ownList.code, 200);
	assert.ok(ownList.result.items.every((row) => String(row.tenantId) !== '1300000990001'));
	assert.notEqual((await api(tenantAdmin, 'sysOnlineUser/forceOffline', { id: foreignRow.id, connectionId: foreignRow.connectionId })).code, 200);
	const tenantHub = new HubConnectionBuilder().withUrl(`${marker.baseUrl}/hubs/onlineUser`, { accessTokenFactory: () => tenantAdmin.token }).configureLogging(LogLevel.None).build();
	connections.push(tenantHub);
	await tenantHub.start();
	await assert.rejects(() => tenantHub.invoke('ForceOffline', { connectionId: foreignRow.connectionId }));
	await tenantHub.stop();
	assert.equal((await rows('OnlineForeign')).length, 1);
	await foreignHub.stop();
	await tenantAdmin.context.close();
	await expect.poll(async () => (await rows()).length, { timeout: 15_000 }).toBe(3);
	report.steps.push('foreign-tenant-handshake', 'authorized-admin-cross-tenant-query-and-force-denied');
	const before = new Set((await rows()).map((row) => row.connectionId));
	proxy.dropWebSockets();
	await expect.poll(async () => {
		const all = await rows();
		return all.length === 3 && all.every((row) => !before.has(row.connectionId));
	}, { timeout: 30_000 }).toBe(true);
	report.steps.push('network-drop-reconnect-without-duplicate-rows');
	await admin.page.getByRole('button', { name: '在线用户', exact: true }).click();
	await expect(admin.page.getByRole('dialog', { name: '在线用户', exact: true }).getByText('已连接', { exact: true })).toBeVisible();
	await expect(admin.page.locator('.ant-notification-notice')).toHaveCount(0);
	await admin.page.screenshot({ path: join(evidence, 'online-desktop.png'), fullPage: true, animations: 'disabled' });
	await admin.page.setViewportSize({ width: 390, height: 844 });
	await expect.poll(() => admin.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await admin.page.screenshot({ path: join(evidence, 'online-mobile.png'), fullPage: true, animations: 'disabled' });
	await admin.page.setViewportSize({ width: 1440, height: 1000 });

	const adminRow = (await rows('superAdmin.NET'))[0];
	assert.equal((await api(peer, 'sysOnlineUser/forceOffline', { id: adminRow.id, connectionId: adminRow.connectionId })).code, 403);
	const restrictedHub = new HubConnectionBuilder().withUrl(`${marker.baseUrl}/hubs/onlineUser`, { accessTokenFactory: () => peer.token }).configureLogging(LogLevel.None).build();
	connections.push(restrictedHub);
	await restrictedHub.start();
	await assert.rejects(() => restrictedHub.invoke('ForceOffline', { connectionId: adminRow.connectionId }));
	await restrictedHub.stop();
	await expect.poll(async () => (await rows()).length, { timeout: 15_000 }).toBe(3);
	report.steps.push('api-and-hub-permission-denied');

	// 网络重连后的目标按连接签发的先后重新识别，不使用失效的旧连接 ID。
	const candidates = await rows('TestUser3');
	const selected = candidates.find((row) => row.connectionId === target.connectionId);
	assert.ok(selected, 'The selected row must belong to the intended browser after reconnection.');
	assert.notEqual((await api(admin, 'sysOnlineUser/forceOffline', { id: 0 })).code, 200);
	assert.notEqual((await api(admin, 'sysOnlineUser/forceOffline', { id: selected.id, connectionId: adminRow.connectionId })).code, 200);
	assert.equal((await rows('TestUser3')).length, 2);
	report.steps.push('invalid-and-forged-target-rejected');
	const onlineDrawer = admin.page.getByRole('dialog', { name: '在线用户', exact: true });
	const selectedRow = onlineDrawer.locator(`.ant-table-tbody tr[data-row-key="${selected.id}"]`);
	await onlineDrawer.getByRole('button', { name: '刷新', exact: true }).click();
	await selectedRow.getByRole('button', { name: '强制下线 TestUser3', exact: true }).click();
	await admin.page.locator('.ant-modal:visible').getByRole('button', { name: /^取\s*消$/ }).click();
	assert.equal((await rows('TestUser3')).length, 2);
	await selectedRow.getByRole('button', { name: '强制下线 TestUser3', exact: true }).click();
	await admin.page.locator('.ant-modal:visible').getByRole('button', { name: /^确\s*定$/ }).click();
	await expect.poll(async () => (await rows('TestUser3')).length, { timeout: 15_000 }).toBe(1);
	await expect(target.page).toHaveURL(/#\/auth\/login/);
	assert.ok(!peer.page.url().includes('/auth/login'));
	assert.ok([401, 403].includes((await api(target, 'sysAuth/userInfo', undefined, 'GET')).code));
	await expect(admin.page.locator('.ant-modal:visible')).toHaveCount(0);
	report.steps.push('cancel-preserves-session', 'force-offline-only-selected-client');
	const survivor = peer;
	const originalToken = survivor.token;
	const expiry = JSON.parse(Buffer.from(originalToken.split('.')[1], 'base64url').toString('utf8')).exp * 1000;
	await pause(Math.max(0, expiry - Date.now() + 6500));
	await survivor.page.getByRole('button', { name: '在线用户', exact: true }).click();
	await expect.poll(() => survivor.token !== originalToken, { timeout: 20_000 }).toBe(true);
	const renewed = survivor.token;
	proxy.dropWebSockets();
	await expect.poll(() => survivor.sockets.at(-1) === renewed, { timeout: 25_000 }).toBe(true);
	await expect.poll(async () => (await rows('TestUser3')).length, { timeout: 25_000 }).toBe(1);
	report.steps.push('natural-token-renewal', 'reconnect-uses-renewed-token');
	await admin.page.getByRole('dialog', { name: '在线用户', exact: true }).getByRole('button', { name: '关闭', exact: true }).click();
	const oldAdminConnection = admin.connectionId;
	await admin.page.getByRole('button', { name: '切换租户', exact: true }).click();
	const switchDialog = admin.page.getByRole('dialog', { name: '切换租户', exact: true });
	await switchDialog.getByRole('combobox').click();
	await admin.page.getByText('isolated-online-isolated-online', { exact: true }).last().click();
	const switching = admin.page.waitForResponse((response) => response.url().endsWith('/sysTenant/changeTenant'));
	await switchDialog.getByRole('button', { name: /^确\s*定$/ }).click();
	const switched = await (await switching).json();
	assert.equal(switched.code, 200);
	admin.token = switched.result.accessToken;
	admin.refresh = switched.result.refreshToken;
	await expect.poll(async () => {
		const list = await rows('superAdmin.NET');
		return list.length === 1 && String(list[0].tenantId) === '1300000990001' && list[0].connectionId !== oldAdminConnection;
	}, { timeout: 20_000 }).toBe(true);
	report.steps.push('tenant-switch-replaces-identity-and-connection');
	await admin.page.goto(`${proxy.baseUrl}/#/system/pos`);
	await expect(admin.page.getByRole('button', { name: '退出登录' }).or(admin.page.locator('button').filter({ has: admin.page.locator('svg.lucide-log-out') })).first()).toBeVisible();
	await admin.page.getByRole('button', { name: '退出登录' }).or(admin.page.locator('button').filter({ has: admin.page.locator('svg.lucide-log-out') })).first().click();
	const logoutDialog = admin.page.getByRole('dialog');
	await expect(logoutDialog).toBeVisible();
	await logoutDialog.getByRole('button', { name: /^确\s*认$/ }).click();
	await expect(admin.page).toHaveURL(/#\/auth\/login/);
	await expect.poll(() => database.prepare('SELECT COUNT(*) AS count FROM SysOnlineUser WHERE UserName = ?').get('superAdmin.NET').count, { timeout: 15_000 }).toBe(0);
	report.steps.push('logout-removes-current-connection');
	await promisify(execFile)('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true });
	const remainingDrawer = survivor.page.getByRole('dialog', { name: '在线用户', exact: true });
	await remainingDrawer.getByRole('button', { name: '刷新', exact: true }).click();
	await expect(remainingDrawer.getByRole('alert')).toBeVisible();
	await expect(remainingDrawer.getByRole('button', { name: '刷新', exact: true })).toBeEnabled();
	report.steps.push('real-service-outage-visible-and-retryable');
	if (process.argv.includes('--contracts')) {
		const { stdout } = await promisify(execFile)('pwsh', [
			'-NoProfile', '-Command',
			"$ErrorActionPreference = 'Stop'; corepack pnpm exec playwright test online-user-contract.spec.ts cache-contract.spec.ts --workers=2; if ($LASTEXITCODE -ne 0) { throw 'Production browser contracts failed.' }",
		], {
			cwd: join(root, 'Web'), env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl },
			timeout: 180_000, maxBuffer: 2 * 1024 * 1024, windowsHide: true,
		});
		console.log(stdout.split('\n').filter((line) => /passed|failed|skipped/.test(line)).join('\n'));
		report.productionContractsPassed = true;
	}
	report.passed = true;
} catch (error) {
	report.error = error.message.split('Call log:')[0].replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
	const page = admin?.page ?? contexts[0]?.pages()[0];
	if (page) {
		report.path = new URL(page.url()).hash.split('?')[0];
		await page.screenshot({ path: join(evidence, 'online-failure.png'), fullPage: true }).catch(() => {});
	}
	process.exitCode = 1;
} finally {
	for (const connection of connections) await connection.stop().catch(() => {});
	for (const context of contexts) await context.close();
	await browser.close();
	await proxy.close();
	database.close();
	writeFileSync(join(evidence, 'online-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
