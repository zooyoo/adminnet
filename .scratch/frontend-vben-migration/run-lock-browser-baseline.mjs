import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-isolated-api', steps: [], cleanupErrors: [] };
let runtime, evidence, base, proxy, browser, context, page, password, publicKey, currentToken, stage = 'initialize';
const secrets = [];
async function launchApi() {
	return new Promise((resolve, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture', '-BuildRoot', join(tmpdir(), 'adminnet-vben-build-14')],
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
async function api(token, path, data) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
		body: JSON.stringify(data), signal: AbortSignal.timeout(30_000),
	});
	const result = await response.json();
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}`);
	return result.result;
}
async function login() {
	// 令牌采用秒级签发时间，避免复用上一轮已撤销的同秒令牌。
	await delay(1100);
	const session = await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(session.accessToken, session.refreshToken);
	const exchange = page.waitForResponse((response) => response.url().includes('/sysAuth/refreshToken?'));
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(session.accessToken)}&redirect=${encodeURIComponent('/system/pos?from=lock')}`);
	const adopted = (await (await exchange).json()).result;
	secrets.push(adopted.accessToken, adopted.refreshToken);
	currentToken = adopted.accessToken;
	await expect(page).toHaveURL(/#\/system\/pos\?from=lock$/);
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
}
async function lock() {
	await page.getByRole('button', { name: '锁定屏幕', exact: true }).click();
	await expect(page.getByRole('dialog', { name: '屏幕已锁定' })).toBeVisible();
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeHidden();
}
async function submit(value) {
	const dialog = page.getByRole('dialog', { name: '屏幕已锁定' });
	await dialog.getByLabel('账号密码', { exact: true }).fill(value);
	const [response] = await Promise.all([
		page.waitForResponse((response) => response.url().includes('/sysAuth/unLockScreen?')),
		dialog.getByRole('button', { name: /^解\s*锁$/ }).click(),
	]);
	return response;
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
		animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), mask: [page.locator('input[type=password]')] });
}
async function stopApi() {
	await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30_000 });
}
try {
	runtime = await launchApi();
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl);
	assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey);
	secrets.push(password);
	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
	page.on('response', (response) => {
		const token = response.headers()['access-token'];
		if (token && token !== 'invalid_token') { currentToken = token; secrets.push(token); }
	});
	await login();
	stage = 'wrong-password-and-refresh';
	await lock();
	const wrong = await submit('isolated-wrong-password');
	assert.notEqual((await wrong.json()).code, 200);
	const dialog = page.getByRole('dialog', { name: '屏幕已锁定' });
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(dialog.getByLabel('账号密码', { exact: true })).toHaveValue('');
	await page.reload();
	await expect(dialog).toBeVisible();
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeHidden();
	await page.keyboard.press('Escape');
	await expect(dialog).toBeVisible();
	await shot('locked-after-refresh.png');
	report.steps.push(stage);
	stage = 'real-unlock-restores-context';
	assert.equal((await (await submit(password)).json()).result, true);
	await expect(dialog).toBeHidden();
	await expect(page).toHaveURL(/#\/system\/pos\?from=lock$/);
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
	await shot('unlocked-position.png');
	report.steps.push(stage);
	stage = 'ordinary-account-unlock';
	const ordinary = await api(undefined, 'sysAuth/login', { account: 'TestUser3', password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(ordinary.accessToken, ordinary.refreshToken);
	const encrypted = sm2.doEncrypt(password, publicKey, 1);
	assert.equal(await api(ordinary.accessToken, `sysAuth/unLockScreen?password=${encodeURIComponent(encrypted)}`), true);
	await api(ordinary.accessToken, 'sysAuth/logout');
	report.steps.push(stage);
	stage = 'revoked-identity';
	await lock();
	await api(currentToken, 'sysAuth/logout');
	await submit(password);
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await expect(dialog).toHaveCount(0);
	report.steps.push(stage);
	stage = 'active-logout';
	await login();
	await lock();
	await dialog.getByRole('button', { name: '退出登录', exact: true }).click();
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await page.goto(`${proxy.baseUrl}/#/system/pos`);
	await expect(page).toHaveURL(/#\/auth\/login/);
	report.steps.push(stage);
	stage = 'real-service-outage';
	await login();
	await lock();
	await stopApi();
	assert.equal((await submit(password)).status(), 502);
	await expect(dialog.getByRole('alert')).toBeVisible();
	await expect(dialog.getByRole('button', { name: /^解\s*锁$/ })).toBeEnabled();
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeHidden();
	await shot('lock-outage.png');
	await dialog.getByRole('button', { name: '退出登录', exact: true }).click();
	await expect(page).toHaveURL(/#\/auth\/login/);
	await expect(dialog).toHaveCount(0);
	report.steps.push(stage);
	report.passed = true;
} catch (error) {
	let message = String(error.message ?? error);
	for (const value of secrets) if (value) message = message.replaceAll(value, '[REDACTED]');
	report.error = { stage, message };
	process.exitCode = 1;
} finally {
	for (const [name, action] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => runtime && stopApi()]]) {
		try { await action(); } catch { report.cleanupErrors.push(name); process.exitCode = 1; }
	}
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (evidence) writeFileSync(join(evidence, 'lock-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
