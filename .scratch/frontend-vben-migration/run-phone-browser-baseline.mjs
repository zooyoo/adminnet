import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
// Windows 后台进程可能继承管道，启动器退出后 close 事件仍不触发；以显式就绪消息完成启动。
async function launchApi(args) {
	return new Promise((resolve, reject) => {
		const child = spawn('pwsh', args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let stdout = '';
		const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated API startup timed out')); }, 180_000);
		child.stdout.on('data', (chunk) => {
			stdout += chunk.toString();
			if (!stdout.includes('Ready: real sysConfig/sysInfo returned code 200.')) return;
			clearTimeout(timer);
			child.stdout.destroy();
			child.stderr.destroy();
			child.unref();
			resolve({ stdout });
		});
		child.stderr.on('data', () => {});
		child.once('error', (error) => { clearTimeout(timer); reject(error); });
		child.once('exit', (code) => {
			if (code === 0) return;
			clearTimeout(timer);
			reject(new Error(`Isolated API startup failed with exit code ${code}`));
		});
	});
}
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const appRequire = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-api-local-sms-http-receiver', smsPolicy: { expirySeconds: 6, sendIntervalSeconds: 2 }, steps: [], cleanupErrors: [] };
const receipts = new Map();
const codes = new Set();
const name = `accept11-${Date.now()}`;
const phone = '139' + String(Date.now()).slice(-8);
let runtime, base, evidence, db, proxy, browser, context, page, admin, original, schemeId, userId, secondaryUserId, hiddenTenant, stage = 'initialize', failGateway = false, sends = 0;
let reader;
const gateway = createServer(async (request, response) => {
	if (request.method !== 'POST' || request.url !== '/sms') { response.writeHead(404).end(); return; }
	try {
		let body = '';
		for await (const chunk of request) {
			body += chunk;
			if (body.length > 4096) throw new Error('oversized');
		}
		const data = JSON.parse(body);
		assert.equal(data.mobile, phone);
		assert.match(data.code, /^\d{6}$/);
		assert.equal(data.template, '0');
		codes.add(data.code);
		sends++;
		receipts.set(phone, data.code);
		response.writeHead(failGateway ? 503 : 200, { 'Content-Type': 'text/plain' });
		response.end(failGateway ? `REJECTED ${data.code}` : 'ISOLATED_SMS_ACCEPTED');
	} catch {
		response.writeHead(400).end('INVALID_TEST_REQUEST');
	}
});
async function api(session, path, body, method = 'POST', allowFailure = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(35_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	const result = await response.json();
	if (allowFailure) { assert.notEqual(result.code, 200, path); return result; }
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}; ${JSON.stringify(result.errors ?? result.message ?? '')}`);
	return result.result;
}
async function denied(path, body, method) { return api(undefined, path, body, method, true); }
async function sms() {
	await api(undefined, `sysSms/sendSms/${phone}/0`, undefined, 'POST');
	assert.ok(receipts.get(phone));
	return receipts.get(phone);
}
async function solve(challenge, label) {
	const path = join(evidence, `${label}-challenge.png`);
	writeFileSync(path, Buffer.from(challenge.img, 'base64'));
	console.log(`CHALLENGE ${path}`);
	reader ??= createInterface({ input: process.stdin, output: process.stdout, terminal: false });
	if (process.stdin.isTTY) process.stdin.setRawMode(true);
	const answer = (await reader.question('')).trim();
	assert.ok(answer);
	return answer;
}
async function screenshot(file) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.screenshot({ path: join(evidence, file), animations: 'disabled', mask: [page.locator('input[autocomplete=one-time-code]'), page.locator('input[type=password]'), page.locator('.captcha-image')] });
}
async function cleanup() {
	if (secondaryUserId) {
		try {
			await api(admin, 'sysUser/delete', { id: secondaryUserId });
			assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUser WHERE Id = ?').get(secondaryUserId).n, 0);
			secondaryUserId = undefined;
		} catch { report.cleanupErrors.push('delete-password-user'); }
	}
	if (original) {
		try { await api(admin, 'sysConfig/saveSysInfo', original); original = undefined; } catch { report.cleanupErrors.push('restore-site'); }
	}
	if (hiddenTenant) {
		try { await api(admin, 'sysConfig/update', hiddenTenant); hiddenTenant = undefined; } catch { report.cleanupErrors.push('restore-tenant-selector'); }
	}
	if (userId) {
		try {
			await api(admin, 'sysUser/delete', { id: userId });
			assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUser WHERE Id = ?').get(userId).n, 0);
			userId = undefined;
		} catch { report.cleanupErrors.push('delete-user'); }
	}
	if (schemeId) {
		try {
			await api(admin, 'sysUserRegWay/delete', { id: schemeId });
			assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUserRegWay WHERE Id = ?').get(schemeId).n, 0);
			schemeId = undefined;
		} catch { report.cleanupErrors.push('delete-scheme'); }
	}
	report.cleanupPassed = !original && !hiddenTenant && !userId && !secondaryUserId && !schemeId && report.cleanupErrors.length === 0;
}
try {
	await new Promise((resolve) => gateway.listen(0, '127.0.0.1', resolve));
	const { stdout } = await launchApi(['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture',
		'-BuildRoot', join(tmpdir(), 'adminnet-vben-build-11'), '-SmsTestService', `http://127.0.0.1:${gateway.address().port}/sms`, '-SmsTestExpirySeconds', '6']);
	runtime = realpathSync(stdout.match(/Runtime: ([^\r\n]+)/)[1]);
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl);
	assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence');
	mkdirSync(evidence, { recursive: true });
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	const { sm2 } = appRequire('sm-crypto-v2');
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	admin = await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	const owner = await api(admin, 'sysAuth/userInfo', undefined, 'GET');
	const tenantId = owner.currentTenantId;
	const sample = db.prepare('SELECT Id,OrgId,PosId FROM SysUser WHERE Account = ?').get('TestUser3');
	const role = db.prepare('SELECT RoleId FROM SysUserRole WHERE UserId = ? ORDER BY RoleId LIMIT 1').get(sample.Id);
	assert.ok(sample && role);
	schemeId = await api(admin, 'sysUserRegWay/add', { name, tenantId, orgId: sample.OrgId, posId: sample.PosId, roleId: role.RoleId, accountType: 777, orderNo: 100 });
	original = await api(admin, 'sysConfig/sysInfo', undefined, 'GET');
	original.regWayId ??= 0;
	await api(admin, 'sysConfig/saveSysInfo', { ...original, enableReg: 1, regWayId: schemeId });

	if (!process.argv.includes('--password-only')) {
	stage = 'sms-validation-throttle-expiry-and-service-failure';
	await denied('sysSms/sendSms/invalid/0');
	const code = await sms();
	const count = sends;
	await denied(`sysSms/sendSms/${phone}/0`);
	await denied(`sysSms/customSendSms/${phone}/0`);
	assert.equal(sends, count);
	assert.match(JSON.stringify(await denied('sysAuth/loginPhone', { phone, code: '000000' })), /验证码错误/);
	await delay(7000);
	assert.match(JSON.stringify(await denied('sysSms/verifyCode', { phone, code })), /失效/);
	failGateway = true;
	const failure = await denied(`sysSms/sendSms/${phone}/0`);
	assert.ok(!JSON.stringify(failure).includes(receipts.get(phone)), 'Gateway response must not expose the code');
	await denied('sysSms/verifyCode', { phone, code: receipts.get(phone) });
	failGateway = false;
	report.steps.push(stage);

	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
	stage = 'production-phone-gateway-failure';
	await page.goto(`${proxy.baseUrl}/#/auth/code-login`);
	await page.getByLabel('手机号码', { exact: true }).fill(phone);
	failGateway = true;
	await page.getByRole('button', { name: '获取验证码', exact: true }).click();
	await expect(page.locator('.account-form').getByRole('alert')).toContainText('短信发送失败');
	await expect(page.getByRole('button', { name: '获取验证码', exact: true })).toBeEnabled();
	await expect(page.getByLabel('手机号码', { exact: true })).toHaveValue(phone);
	await page.screenshot({ path: join(evidence, 'phone-gateway-failure.png'), animations: 'disabled' });
	failGateway = false;
	report.steps.push(stage);
	stage = 'real-registration-invalid-captcha-and-success';
	await page.goto(`${proxy.baseUrl}/#/auth/register`);
	await page.getByLabel('账号', { exact: true }).fill(name);
	await page.getByLabel('姓名', { exact: true }).fill('隔离注册用户');
	await page.getByLabel('手机号码', { exact: true }).fill(phone);
	await screenshot('registration-desktop.png');
	await page.getByLabel('验证码', { exact: true }).fill('invalid');
	const [rejected, refreshed] = await Promise.all([
		page.waitForResponse((r) => r.url().endsWith('/sysAuth/userRegistration')),
		page.waitForResponse((r) => r.url().endsWith('/sysAuth/captcha')),
		page.getByRole('button', { name: /^注\s*册$/ }).click(),
	]);
	assert.notEqual((await rejected.json()).code, 200);
	const challenge = (await refreshed.json()).result;
	await page.getByLabel('验证码', { exact: true }).fill(await solve(challenge, 'registration'));
	const [registered] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysAuth/userRegistration')), page.getByRole('button', { name: /^注\s*册$/ }).click()]);
	assert.equal((await registered.json()).code, 200);
	userId = db.prepare('SELECT Id FROM SysUser WHERE Account = ?').get(name)?.Id;
	assert.ok(userId);
	const user = db.prepare('SELECT TenantId,AccountType,OrgId,PosId FROM SysUser WHERE Id = ?').get(userId);
	assert.deepEqual({ ...user }, { TenantId: tenantId, AccountType: 777, OrgId: sample.OrgId, PosId: sample.PosId });
	assert.deepEqual(db.prepare('SELECT RoleId FROM SysUserRole WHERE UserId = ?').all(userId).map((row) => row.RoleId), [role.RoleId]);
	await expect(page).toHaveURL(/#\/auth\/login/);
	const defaultPasswordLogin = await api(undefined, 'sysAuth/login', { account: name, password: sm2.doEncrypt(password, publicKey, 1), tenantId });
	assert.equal((await api(defaultPasswordLogin, 'sysAuth/userInfo', undefined, 'GET')).account, name);
	await api(defaultPasswordLogin, 'sysAuth/logout');
	report.steps.push(stage);

	stage = 'production-phone-login-and-consumed-code';
	await page.getByRole('button', { name: '手机登录', exact: true }).click();
	await page.getByLabel('手机号码', { exact: true }).fill(phone);
	const [sent] = await Promise.all([page.waitForResponse((r) => r.url().includes('/sysSms/sendSms/')), page.getByRole('button', { name: '获取验证码', exact: true }).click()]);
	assert.equal((await sent.json()).code, 200);
	await expect(page.getByRole('button', { name: /\d+ 秒/ })).toBeDisabled();
	await page.screenshot({ path: join(evidence, 'phone-code-sent.png'), animations: 'disabled', mask: [page.locator('input[autocomplete=one-time-code]')] });
	const delivered = receipts.get(phone);
	await page.getByLabel('验证码', { exact: true }).fill(delivered);
	const [loggedIn] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysAuth/loginPhone')), page.getByRole('button', { name: /^登\s*录$/ }).click()]);
	const login = await loggedIn.json();
	assert.equal(login.code, 200);
	const current = await api(login.result, 'sysAuth/userInfo', undefined, 'GET');
	assert.equal(current.account, name);
	assert.equal(current.currentTenantId, tenantId);
	assert.equal(current.accountType, 777);
	assert.match(JSON.stringify(await denied('sysAuth/loginPhone', { phone, code: delivered })), /失效/);
	await expect(page).not.toHaveURL(/#\/auth\//);
	await screenshot('phone-login-desktop.png');
	report.steps.push(stage);

	stage = 'registration-disabled-and-invalid-scheme';
	await api(admin, 'sysConfig/saveSysInfo', { ...original, enableReg: 2 });
	let captcha = await api(undefined, 'sysAuth/captcha', undefined, 'GET');
	const closed = await denied('sysAuth/userRegistration', { account: `${name}-closed`, realName: '关闭测试', phone, codeId: captcha.id, code: await solve(captcha, 'closed-registration'), tenantId, wayId: schemeId });
	assert.match(JSON.stringify(closed), /D1034/);
	await api(admin, 'sysConfig/saveSysInfo', { ...original, enableReg: 1, regWayId: schemeId });
	captcha = await api(undefined, 'sysAuth/captcha', undefined, 'GET');
	const invalid = await denied('sysAuth/userRegistration', { account: `${name}-invalid`, realName: '方案测试', phone, codeId: captcha.id, code: await solve(captcha, 'invalid-scheme'), tenantId, wayId: 999999999 });
	assert.match(JSON.stringify(invalid), /D1035/);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUser WHERE Account LIKE ?').get(`${name}%`).n, 1);
	report.steps.push(stage);

	}
	stage = 'registration-optional-password-login';
	const customPassword = `Isolated!${Date.now()}`;
	codes.add(customPassword);
	const captcha = await api(undefined, 'sysAuth/captcha', undefined, 'GET');
	await api(undefined, 'sysAuth/userRegistration', { account: `${name}-pwd`, realName: '密码测试', phone: `138${phone.slice(3)}`, password: sm2.doEncrypt(customPassword, publicKey, 1),
		codeId: captcha.id, code: await solve(captcha, 'password-registration'), tenantId, wayId: schemeId });
	secondaryUserId = db.prepare('SELECT Id FROM SysUser WHERE Account = ?').get(`${name}-pwd`)?.Id;
	assert.ok(secondaryUserId);
	const storedPassword = db.prepare('SELECT Password FROM SysUser WHERE Id = ?').get(secondaryUserId).Password;
	const cipherSettings = JSON.parse(readFileSync(join(runtime, 'appsettings.json'), 'utf8').replace(/^\uFEFF/, '')).Cryptogram;
	const decrypted = [];
	if (cipherSettings.CryptoType === 'SM2') {
		for (const candidate of [storedPassword, storedPassword?.slice(2)]) {
			try { decrypted.push(sm2.doDecrypt(candidate, cipherSettings.PrivateKey, 1)); } catch { /* 只记录比较结果。 */ }
		}
	}
	report.passwordStorage = { present: Boolean(storedPassword), cipherType: cipherSettings.CryptoType,
		matchesCustom: cipherSettings.CryptoType === 'MD5' ? storedPassword?.toLowerCase() === createHash('md5').update(customPassword).digest('hex') : decrypted.includes(customPassword),
		matchesDefault: decrypted.includes(password) };
	const passwordLogin = await api(undefined, 'sysAuth/login', { account: `${name}-pwd`, password: sm2.doEncrypt(customPassword, publicKey, 1), tenantId });
	assert.equal((await api(passwordLogin, 'sysAuth/userInfo', undefined, 'GET')).account, `${name}-pwd`);
	await api(passwordLogin, 'sysAuth/logout');
	report.steps.push(stage);

	if (userId) {
	stage = 'phone-tenant-and-disabled-account';
	await delay(2200);
	let fresh = await sms();
	assert.match(JSON.stringify(await denied('sysAuth/loginPhone', { phone, code: fresh, tenantId: 1300000990001 })), /D1000/);
	await api(admin, 'sysUser/setStatus', { id: userId, status: 2 });
	await delay(2200);
	fresh = await sms();
	assert.match(JSON.stringify(await denied('sysAuth/loginPhone', { phone, code: fresh })), /D1017/);
	await api(admin, 'sysUser/setStatus', { id: userId, status: 1 });
	report.steps.push(stage);
	}

	stage = 'cleanup-and-log-redaction';
	await cleanup();
	assert.equal(report.cleanupPassed, true);
	for (const filename of ['stdout.log', 'stderr.log']) {
		const content = readFileSync(join(runtime, filename), 'utf8');
		for (const secret of codes) assert.ok(!content.includes(secret), 'Application log contains an SMS code');
	}
	report.steps.push(stage);
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = error.message;
	for (const secret of codes) report.error = report.error.replaceAll(secret, '[redacted]');
	process.exitCode = 1;
	if (page && evidence) await page.screenshot({ path: join(evidence, 'phone-failure.png'), mask: [page.locator('input[autocomplete=one-time-code]'), page.locator('input[type=password]'), page.locator('.captcha-image')] }).catch(() => {});
} finally {
	reader?.close();
	if (process.stdin.isTTY) process.stdin.setRawMode(false);
	if (admin && db) await cleanup();
	await context?.close();
	await browser?.close();
	await proxy?.close();
	db?.close();
	if (runtime) {
		try { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true }); }
		catch { report.cleanupErrors.push('stop-api'); report.cleanupPassed = false; }
	}
	await new Promise((resolve) => gateway.close(resolve));
	receipts.clear();
	codes.clear();
	if (evidence) writeFileSync(join(evidence, 'phone-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
