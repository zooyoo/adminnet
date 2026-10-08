import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const base = new URL(marker.baseUrl);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const require = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const { sm2 } = require('sm-crypto-v2');
const { HubConnectionBuilder, LogLevel } = require('@microsoft/signalr');
const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8')
	.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
assert.ok(password && publicKey);
const db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
const sessions = [];
const cleanup = [];
const report = { passed: false, proposalComplete: false, steps: [], cleanupPassed: false };
let admin;
async function call(session, path, data, method = 'POST') {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? {
			Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}`,
		} : {}) },
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
	assert.equal(result.code, 200, `${path}: expected success, code=${result.code}`);
	return result.result;
}
async function denied(session, path, data, method) {
	const result = await call(session, path, data, method);
	assert.notEqual(result.code, 200, `${path}: must reject`);
}
async function login(account, secret = password) {
	const session = await ok(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(secret, publicKey, 1) });
	sessions.push(session);
	return session;
}
const row = (table, id) => db.prepare(`SELECT * FROM ${table} WHERE Id = ?`).get(id);
const grants = (id) => db.prepare('SELECT RoleId FROM SysUserRole WHERE UserId = ? ORDER BY RoleId').all(id).map((item) => item.RoleId);
const step = (name) => { report.steps.push(name); console.log(name); };

try {
	admin = await login('superAdmin.NET');
	const tenant = await login('Admin.NET');
	const reader = await login('TestUser3');
	const info = await ok(tenant, 'sysAuth/userInfo', undefined, 'GET');
	for (const permission of ['sysUser:add', 'sysUser:update', 'sysUser:delete', 'sysUser:resetPwd', 'sysUser:unlockLogin', 'sysUser:grantRole', 'sysOrg:update']) {
		assert.ok(info.buttons.includes(permission), `Fixture must have ${permission} before testing target boundaries.`);
	}
	const tenantId = row('SysUser', info.id)?.TenantId ?? db.prepare('SELECT TenantId FROM SysUser WHERE Account = ?').get('Admin.NET').TenantId;
	const parent = db.prepare('SELECT * FROM SysOrg WHERE TenantId = ? ORDER BY Id LIMIT 1').get(tenantId);
	const foreignOrg = db.prepare('SELECT * FROM SysOrg WHERE TenantId <> ? ORDER BY Id LIMIT 1').get(tenantId);
	const foreignUser = db.prepare('SELECT * FROM SysUser WHERE TenantId <> ? AND AccountType = 777 ORDER BY Id LIMIT 1').get(tenantId);
	const role = db.prepare('SELECT * FROM SysRole WHERE Code = ?').get('isolated-online-read');
	assert.ok(parent && foreignOrg && foreignUser && role);
	const prefix = `accept06-${Date.now()}`;
	await ok(admin, 'sysPos/add', { name: `${prefix}-foreign`, code: `${prefix}-foreign`, tenantId: foreignOrg.TenantId, status: 1 });
	const foreignPosId = db.prepare('SELECT Id FROM SysPos WHERE Code = ?').get(`${prefix}-foreign`).Id;
	cleanup.push(['sysPos/delete', foreignPosId, 'SysPos']);
	const foreignPos = row('SysPos', foreignPosId);
	await ok(admin, 'sysRole/add', { name: `${prefix}-foreign`, code: `${prefix}-foreign`, tenantId: foreignOrg.TenantId, status: 1 });
	const foreignRole = db.prepare('SELECT * FROM SysRole WHERE Code = ?').get(`${prefix}-foreign`);
	cleanup.push(['sysRole/delete', foreignRole.Id, 'SysRole']);
	const orgId = await ok(tenant, 'sysOrg/add', { name: prefix, code: prefix, pid: parent.Id, tenantId: foreignOrg.TenantId });
	cleanup.push(['sysOrg/delete', orgId, 'SysOrg']);
	assert.equal(row('SysOrg', orgId).TenantId, tenantId);
	const childId = await ok(tenant, 'sysOrg/add', { name: `${prefix}-child`, code: `${prefix}-child`, pid: orgId });
	cleanup.push(['sysOrg/delete', childId, 'SysOrg']);
	for (const pid of [orgId, childId, foreignOrg.Id, 987654321]) {
		await denied(tenant, 'sysOrg/update', { id: orgId, pid, name: 'rejected', code: prefix });
		assert.equal(row('SysOrg', orgId).Pid, parent.Id);
		assert.equal(row('SysOrg', orgId).Name, prefix);
	}
	await ok(tenant, 'sysOrg/update', { id: childId, pid: parent.Id, name: `${prefix}-moved`, code: `${prefix}-child`, tenantId: foreignOrg.TenantId });
	assert.equal(row('SysOrg', childId).Pid, parent.Id);
	assert.equal(row('SysOrg', childId).TenantId, tenantId);
	step('real-organization-create-reparent-cycle-and-cross-tenant-rejection');

	await ok(tenant, 'sysPos/add', { name: prefix, code: prefix, status: 1 });
	const posId = db.prepare('SELECT Id FROM SysPos WHERE Code = ?').get(prefix).Id;
	cleanup.push(['sysPos/delete', posId, 'SysPos']);
	const draft = {
		account: prefix, realName: '第六项测试账号', tenantId, orgId, posId, accountType: 777,
		langCode: 'zh-CN', roleIdList: [role.Id], extOrgIdList: [{ orgId: childId, posId, jobNum: 'EXT06', posLevel: 'A', joinDate: '2026-01-02' }],
		nickName: '资料昵称', jobNum: 'JOB06', email: 'test@example.invalid', address: '隔离地址',
		officePhone: '01000000000', emergencyContact: '测试联系人', emergencyPhone: '13900000000',
		birthday: '2000-02-03', joinDate: '2020-05-06', remark: '保留资料',
	};
	const userId = await ok(tenant, 'sysUser/add', { ...draft, tenantId: foreignOrg.TenantId });
	cleanup.push(['sysUser/delete', userId, 'SysUser']);
	assert.equal(row('SysUser', userId).TenantId, tenantId);
	assert.equal(row('SysUser', userId).JobNum, 'JOB06');
	assert.equal(row('SysUser', userId).EmergencyContact, '测试联系人');
	assert.deepEqual(grants(userId), [role.Id]);
	const assignments = await ok(tenant, `sysUser/ownExtOrgList/${userId}`, undefined, 'GET');
	assert.equal(assignments[0].jobNum, 'EXT06');
	assert.equal(assignments[0].orgId, childId);
	step('real-user-create-profile-role-and-extended-organization-persistence');

	for (const invalid of [
		{ orgId: foreignOrg.Id }, { posId: foreignPos.Id }, { roleIdList: [foreignRole.Id] },
		{ extOrgIdList: [{ orgId: foreignOrg.Id, posId: foreignPos.Id }] },
	]) {
		await denied(tenant, 'sysUser/update', { ...draft, id: userId, realName: 'rejected', ...invalid });
		assert.equal(row('SysUser', userId).RealName, draft.realName);
		assert.deepEqual(grants(userId), [role.Id]);
	}
	const foreignBefore = row('SysUser', foreignUser.Id);
	for (const path of ['update', 'delete', 'setStatus', 'resetPwd', 'unlockLogin']) {
		await denied(tenant, `sysUser/${path}`, { ...draft, id: foreignUser.Id, account: foreignUser.Account, status: 2 });
		assert.deepEqual(row('SysUser', foreignUser.Id), foreignBefore);
	}
	await denied(tenant, 'sysUser/grantRole', { userId: foreignUser.Id, roleIdList: [role.Id] });
	await denied(tenant, 'sysUser/grantRole', { userId, roleIdList: [foreignRole.Id] });
	await denied(tenant, `sysUser/ownRoleList/${foreignUser.Id}`, undefined, 'GET');
	await denied(tenant, `sysUser/ownExtOrgList/${foreignUser.Id}`, undefined, 'GET');
	await denied(reader, 'sysUser/add', { ...draft, account: `${prefix}-denied` });
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUser WHERE Account = ?').get(`${prefix}-denied`).n, 0);
	step('real-associated-tenant-boundaries-and-unauthorized-writes-rejected-without-mutation');

	const employeeSession = await login(prefix);
	const hub = new HubConnectionBuilder().withUrl(`${base.href.replace(/\/$/, '')}/hubs/onlineUser`, {
		accessTokenFactory: () => employeeSession.accessToken,
	}).configureLogging(LogLevel.None).build();
	let timeout;
	try {
		const forced = new Promise((resolveForced, reject) => {
			hub.on('ForceOffline', resolveForced);
			timeout = setTimeout(() => reject(new Error('Role revocation must force the old real connection offline.')), 15_000);
		});
		// 在请求开始前订阅，避免遗漏立即下发的真实事件。
		forced.catch(() => {});
		await hub.start();
		const connectedDeadline = Date.now() + 10_000;
		while (!db.prepare('SELECT Id FROM SysOnlineUser WHERE UserId = ?').get(userId)) {
			assert.ok(Date.now() < connectedDeadline, 'Real SignalR connection must be persisted before role mutation.');
			await delay(100);
		}
		await ok(tenant, 'sysUser/update', { ...draft, id: userId, roleIdList: [], extOrgIdList: [] });
		await forced;
	} finally {
		clearTimeout(timeout);
		await hub.stop();
	}
	assert.deepEqual(grants(userId), []);
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUserExtOrg WHERE UserId = ?').get(userId).n, 0);
	assert.deepEqual(await ok(tenant, `sysUser/ownRoleList/${userId}`, undefined, 'GET'), []);
	await ok(tenant, 'sysUser/update', { ...draft, id: userId, extOrgIdList: assignments });
	assert.deepEqual(grants(userId), [role.Id]);
	step('empty-roles-and-extended-organizations-clear-force-offline-and-restore');

	await ok(tenant, 'sysUser/setStatus', { id: userId, status: 2 });
	assert.equal(row('SysUser', userId).Status, 2);
	await denied(undefined, 'sysAuth/login', { account: prefix, password: sm2.doEncrypt(password, publicKey, 1) });
	await ok(tenant, 'sysUser/setStatus', { id: userId, status: 1 });
	await login(prefix);
	const resetPassword = await ok(tenant, 'sysUser/resetPwd', { id: userId });
	assert.ok(typeof resetPassword === 'string' && resetPassword.length > 0);
	await denied(undefined, 'sysAuth/login', { account: prefix, password: sm2.doEncrypt(password, publicKey, 1) });
	await login(prefix, resetPassword);
	for (let attempt = 0; attempt < 7; attempt++) {
		await denied(undefined, 'sysAuth/login', { account: prefix, password: sm2.doEncrypt('isolated-wrong-password', publicKey, 1) });
	}
	await denied(undefined, 'sysAuth/login', { account: prefix, password: sm2.doEncrypt(resetPassword, publicKey, 1) });
	await ok(tenant, 'sysUser/unlockLogin', { id: userId });
	await login(prefix, resetPassword);
	step('real-disable-enable-password-reset-lockout-and-unlock-login');
	report.passed = true;
} catch (error) {
	report.error = error.message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-token]');
	console.error(report.error);
	process.exitCode = 1;
} finally {
	try {
		const errors = [];
		for (const [path, id, table] of cleanup.reverse()) {
			try {
				await ok(admin, path, { id });
				assert.ok(!row(table, id), `${table}: fixture must be removed`);
			} catch {
				errors.push(`${table}/${id}: cleanup failed`);
			}
		}
		report.cleanupPassed = errors.length === 0;
		if (errors.length) {
			report.cleanupErrors = errors;
			process.exitCode = 1;
		}
	} finally {
		for (const session of sessions) await call(session, 'sysAuth/logout').catch(() => {});
		mkdirSync(join(runtime, 'evidence'), { recursive: true });
		writeFileSync(join(runtime, 'evidence/user-service-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
		db.close();
	}
}
