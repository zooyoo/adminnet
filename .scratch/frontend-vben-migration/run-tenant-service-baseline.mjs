import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const base = new URL(marker.baseUrl);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'real-api-and-readonly-sqlite', steps: [] };
const sessions = [];
let db;
let admin;
let originalGrants;
let target;
let createdTenant;
let createdDbTenant;
let stage = 'initialize';

async function call(session, path, data, method = 'POST') {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method,
		headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' && data !== undefined ? JSON.stringify(data) : undefined,
		signal: AbortSignal.timeout(20_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	return response.json();
}
async function ok(session, path, data, method) {
	const result = await call(session, path, data, method);
	assert.equal(result.code, 200, `${path.split('?')[0]}: code=${result.code}`);
	return result.result;
}
function grants(id) {
	return db.prepare('SELECT MenuId FROM SysTenantMenu WHERE TenantId = ? ORDER BY MenuId').all(id).map((row) => row.MenuId);
}
function saveReport() {
	writeFileSync(join(evidence, 'tenant-service-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
}

try {
	const require = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
	const { sm2 } = require('sm-crypto-v2');
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey);
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	for (const account of ['superAdmin.NET', 'TestUser3']) {
		sessions.push(await ok(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }));
	}
	[admin] = sessions;
	if (process.argv.includes('--cleanup-browser-fixtures')) {
		stage = 'cleanup-prior-browser-fixtures';
		const fixtures = db.prepare("SELECT t.Id, u.Account FROM SysTenant t JOIN SysUser u ON u.Id = t.UserId WHERE u.Account LIKE 'browser07-%'").all()
			.filter((row) => /^browser07-\d+(?:-db)?$/.test(row.Account));
		for (const fixture of fixtures) {
			await ok(admin, 'sysTenant/delete', { id: fixture.Id });
			assert.equal(db.prepare('SELECT Id FROM SysTenant WHERE Id = ?').get(fixture.Id), undefined);
			assert.equal(db.prepare('SELECT Id FROM SysUser WHERE Account = ?').get(fixture.Account), undefined);
		}
		report.steps.push(stage);
	}
	const tenants = db.prepare('SELECT Id FROM SysTenant ORDER BY Id').all();
	assert.ok(tenants.length >= 2, 'OnlineFixture must include a second isolated tenant.');
	target = tenants.at(-1).Id;
	originalGrants = grants(target);
	const leaf = db.prepare('SELECT Id, Pid FROM SysMenu WHERE Permission = ?').get('sysPos:list');
	assert.ok(leaf);
	stage = 'grant-new-menu-and-ancestors';
	await ok(admin, 'sysTenant/grantMenu', { id: target, tenantIdList: [target, target], menuIdList: [leaf.Id, leaf.Id] });
	const expected = new Set([leaf.Id]);
	let parentId = leaf.Pid;
	while (parentId) {
		assert.ok(!expected.has(parentId));
		expected.add(parentId);
		parentId = db.prepare('SELECT Pid FROM SysMenu WHERE Id = ?').get(parentId).Pid;
	}
	assert.deepEqual(grants(target), [...expected].sort((a, b) => a - b));
	report.steps.push(stage);

	stage = 'omitted-menus-preserve-grants';
	await ok(admin, 'sysTenant/grantMenu', { id: target });
	assert.deepEqual(grants(target), [...expected].sort((a, b) => a - b));
	report.steps.push(stage);

	stage = 'invalid-menu-and-sync-target-preserve-grants';
	for (const input of [
		{ id: target, menuIdList: [999999999999] },
		{ id: target, tenantIdList: [999999999999], menuIdList: [] },
	]) {
		assert.notEqual((await call(admin, 'sysTenant/grantMenu', input)).code, 200);
		assert.deepEqual(grants(target), [...expected].sort((a, b) => a - b));
	}
	report.steps.push(stage);

	stage = 'unauthorized-account-rejected';
	assert.equal((await call(sessions[1], 'sysTenant/grantMenu', { id: target, menuIdList: [] })).code, 403);
	assert.deepEqual(grants(target), [...expected].sort((a, b) => a - b));
	report.steps.push(stage);

	stage = 'explicit-empty-revokes-grants';
	await ok(admin, 'sysTenant/grantMenu', { id: target, menuIdList: [] });
	assert.deepEqual(grants(target), []);
	report.steps.push(stage);
	stage = 'tenant-create-and-persist';
	const suffix = Date.now().toString(36);
	const tenantName = `isolated-tenant-${suffix}`;
	const account = `tenant-${suffix}`;
	await ok(admin, 'sysTenant/add', { name: tenantName, adminAccount: account, tenantType: 0, status: 1, enableReg: 2, orderNo: 100 });
	createdTenant = db.prepare('SELECT t.* FROM SysTenant t JOIN SysUser u ON u.Id = t.UserId WHERE u.Account = ?').get(account);
	assert.ok(createdTenant);
	assert.equal(db.prepare('SELECT Name FROM SysOrg WHERE Id = ?').get(createdTenant.OrgId).Name, tenantName);
	report.steps.push(stage);

	stage = 'tenant-update-rejects-forged-user-and-org';
	const rows = await ok(admin, 'sysTenant/page', { name: tenantName, page: 1, pageSize: 20 });
	const record = rows.items.find((row) => String(row.id) === String(createdTenant.Id));
	assert.ok(record);
	const otherUser = db.prepare('SELECT Id, Account, Password FROM SysUser WHERE Account = ?').get('TestUser3');
	for (const input of [{ ...record, userId: otherUser.Id }, { ...record, orgId: 999999999999 }]) {
		assert.notEqual((await call(admin, 'sysTenant/update', input)).code, 200);
	}
	assert.deepEqual(db.prepare('SELECT Id, Account, Password FROM SysUser WHERE Id = ?').get(otherUser.Id), otherUser);
	await ok(admin, 'sysTenant/update', { ...record, name: `${tenantName}-updated` });
	assert.equal(db.prepare('SELECT Name FROM SysOrg WHERE Id = ?').get(createdTenant.OrgId).Name, `${tenantName}-updated`);
	report.steps.push(stage);

	stage = 'reset-only-tenant-administrator';
	assert.notEqual((await call(admin, 'sysTenant/resetPwd', { userId: otherUser.Id })).code, 200);
	assert.equal(db.prepare('SELECT Password FROM SysUser WHERE Id = ?').get(otherUser.Id).Password, otherUser.Password);
	const resetPassword = await ok(admin, 'sysTenant/resetPwd', { userId: createdTenant.UserId });
	const tenantSession = await ok(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(resetPassword, publicKey, 1) });
	sessions.push(tenantSession);
	assert.equal(String((await ok(tenantSession, 'sysAuth/userInfo', undefined, 'GET')).currentTenantId), String(createdTenant.Id));
	report.steps.push(stage);

	stage = 'disabled-tenant-switch-keeps-original-session';
	await ok(admin, 'sysTenant/setStatus', { id: createdTenant.Id, status: 2 });
	for (const endpoint of ['changeTenant', 'goTenant']) {
		assert.notEqual((await call(admin, `sysTenant/${endpoint}`, { id: createdTenant.Id })).code, 200);
	}
	assert.equal((await ok(admin, 'sysAuth/userInfo', undefined, 'GET')).account, 'superAdmin.NET');
	await ok(admin, 'sysTenant/setStatus', { id: createdTenant.Id, status: 1 });
	report.steps.push(stage);

	stage = 'field-tenant-and-default-database-protection';
	assert.notEqual((await call(admin, 'sysTenant/createDb', { id: createdTenant.Id })).code, 200);
	const defaultTenant = db.prepare('SELECT Id FROM SysTenant ORDER BY Id LIMIT 1').get();
	for (const endpoint of ['createDb', 'delete', 'setStatus']) {
		assert.notEqual((await call(admin, `sysTenant/${endpoint}`, { id: defaultTenant.Id, status: 2 })).code, 200);
	}
	assert.ok(db.prepare('SELECT Id FROM SysTenant WHERE Id = ?').get(defaultTenant.Id));
	report.steps.push(stage);
	stage = 'switch-and-enter-tenant-identities';
	const switched = await ok({ ...admin }, 'sysTenant/changeTenant', { id: createdTenant.Id });
	sessions.push(switched);
	const switchedInfo = await ok(switched, 'sysAuth/userInfo', undefined, 'GET');
	assert.equal(switchedInfo.account, 'superAdmin.NET');
	assert.equal(String(switchedInfo.currentTenantId), String(createdTenant.Id));
	const renewed = await ok(switched, `sysAuth/refreshToken?accessToken=${encodeURIComponent(switched.accessToken)}`, undefined, 'GET');
	sessions.push(renewed);
	assert.equal(String((await ok(renewed, 'sysAuth/userInfo', undefined, 'GET')).currentTenantId), String(createdTenant.Id));
	const entered = await ok({ ...admin }, 'sysTenant/goTenant', { id: createdTenant.Id });
	sessions.push(entered);
	const enteredInfo = await ok(entered, 'sysAuth/userInfo', undefined, 'GET');
	assert.equal(enteredInfo.account, account);
	assert.equal(String(enteredInfo.currentTenantId), String(createdTenant.Id));
	assert.equal(enteredInfo.accountType, 888);
	const beforeRevocation = grants(createdTenant.Id);
	await ok(admin, 'sysTenant/grantMenu', { id: createdTenant.Id, menuIdList: [] });
	assert.deepEqual((await ok(entered, 'sysAuth/userInfo', undefined, 'GET')).buttons, []);
	assert.equal((await call(entered, 'sysPos/list', undefined, 'GET')).code, 403);
	await ok(admin, 'sysTenant/grantMenu', { id: createdTenant.Id, menuIdList: beforeRevocation });
	for (const endpoint of ['changeTenant', 'goTenant']) {
		assert.notEqual((await call(entered, `sysTenant/${endpoint}`, { id: defaultTenant.Id })).code, 200);
	}
	assert.equal((await ok(admin, 'sysAuth/userInfo', undefined, 'GET')).account, 'superAdmin.NET');
	const positions = await ok(entered, 'sysPos/list', undefined, 'GET');
	assert.ok(positions.length > 0);
	assert.ok(positions.every((row) => String(row.tenantId) === String(createdTenant.Id)));
	assert.equal(db.prepare('SELECT TenantId FROM SysUser WHERE Account = ?').get('superAdmin.NET').TenantId, defaultTenant.Id);
	report.steps.push(stage);
	stage = 'synchronize-tenant-menu-from-existing-roles';
	const tenantGrants = grants(createdTenant.Id);
	const roleGrants = db.prepare('SELECT DISTINCT rm.MenuId FROM SysRoleMenu rm JOIN SysRole r ON r.Id = rm.RoleId WHERE r.TenantId = ?').all(createdTenant.Id).map((row) => row.MenuId);
	await ok(admin, 'sysTenant/syncGrantMenu', { id: createdTenant.Id });
	for (const menuId of roleGrants) assert.ok(grants(createdTenant.Id).includes(menuId));
	await ok(admin, 'sysTenant/grantMenu', { id: createdTenant.Id, menuIdList: tenantGrants });
	report.steps.push(stage);

	stage = 'database-isolated-tenant-create-database';
	const databasePath = join(runtime, `tenant-${suffix}.db`);
	await ok(admin, 'sysTenant/add', {
		name: `${tenantName}-db`, adminAccount: `${account}-db`, tenantType: 1, dbType: 2,
		connection: `Data Source=${databasePath}`, status: 1, enableReg: 2, orderNo: 100,
	});
	createdDbTenant = db.prepare('SELECT t.* FROM SysTenant t JOIN SysUser u ON u.Id = t.UserId WHERE u.Account = ?').get(`${account}-db`);
	assert.ok(createdDbTenant);
	await ok(admin, 'sysTenant/createDb', { id: createdDbTenant.Id });
	const isolatedDb = new DatabaseSync(databasePath, { readOnly: true });
	try {
		assert.equal(isolatedDb.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
		// 系统账号、授权及机构始终保留在主库，不能复制到业务租户库。
		assert.equal(isolatedDb.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE name IN ('SysUser', 'SysTenant', 'SysOrg')").get().count, 0);
	} finally { isolatedDb.close(); }
	const dbEntered = await ok({ ...admin }, 'sysTenant/goTenant', { id: createdDbTenant.Id });
	sessions.push(dbEntered);
	const dbInfo = await ok(dbEntered, 'sysAuth/userInfo', undefined, 'GET');
	assert.equal(String(dbInfo.currentTenantId), String(createdDbTenant.Id));
	const dbPositions = await ok(dbEntered, 'sysPos/list', undefined, 'GET');
	assert.ok(dbPositions.length > 0);
	assert.ok(dbPositions.every((row) => String(row.tenantId) === String(createdDbTenant.Id)));
	report.steps.push(stage);
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	// 不输出认证响应和包含敏感正文的错误对象。
	report.error = { name: error.name, code: error.code ?? null };
	process.exitCode = 1;
} finally {
	saveReport();
	const cleanupErrors = [];
	for (const tenant of [createdDbTenant, createdTenant].filter(Boolean)) {
		try {
			await ok(admin, 'sysTenant/delete', { id: tenant.Id });
			assert.equal(db.prepare('SELECT Id FROM SysTenant WHERE Id = ?').get(tenant.Id), undefined);
			assert.equal(db.prepare('SELECT Id FROM SysUser WHERE Id = ?').get(tenant.UserId), undefined);
			assert.equal(db.prepare('SELECT Id FROM SysOrg WHERE Id = ?').get(tenant.OrgId), undefined);
		} catch { cleanupErrors.push('delete-created-tenant'); }
	}
	if (originalGrants) {
		try {
			await ok(admin, 'sysTenant/grantMenu', { id: target, menuIdList: originalGrants });
			assert.deepEqual(grants(target), originalGrants);
		} catch { cleanupErrors.push('restore-tenant-grants'); }
	}
	for (const session of new Map(sessions.map((entry) => [entry.accessToken, entry])).values()) {
		try { await ok(session, 'sysAuth/logout'); }
		catch { cleanupErrors.push('logout'); }
	}
	try { db?.close(); } catch { cleanupErrors.push('close-database'); }
	report.cleanupPassed = cleanupErrors.length === 0;
	report.cleanupErrors = cleanupErrors;
	if (!report.cleanupPassed) process.exitCode = 1;
	saveReport();
	console.log(JSON.stringify({ passed: report.passed, cleanupPassed: report.cleanupPassed, failedStage: report.failedStage, report: join(evidence, 'tenant-service-baseline.json') }));
}
