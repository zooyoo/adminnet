import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-isolated-api', steps: [], cleanupErrors: [] };
let runtime, evidence, base, proxy, browser, context, page, stage = 'initialize';
const secrets = [];
async function launchApi() {
	return new Promise((resolve, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture', '-BuildRoot', join(tmpdir(), 'adminnet-vben-build-13')],
			{ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated API startup timeout')); }, 180_000);
		child.stdout.on('data', (chunk) => {
			output += chunk.toString();
			if (!output.includes('Ready: real sysConfig/sysInfo returned code 200.')) return;
			clearTimeout(timer);
			child.stdout.destroy(); child.stderr.destroy(); child.unref();
			resolve(realpathSync(output.match(/Runtime: ([^\r\n]+)/)[1]));
		});
		child.stderr.on('data', () => {});
		child.once('error', reject);
		child.once('exit', (code) => { if (code) { clearTimeout(timer); reject(new Error('Isolated API startup failed')); } });
	});
}
async function api(token, path, data, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: method === 'POST' ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30_000),
	});
	if (refusal && [401, 403].includes(response.status)) return;
	const body = await response.json();
	if (refusal) { assert.notEqual(body.code, 200); return; }
	assert.equal(body.code, 200, `${path.split('?')[0]} code=${body.code}`);
	return body.result;
}
async function openContext() {
	await context?.close();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
		animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name) });
}
try {
	runtime = await launchApi();
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl);
	assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence');
	mkdirSync(evidence, { recursive: true });
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey);
	const source = await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	const expiring = await api(undefined, 'sysAuth/login', { account: 'TestUser3', password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(expiring.accessToken, expiring.refreshToken);
	secrets.push(source.accessToken, source.refreshToken);
	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch({ headless: true });
	await openContext();
	stage = 'valid-token';
	const exchangeResponse = page.waitForResponse((response) => response.url().includes('/api/sysAuth/refreshToken?'));
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(source.accessToken)}&redirect=%2Fsystem%2Fpos&params=${encodeURIComponent('{"from":"legacy"}')}`);
	const exchanged = (await (await exchangeResponse).json()).result;
	assert.ok(exchanged.accessToken && exchanged.refreshToken);
	secrets.push(exchanged.accessToken, exchanged.refreshToken);
	await expect(page).toHaveURL(/#\/system\/pos\?from=legacy$/);
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
	assert.equal(page.url().includes('token='), false);
	await page.reload();
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
	await shot('token-login-position.png');
	report.steps.push(stage);
	stage = 'ordinary-identity-permissions';
	const ordinaryInfo = await api(expiring.accessToken, 'sysAuth/userInfo', undefined, 'GET');
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(expiring.accessToken)}&redirect=%2Fsystem%2Fpos`);
	await expect(page).toHaveURL(/#\/system\/pos$/);
	await expect(page.getByRole('button', { name: ordinaryInfo.realName, exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toHaveCount(0);
	await api(expiring.accessToken, 'sysPos/add', { name: 'isolated-forbidden-token', code: 'isolated-forbidden-token' }, 'POST', true);
	report.steps.push(stage);
	stage = 'revoked-token';
	await context.close(); context = undefined;
	await api(exchanged.accessToken, 'sysAuth/logout');
	await api(exchanged.accessToken, `sysAuth/refreshToken?accessToken=${encodeURIComponent(exchanged.accessToken)}`, undefined, 'GET', true);
	await openContext();
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(exchanged.accessToken)}`);
	await expect(page.getByRole('alert')).toBeVisible();
	assert.equal(page.url().includes('token='), false);
	await page.getByRole('button', { name: '返回账号登录' }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	report.steps.push(stage);
	stage = 'invalid-signature';
	const parts = source.accessToken.split('.');
	parts[2] = `${parts[2][0] === 'a' ? 'b' : 'a'}${parts[2].slice(1)}`;
	const invalid = parts.join('.');
	secrets.push(invalid);
	await api(invalid, `sysAuth/refreshToken?accessToken=${encodeURIComponent(invalid)}`, undefined, 'GET', true);
	const invalidResponse = page.waitForResponse((response) => response.url().includes('/api/sysAuth/refreshToken?'));
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(invalid)}`);
	await invalidResponse;
	await expect(page.getByRole('heading', { name: '第三方登录', exact: true })).toBeVisible();
	await expect(page.getByRole('alert')).toBeVisible();
	await shot('token-rejected.png');
	report.steps.push(stage);
	stage = 'expired-token';
	const expiry = JSON.parse(Buffer.from(expiring.accessToken.split('.')[1], 'base64url').toString()).exp * 1000;
	assert.ok(expiry - Date.now() < 65_000, 'Fixture must issue short-lived real tokens');
	console.log('Waiting for the isolated access token to expire naturally.');
	while (Date.now() <= expiry + 6000) await delay(Math.min(10_000, expiry + 6001 - Date.now()));
	const expired = expiring.accessToken;
	await api(expired, `sysAuth/refreshToken?accessToken=${encodeURIComponent(expired)}`, undefined, 'GET', true);
	let exchangeCount = 0;
	page.on('request', (request) => { if (request.url().includes('/sysAuth/refreshToken?')) exchangeCount++; });
	await page.goto(`${proxy.baseUrl}/#/login?token=${expired}`);
	await expect(page.getByRole('alert')).toContainText('登录令牌无效或已过期');
	assert.equal(exchangeCount, 0);
	report.steps.push('real-expired-token-api-and-browser-rejection');
	stage = 'qr-compatibility';
	await page.goto(`${proxy.baseUrl}/#/auth/qrcode-login`);
	await expect(page.getByRole('alert')).toContainText('当前站点未开通扫码登录');
	await shot('qrcode-unavailable.png');
	report.steps.push(stage);
	stage = 'service-outage';
	const outageSource = await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(outageSource.accessToken, outageSource.refreshToken);
	await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30_000 });
	const outageResponse = page.waitForResponse((response) => response.url().includes('/api/sysAuth/refreshToken?'));
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(outageSource.accessToken)}`);
	assert.equal((await outageResponse).status(), 502);
	await expect(page.getByRole('heading', { name: '第三方登录', exact: true })).toBeVisible();
	await expect(page.locator('#app').getByRole('alert')).toBeVisible();
	assert.equal(page.url().includes('token='), false);
	await shot('token-outage.png');
	await page.getByRole('button', { name: '返回账号登录' }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	report.steps.push(stage);
	report.passed = true;
} catch (error) {
	let message = String(error.message ?? error);
	for (const value of secrets) if (value) message = message.replaceAll(value, '[REDACTED]');
	report.error = { stage, message };
	process.exitCode = 1;
} finally {
	for (const [name, action] of [
		['browser', () => browser?.close()],
		['proxy', () => proxy?.close()],
		['api', () => runtime && execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30_000 })],
	]) {
		try { await action(); } catch { report.cleanupErrors.push(name); process.exitCode = 1; }
	}
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (evidence) writeFileSync(join(evidence, 'token-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
