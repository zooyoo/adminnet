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
let runtime, evidence, base, proxy, browser, context, page, db, password, publicKey, admin, ordinary, original, originalSite, originalGrants, changedPassword = false, stage = 'initialize';
const newPassword = `Isolated!${randomBytes(16).toString('hex')}`;
const secrets = [newPassword];
const uploaded = [];
async function launchApi() {
	return new Promise((resolve, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture', '-BuildRoot', join(tmpdir(), 'adminnet-vben-build-15')],
			{ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated API startup timeout')); }, 180_000);
		child.stdout.on('data', (chunk) => {
			output += chunk.toString();
			if (!output.includes('Ready: real sysConfig/sysInfo returned code 200.')) return;
			clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy(); child.unref();
			resolve(realpathSync(output.match(/Runtime: ([^\r\n]+)/)[1]));
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
	const result = await response.json();
	if (refusal) { assert.notEqual(result.code, 200); return; }
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}; ${JSON.stringify(result.errors ?? result.message ?? '')}`);
	return result.result;
}
async function login(account, value = password) {
	const result = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(value, publicKey, 1) });
	secrets.push(result.accessToken, result.refreshToken);
	return result;
}
async function browserLogin(session, target = '/profile') {
	await context?.close();
	context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
	page = await context.newPage(); page.setDefaultTimeout(20_000);
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(session.accessToken)}&redirect=${encodeURIComponent(target)}`);
	await expect(page.getByLabel('真实姓名', { exact: true })).toBeVisible();
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
		animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), fullPage: true, mask: [page.locator('input[type=password]')] });
}
async function watermarkContents() {
	return page.evaluate(() => [...document.querySelectorAll('div')].filter((element) => element.__WATERMARK__ === 'watermark')
		.map((element) => element.__WATERMARK__INSTANCE__?.options?.content));
}
async function storedPreference(suffix) {
	return page.evaluate((ending) => {
		const key = Object.keys(localStorage).find((item) => item.endsWith(ending));
		return key ? JSON.parse(localStorage.getItem(key)).value : undefined;
	}, suffix);
}
async function saveProfile() {
	await page.getByRole('button', { name: '保存基本信息', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确定修改个人基础信息？' });
	const [response] = await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/sysUser/baseInfo') && response.request().method() === 'POST'),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	assert.equal((await response.json()).code, 200);
	await expect(dialog).toBeHidden();
}
async function selectImage(label) {
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: label, exact: true }).click();
	await (await chooser).setFiles(join(root, 'Web/apps/web-antdv-next/public/logo.png'));
}
async function cleanup() {
	if (changedPassword) {
		try {
			admin = await login('superAdmin.NET', newPassword);
			await api(admin, 'sysUser/changePwd', { passwordOld: sm2.doEncrypt(newPassword, publicKey, 1), passwordNew: sm2.doEncrypt(password, publicKey, 1) });
			changedPassword = false;
		} catch { report.cleanupErrors.push('restore-password'); }
	}
	if (original) {
		try {
			await api(admin, 'sysUser/baseInfo', original);
			assert.equal(db.prepare('SELECT RealName, NickName, Phone, Avatar, Signature FROM SysUser WHERE Id = ?').get(original.id).RealName, original.realName);
			original = undefined;
		} catch { report.cleanupErrors.push('restore-profile'); }
	}
	if (originalSite) {
		try { await api(admin, 'sysConfig/saveSysInfo', originalSite); originalSite = undefined; }
		catch { report.cleanupErrors.push('restore-site'); }
	}
	if (originalGrants) {
		try { await api(admin, 'sysRole/grantMenu', { id: 1300000990201, menuIdList: originalGrants }); originalGrants = undefined; }
		catch { report.cleanupErrors.push('restore-role-grants'); }
	}
	for (const id of uploaded) {
		try {
			await api(admin, 'sysFile/delete', { id });
			assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysFile WHERE Id = ?').get(id).n, 0);
		}
		catch { report.cleanupErrors.push('delete-upload'); }
	}
	report.cleanupPassed = report.cleanupErrors.length === 0 && !original && !originalSite && !originalGrants && !changedPassword;
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
	base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true }); db.exec('PRAGMA busy_timeout=5000');
	password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey); secrets.push(password);
	admin = await login('superAdmin.NET'); ordinary = await login('TestUser3');
	original = await api(admin, 'sysUser/baseInfo', undefined, 'GET');
	originalSite = await api(admin, 'sysConfig/sysInfo', undefined, 'GET');
	originalSite.regWayId ??= 0;
	await api(admin, 'sysConfig/saveSysInfo', { ...originalSite, watermark: '隔离资料水印' });
	stage = 'identity-boundary';
	originalGrants = db.prepare('SELECT MenuId FROM SysRoleMenu WHERE RoleId = ?').all(1300000990201).map((row) => row.MenuId);
	const profilePermission = db.prepare('SELECT Id FROM SysMenu WHERE Permission = ?').get('sysUser:baseInfo');
	assert.ok(profilePermission);
	await api(admin, 'sysRole/grantMenu', { id: 1300000990201, menuIdList: [...new Set([...originalGrants, profilePermission.Id])] });
	ordinary = await login('TestUser3');
	const ownProfile = await api(ordinary, 'sysUser/baseInfo', undefined, 'GET');
	await api(ordinary, 'sysUser/baseInfo', ownProfile);
	await api(ordinary, 'sysUser/baseInfo', { ...original, realName: 'forbidden-profile' }, 'POST', true);
	await api(admin, 'sysUser/baseInfo', { ...original, realName: '' }, 'POST', true);
	await api(admin, 'sysUser/baseInfo', { ...original, tenantId: 1300000990001, accountType: 777, status: 2, orgId: 0, posId: 0 });
	const identity = db.prepare('SELECT TenantId, AccountType, Status, OrgId, PosId FROM SysUser WHERE Id = ?').get(original.id);
	assert.equal(identity.TenantId, original.tenantId); assert.equal(identity.AccountType, original.accountType);
	assert.equal(identity.Status, original.status); assert.equal(identity.OrgId, original.orgId); assert.equal(identity.PosId, original.posId);
	report.steps.push(stage);
	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch({ headless: true });
	await browserLogin(admin);
	stage = 'profile-save-and-reload';
	await page.getByLabel('真实姓名', { exact: true }).fill('隔离个人资料');
	await page.getByLabel('昵称', { exact: true }).fill('隔离昵称');
	await page.getByLabel('手机号码', { exact: true }).fill('13900001515');
	await page.getByLabel('出生日期', { exact: true }).fill('1990-01-02');
	await page.getByLabel('备注', { exact: true }).fill('隔离资料备注');
	await saveProfile();
	assert.equal(db.prepare('SELECT RealName FROM SysUser WHERE Id = ?').get(original.id).RealName, '隔离个人资料');
	await page.reload();
	await expect(page.getByLabel('昵称', { exact: true })).toHaveValue('隔离昵称');
	await expect.poll(watermarkContents).toEqual(['隔离资料水印-隔离个人资料']);
	await shot('profile-saved.png');
	report.steps.push(stage);
	stage = 'avatar-crop-upload';
	await selectImage('更换头像');
	const crop = page.getByRole('dialog', { name: '更换头像', exact: true });
	await expect(crop.locator('img').first()).toBeVisible();
	const [avatarResponse] = await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/sysFile/uploadAvatar')),
		crop.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	const avatarBody = await avatarResponse.json();
	assert.equal(avatarBody.code, 200, JSON.stringify(avatarBody.errors ?? avatarBody.message));
	const avatar = avatarBody.result;
	assert.ok(avatar?.id); uploaded.push(avatar.id);
	await expect(crop).toBeHidden();
	await expect.poll(() => page.getByAltText('个人头像', { exact: true }).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	assert.ok(db.prepare('SELECT Avatar FROM SysUser WHERE Id = ?').get(original.id).Avatar.includes(String(avatar.id)));
	report.steps.push(stage);
	stage = 'signature-draw-upload';
	await page.getByRole('button', { name: '电子签名', exact: true }).click();
	const sign = page.getByRole('dialog', { name: '电子签名', exact: true });
	const canvas = sign.getByLabel('签名画布');
	await expect(canvas).toBeVisible();
	await expect.poll(() => canvas.evaluate((element) => element.width)).toBeGreaterThan(300);
	const box = await canvas.boundingBox(); assert.ok(box);
	await page.mouse.move(box.x + 40, box.y + 70); await page.mouse.down();
	await page.mouse.move(box.x + 190, box.y + 130, { steps: 15 }); await page.mouse.move(box.x + 310, box.y + 65, { steps: 15 }); await page.mouse.up();
	const [signResponse] = await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/sysFile/uploadSignature')),
		sign.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	const signatureBody = await signResponse.json();
	assert.equal(signatureBody.code, 200, JSON.stringify(signatureBody.errors ?? signatureBody.message));
	const signature = signatureBody.result;
	assert.ok(signature?.id); uploaded.push(signature.id);
	await expect(sign).toBeHidden();
	await expect.poll(() => page.getByAltText('电子签名', { exact: true }).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	await shot('profile-images.png');
	report.steps.push(stage);
	stage = 'organization-and-theme';
	await page.getByRole('tab', { name: '组织机构', exact: true }).click();
	await expect(page.getByRole('tree')).toBeVisible();
	await page.getByRole('tab', { name: '基础信息', exact: true }).click();
	const dark = await page.locator('html').evaluate((element) => element.classList.contains('dark'));
	await page.getByRole('button', { name: dark ? 'light' : 'dark', exact: true }).click();
	await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(!dark);
	await expect.poll(() => storedPreference('-preferences-theme')).toBe(dark ? 'light' : 'dark');
	report.steps.push('theme-switched-and-persisted');
	await page.reload();
	await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(!dark);
	await page.getByRole('button', { name: '语言', exact: true }).click();
	await page.getByRole('menuitem', { name: 'English', exact: true }).click();
	await expect(page.getByRole('button', { name: 'Language', exact: true })).toBeVisible();
	await expect.poll(() => storedPreference('-preferences-locale')).toBe('en-US');
	await page.reload();
	await expect(page.getByRole('button', { name: 'Language', exact: true })).toBeVisible();
	await page.getByRole('button', { name: 'Language', exact: true }).click();
	await page.getByRole('menuitem', { name: '简体中文', exact: true }).click();
	await expect(page.getByRole('button', { name: '语言', exact: true })).toBeVisible();
	await shot('profile-theme.png');
	report.steps.push(stage);
	stage = 'password-change-real-login';
	await page.getByRole('tab', { name: '修改密码', exact: true }).click();
	await page.getByLabel('当前密码', { exact: true }).fill(password);
	await page.getByLabel('新密码', { exact: true }).fill(newPassword);
	await page.getByLabel('确认密码', { exact: true }).fill(newPassword);
	const [passwordResponse] = await Promise.all([
		page.waitForResponse((response) => response.url().endsWith('/sysUser/changePwd')),
		page.getByRole('button', { name: '修改密码', exact: true }).click(),
	]);
	assert.equal((await passwordResponse.json()).code, 200); changedPassword = true;
	await expect(page.getByLabel('账号', { exact: true })).toBeVisible();
	await expect.poll(watermarkContents).toEqual([]);
	assert.equal(readFileSync(join(runtime, 'stdout.log'), 'utf8').includes(newPassword), false, 'Password must not appear in service output');
	admin = await login('superAdmin.NET', newPassword);
	await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) }, 'POST', true);
	report.steps.push(stage);
	stage = 'account-watermark-isolation';
	await browserLogin(admin);
	ordinary = await login('TestUser3');
	const ordinaryInfo = await api(ordinary, 'sysAuth/userInfo', undefined, 'GET');
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(ordinary.accessToken)}&redirect=%2Fsystem%2Fpos`);
	await expect(page).toHaveURL(/#\/system\/pos$/);
	await expect.poll(watermarkContents).toEqual([`隔离资料水印-${ordinaryInfo.realName}`]);
	assert.equal(await page.evaluate(() => JSON.stringify(localStorage).includes('隔离资料水印-隔离个人资料')), false);
	report.steps.push(stage);
	await cleanup();
	assert.equal(report.cleanupPassed, true);
	stage = 'real-service-outage';
	admin = await login('superAdmin.NET');
	await browserLogin(admin);
	await page.getByLabel('真实姓名', { exact: true }).fill('停机草稿');
	await page.getByLabel('手机号码', { exact: true }).fill('13900001515');
	await page.getByLabel('出生日期', { exact: true }).fill('1990-01-02');
	await page.getByRole('button', { name: '保存基本信息', exact: true }).click();
	await stopApi();
	const confirm = page.getByRole('dialog', { name: '确定修改个人基础信息？' });
	const [outage] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysUser/baseInfo') && response.request().method() === 'POST'), confirm.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.equal(outage.status(), 502);
	await expect(confirm.getByRole('alert')).toBeVisible();
	await confirm.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(page.getByLabel('真实姓名', { exact: true })).toHaveValue('停机草稿');
	await shot('profile-outage.png');
	report.steps.push(stage);
	report.passed = true;
} catch (error) {
	let message = String(error.message ?? error);
	for (const value of secrets) if (value) message = message.replaceAll(value, '[REDACTED]');
	report.error = { stage, message }; process.exitCode = 1;
} finally {
	if (!report.cleanupPassed && admin) await cleanup();
	for (const [name, action] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['database', () => db?.close()], ['api', () => runtime && stopApi()]]) {
		try { await action(); } catch { report.cleanupErrors.push(name); process.exitCode = 1; }
	}
	report.cleanupPassed = report.cleanupPassed && report.cleanupErrors.length === 0;
	if (evidence) writeFileSync(join(evidence, 'profile-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
