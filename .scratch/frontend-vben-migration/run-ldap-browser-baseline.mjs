import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const name = `ldap12-${Date.now()}`;
const container = `adminnet-${name}`;
const bindPassword = randomBytes(28).toString('hex');
const directoryPassword = randomBytes(20).toString('hex');
const directoryAccount = 'isolated-directory-user';
const baseDn = 'dc=isolated,dc=test';
const bindDn = `cn=admin,${baseDn}`;
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-api-openldap-container', steps: [], cleanupErrors: [] };
let runtime, evidence, base, db, admin, ordinary, ldapId, domainConfig, browser, context, page, proxy, tenantId, containerCreated = false, stage = 'initialize';
let orgIds = [];
async function launchApi() {
	return new Promise((resolve, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture', '-BuildRoot', join(tmpdir(), 'adminnet-vben-build-12')],
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
async function docker(args, input) {
	if (!input) return execute('docker', args, { windowsHide: true, timeout: 60_000, maxBuffer: 1024 * 1024 });
	return new Promise((resolve, reject) => {
		const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
		let output = '';
		child.stdout.on('data', (chunk) => { output += chunk; });
		child.stderr.on('data', () => {});
		child.on('error', reject);
		child.on('close', (code) => code === 0 ? resolve({ stdout: output }) : reject(new Error(`LDAP fixture import failed (${code})`)));
		child.stdin.end(input);
	});
}
async function api(session, path, data, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(35_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	if (refusal && [401, 403].includes(response.status)) return;
	const result = await response.json();
	if (refusal) { assert.notEqual(result.code, 200, path); return result; }
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}; ${JSON.stringify(result.errors ?? result.message ?? '')}`);
	return result.result;
}
async function shot(file) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.locator('.ant-table-content, .ant-table-body').evaluateAll((items) => items.forEach((item) => { item.scrollLeft = 0; }));
	await page.screenshot({ path: join(evidence, file), animations: 'disabled', mask: [page.locator('input[type=password]')] });
}
async function confirmAction(label, endpoint) {
	await page.locator(`tr[data-row-key="${ldapId}"]`).getByRole('button', { name: label, exact: true }).click();
	const confirm = page.getByRole('dialog');
	const [response] = await Promise.all([page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === 'POST'), confirm.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.equal((await response.json()).code, 200);
	await expect(confirm).toBeHidden();
}
async function cleanup() {
	if (domainConfig) {
		try { await api(admin, 'sysConfig/update', domainConfig); domainConfig = undefined; } catch { report.cleanupErrors.push('restore-domain-login'); }
	}
	if (ldapId) {
		try {
			await api(admin, 'sysLdap/delete', { id: ldapId });
			assert.equal(db.prepare('SELECT IsDelete FROM SysLdap WHERE Id = ?').get(ldapId).IsDelete, 1);
			assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUserLdap WHERE Account = ?').get(directoryAccount).n, 0);
			ldapId = undefined;
		} catch { report.cleanupErrors.push('delete-ldap'); }
	}
	for (const id of [...orgIds].reverse()) {
		try { await api(admin, 'sysOrg/delete', { id }); orgIds = orgIds.filter((item) => item !== id); }
		catch { report.cleanupErrors.push('delete-synced-org'); }
	}
	report.cleanupPassed = !domainConfig && !ldapId && orgIds.length === 0 && report.cleanupErrors.length === 0;
}
try {
	await docker(['run', '-d', '--name', container, '--label', 'adminnet-isolated=ldap12', '-p', '127.0.0.1::389',
		'-e', 'LDAP_DOMAIN=isolated.test', '-e', 'LDAP_ORGANISATION=Isolated Test', '-e', `LDAP_ADMIN_PASSWORD=${bindPassword}`, '-e', 'LDAP_TLS=false', 'osixia/openldap:1.5.0']);
	containerCreated = true;
	const port = Number((await docker(['port', container, '389/tcp'])).stdout.trim().split(':').at(-1));
	assert.ok(port > 0);
	let ready = false;
	for (let attempt = 0; attempt < 30; attempt++) {
		try { await docker(['exec', container, 'ldapwhoami', '-x', '-H', 'ldap://localhost', '-D', bindDn, '-w', bindPassword]); ready = true; break; }
		catch { await delay(500); }
	}
	assert.equal(ready, true, 'Isolated directory must accept a real bind');
	await docker(['exec', '-i', container, 'ldapadd', '-x', '-H', 'ldap://localhost', '-D', bindDn, '-w', bindPassword], [
		`dn: ou=${name},${baseDn}`, 'objectClass: organizationalUnit', `ou: ${name}`, '',
		`dn: uid=${directoryAccount},ou=${name},${baseDn}`, 'objectClass: inetOrgPerson', `uid: ${directoryAccount}`, 'cn: Isolated Directory User', 'sn: User',
		'employeeNumber: TestUser3', 'mail: isolated@example.test', `userPassword: ${directoryPassword}`, '', '',
	].join('\n'));
	runtime = await launchApi();
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl);
	assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true }); db.exec('PRAGMA busy_timeout=5000');
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	admin = await api(undefined, 'sysAuth/login', { account: 'superAdmin.NET', password: sm2.doEncrypt(password, publicKey, 1) });
	ordinary = await api(undefined, 'sysAuth/login', { account: 'TestUser3', password: sm2.doEncrypt(password, publicKey, 1) });
	const owner = await api(admin, 'sysAuth/userInfo', undefined, 'GET'); tenantId = owner.currentTenantId;
	const initialOrgs = db.prepare('SELECT Id FROM SysOrg').all().map((row) => row.Id);
	const config = { tenantId, host: '127.0.0.1', port, version: 3, baseDn, bindDn, bindPass: bindPassword, authFilter: '(uid=%s)',
		bindAttrAccount: 'uid', bindAttrEmployeeId: 'employeeNumber', bindAttrCode: 'ou', status: 1 };

	stage = 'production-ldap-create-and-secret-redaction';
	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage(); page.setDefaultTimeout(20_000);
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Fldap`);
	await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
	await page.getByLabel('密码', { exact: true }).fill(password);
	await page.locator('button[type=submit]').click();
	await page.getByRole('button', { name: '新增域配置', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '新增域配置', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByText('请输入主机', { exact: true })).toBeVisible();
	for (const [label, value] of [['主机', config.host], ['搜索基准', baseDn], ['绑定 DN', bindDn], ['过滤规则', config.authFilter], ['账号字段', 'uid'], ['员工编号字段', 'employeeNumber'], ['组织编码字段', 'ou'], ['绑定密码', bindPassword]])
		await dialog.getByLabel(label, { exact: true }).fill(value);
	await dialog.getByLabel('端口', { exact: true }).fill(String(port));
	await shot('ldap-desktop-editor.png');
	const [created] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysLdap/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	const createdBody = await created.json(); assert.equal(createdBody.code, 200); ldapId = createdBody.result; assert.ok(ldapId);
	await expect(dialog).toBeHidden();
	assert.notEqual(db.prepare('SELECT BindPass FROM SysLdap WHERE Id = ?').get(ldapId).BindPass, bindPassword);
	const detail = await api(admin, `sysLdap/detail?id=${ldapId}`, undefined, 'GET');
	assert.ok(!detail.bindPass);
	const items = await api(admin, 'sysLdap/page', { page: 1, pageSize: 10, tenantId });
	assert.ok(items.items.every((item) => !item.bindPass));
	await api(ordinary, 'sysLdap/page', { page: 1, pageSize: 10 }, 'POST', true);
	await api(ordinary, 'sysLdap/syncDept', { id: ldapId }, 'POST', true);
	await api(admin, 'sysLdap/update', { ...config, id: ldapId, tenantId: 1300000990001 }, 'POST', true);
	await api(admin, 'sysLdap/update', { ...config, id: ldapId, port: 0 }, 'POST', true);
	report.steps.push(stage);

	stage = 'real-user-and-org-sync-idempotency';
	await confirmAction('同步域账户', '/sysLdap/syncUser');
	const sourceUser = db.prepare('SELECT Id FROM SysUser WHERE Account = ?').get('TestUser3');
	const mapped = db.prepare('SELECT Account,EmployeeId,UserId,TenantId,DeptCode FROM SysUserLdap WHERE Account = ?').get(directoryAccount);
	assert.equal(mapped.UserId, sourceUser.Id); assert.equal(mapped.TenantId, tenantId); assert.equal(mapped.DeptCode, name);
	await confirmAction('同步域账户', '/sysLdap/syncUser');
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUserLdap WHERE Account = ?').get(directoryAccount).n, 1);
	await confirmAction('同步域组织', '/sysLdap/syncDept');
	orgIds = db.prepare('SELECT Id FROM SysOrg WHERE Code = ? AND TenantId = ?').all(name, tenantId).map((row) => row.Id);
	assert.equal(orgIds.length, 1);
	await confirmAction('同步域组织', '/sysLdap/syncDept');
	assert.deepEqual(db.prepare('SELECT Id FROM SysOrg WHERE Code = ? AND TenantId = ?').all(name, tenantId).map((row) => row.Id), orgIds);
	for (const id of initialOrgs) assert.ok(db.prepare('SELECT Id FROM SysOrg WHERE Id = ?').get(id));
	await shot('ldap-desktop-synced.png');
	report.steps.push(stage);

	stage = 'edit-empty-password-and-real-domain-login';
	await page.locator(`tr[data-row-key="${ldapId}"]`).getByRole('button', { name: '编辑域配置', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑域配置', exact: true });
	await expect(dialog.getByLabel('绑定密码', { exact: true })).toHaveValue('');
	const before = db.prepare('SELECT BindPass FROM SysLdap WHERE Id = ?').get(ldapId).BindPass;
	const [saved] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysLdap/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.equal((await saved.json()).code, 200);
	assert.equal(db.prepare('SELECT BindPass FROM SysLdap WHERE Id = ?').get(ldapId).BindPass, before);
	domainConfig = (await api(admin, 'sysConfig/page', { page: 1, pageSize: 10, code: 'sys_domain_login' })).items.find((item) => item.code === 'sys_domain_login');
	assert.ok(domainConfig);
	await api(admin, 'sysConfig/update', { ...domainConfig, value: 'True' });
	await api(undefined, 'sysAuth/login', { account: 'TestUser3', password: sm2.doEncrypt('incorrect-directory-password', publicKey, 1) }, 'POST', true);
	const directoryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	try {
		const loginPage = await directoryContext.newPage();
		await loginPage.goto(`${proxy.baseUrl}/#/auth/login`);
		await loginPage.getByLabel('账号', { exact: true }).fill('TestUser3');
		await loginPage.getByLabel('密码', { exact: true }).fill(directoryPassword);
		const [loggedIn] = await Promise.all([loginPage.waitForResponse((r) => r.url().endsWith('/sysAuth/login')), loginPage.locator('button[type=submit]').click()]);
		const body = await loggedIn.json(); assert.equal(body.code, 200);
		const identity = await api(body.result, 'sysAuth/userInfo', undefined, 'GET'); assert.equal(identity.id, sourceUser.Id); assert.equal(identity.currentTenantId, tenantId);
		await expect(loginPage).not.toHaveURL(/#\/auth\//);
		await expect(loginPage.locator('.ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
		await loginPage.screenshot({ path: join(evidence, 'ldap-desktop-login.png'), animations: 'disabled' });
		await api(body.result, 'sysAuth/logout');
	} finally { await directoryContext.close(); }
	report.steps.push(stage);

	stage = 'real-directory-outage-preserves-existing-mapping';
	await docker(['stop', container]);
	await page.locator(`tr[data-row-key="${ldapId}"]`).getByRole('button', { name: '同步域账户', exact: true }).click();
	const failureDialog = page.getByRole('dialog');
	const [failureResponse] = await Promise.all([page.waitForResponse((r) => r.url().endsWith('/sysLdap/syncUser')), failureDialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.notEqual((await failureResponse.json()).code, 200);
	await expect(failureDialog).toBeVisible();
	await expect(failureDialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await page.screenshot({ path: join(evidence, 'ldap-desktop-outage.png'), animations: 'disabled' });
	await failureDialog.getByRole('button', { name: /^取\s*消$/ }).click();
	assert.equal(db.prepare('SELECT UserId FROM SysUserLdap WHERE Account = ?').get(directoryAccount).UserId, sourceUser.Id);
	await api(undefined, 'sysAuth/login', { account: 'TestUser3', password: sm2.doEncrypt(directoryPassword, publicKey, 1) }, 'POST', true);
	report.steps.push(stage);
	await cleanup(); assert.equal(report.cleanupPassed, true);
	for (const filename of ['stdout.log', 'stderr.log']) {
		const log = readFileSync(join(runtime, filename), 'utf8');
		assert.ok(!log.includes(bindPassword) && !log.includes(directoryPassword), 'Directory credentials must not appear in logs');
	}
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = error.message.replaceAll(bindPassword, '[redacted]').replaceAll(directoryPassword, '[redacted]');
	process.exitCode = 1;
	if (page && evidence) await page.screenshot({ path: join(evidence, 'ldap-failure.png'), mask: [page.locator('input[type=password]')] }).catch(() => {});
} finally {
	if (admin && db) await cleanup();
	await context?.close(); await browser?.close(); await proxy?.close(); db?.close();
	if (runtime) {
		try { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true }); }
		catch { report.cleanupErrors.push('stop-api'); report.cleanupPassed = false; }
	}
	if (containerCreated) {
		try {
			const label = (await docker(['inspect', '--format', '{{ index .Config.Labels "adminnet-isolated" }}', container])).stdout.trim();
			assert.equal(label, 'ldap12');
			await docker(['rm', '-f', '-v', container]);
		} catch { report.cleanupErrors.push('remove-directory-container'); report.cleanupPassed = false; }
	}
	if (evidence) writeFileSync(join(evidence, 'ldap-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
