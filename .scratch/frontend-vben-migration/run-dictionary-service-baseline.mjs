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
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'real-api-readonly-sqlite', steps: [], cleanupErrors: [] };
const sessions = [];
const created = [];
const suffix = `accept08-${Date.now()}`;
let db;
let admin;
let stage = 'initialize';
async function call(session, path, data, method = 'POST') {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' && data !== undefined ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(20_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	return response.json();
}
async function ok(session, path, data, method) {
	const result = await call(session, path, data, method);
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}`);
	return result.result;
}
async function denied(session, path, data, method) {
	assert.notEqual((await call(session, path, data, method)).code, 200, `${path.split('?')[0]} must reject`);
}
function track(prefix, table, code) {
	const row = db.prepare(`SELECT * FROM ${table} WHERE Code = ?`).get(code);
	assert.ok(row, `${table} persisted`);
	created.push({ prefix, table, id: row.Id });
	return row;
}
function done() { report.steps.push(stage); }
function save() { writeFileSync(join(evidence, 'dictionary-service-baseline.json'), JSON.stringify(report, null, 2), 'utf8'); }
try {
	const require = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
	const { sm2 } = require('sm-crypto-v2');
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey);
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	for (const account of ['superAdmin.NET', 'Admin.NET', 'TestUser3']) {
		sessions.push(await ok(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }));
	}
	[admin] = sessions;
	const currentTenant = (await ok(admin, 'sysAuth/userInfo', undefined, 'GET')).currentTenantId;
	const foreignId = db.prepare('SELECT Id FROM SysTenant WHERE Id <> ? ORDER BY Id DESC LIMIT 1').get(currentTenant)?.Id;
	assert.ok(foreignId);
	const foreign = await ok({ ...admin }, 'sysTenant/changeTenant', { id: foreignId });
	sessions.push(foreign);
	assert.equal(String((await ok(foreign, 'sysAuth/userInfo', undefined, 'GET')).currentTenantId), String(foreignId));
	stage = 'tenant-dictionary-create-and-isolation';
	const code = `${suffix}:特殊/&?%2F+`;
	const typeInput = { name: suffix, code, isTenant: 1, sysFlag: 2, status: 1, orderNo: 17 };
	await ok(admin, 'sysDictType/add', typeInput);
	const type = track('sysDictType', 'SysDictType', code);
	assert.equal(type.IsTenant, 1);
	const dataInput = { dictTypeId: type.Id, label: '租户一有效值', value: '01', code: 'item', status: 1, orderNo: 4, tagType: 'success', styleSetting: 'color: red', classSetting: 'accept08', extData: '{"source":"real"}' };
	await ok(admin, 'sysDictData/add', dataInput);
	await ok(foreign, 'sysDictData/add', { ...dataInput, label: '租户二有效值', value: '02' });
	const getData = (session, targetCode = code) => ok(session, `sysDictData/dataList?value=${encodeURIComponent(targetCode)}`, undefined, 'GET');
	assert.equal((await getData(admin))[0].value, '01');
	assert.equal((await getData(foreign))[0].value, '02');
	assert.equal((await getData(sessions[1]))[0].value, '01');
	const item = db.prepare('SELECT * FROM SysDictDataTenant WHERE DictTypeId = ? AND TenantId = ?').get(type.Id, currentTenant);
	const other = db.prepare('SELECT * FROM SysDictDataTenant WHERE DictTypeId = ? AND TenantId = ?').get(type.Id, foreignId);
	assert.ok(item && other);
	for (const [field, expected] of [['TagType', 'success'], ['StyleSetting', 'color: red'], ['ClassSetting', 'accept08'], ['ExtData', '{"source":"real"}']]) assert.equal(item[field], expected);
	done();
	stage = 'dictionary-permission-input-and-foreign-write-rejection';
	await denied(sessions[2], 'sysDictData/add', dataInput);
	await denied(admin, 'sysDictData/add', dataInput);
	await denied(admin, 'sysDictData/add', { ...dataInput, label: '', value: 'invalid' });
	await denied(sessions[1], 'sysDictData/update', { ...dataInput, id: other.Id, label: '非法跨租户' });
	await denied(sessions[1], 'sysDictData/delete', { id: other.Id });
	assert.equal(db.prepare('SELECT Label FROM SysDictDataTenant WHERE Id = ?').get(other.Id).Label, '租户二有效值');
	done();
	stage = 'dictionary-status-preserves-fields-and-refreshes-cache';
	await ok(admin, 'sysDictData/setStatus', { id: item.Id, status: 2 });
	assert.deepEqual(await getData(admin), []);
	assert.equal(db.prepare('SELECT Label FROM SysDictDataTenant WHERE Id = ?').get(item.Id).Label, dataInput.label);
	await ok(admin, 'sysDictData/setStatus', { id: item.Id, status: 1 });
	await ok(admin, 'sysDictData/update', { ...dataInput, id: item.Id, label: '修改后', orderNo: 2 });
	assert.equal((await getData(admin))[0].label, '修改后');
	assert.equal((await getData(foreign))[0].label, '租户二有效值');
	done();
	stage = 'type-disable-rename-reenable-invalidates-all-tenant-cache';
	await ok(admin, 'sysDictType/setStatus', { id: type.Id, status: 2 });
	assert.deepEqual(await getData(admin), []);
	assert.deepEqual(await getData(foreign), []);
	const renamed = `${code}:renamed`;
	await ok(admin, 'sysDictType/update', { ...typeInput, id: type.Id, code: renamed });
	assert.deepEqual(await getData(admin), []);
	assert.equal((await getData(admin, renamed))[0].label, '修改后');
	assert.equal((await getData(foreign, renamed))[0].label, '租户二有效值');
	done();
	stage = 'system-tenant-config-scope-read-update-rename';
	const configCode = `${suffix}-config`;
	const configInput = { name: `${suffix}-config`, code: configCode, value: 'system-value', sysFlag: 2, orderNo: 7, groupCode: suffix };
	await ok(admin, 'sysConfig/add', configInput);
	const system = track('sysConfig', 'SysConfig', configCode);
	await ok(admin, 'sysTenantConfig/add', { ...configInput, value: 'tenant-one' });
	const tenant = track('sysTenantConfig', 'SysTenantConfig', configCode);
	await ok(foreign, 'sysTenantConfig/update', { ...configInput, id: tenant.Id, value: 'tenant-two' });
	const readConfig = (session, prefix, key = configCode) => ok(session, `${prefix}/configValueByCode/${encodeURIComponent(key)}`, undefined, 'GET');
	assert.equal(await readConfig(admin, 'sysConfig'), 'system-value');
	assert.equal(await readConfig(admin, 'sysTenantConfig'), 'tenant-one');
	assert.equal(await readConfig(foreign, 'sysTenantConfig'), 'tenant-two');
	await ok(sessions[1], 'sysTenantConfig/update', { ...configInput, id: tenant.Id, value: 'tenant-one-edited' });
	assert.equal(await readConfig(admin, 'sysTenantConfig'), 'tenant-one-edited');
	assert.equal(await readConfig(foreign, 'sysTenantConfig'), 'tenant-two');
	await denied(sessions[1], 'sysTenantConfig/update', { ...configInput, id: tenant.Id, name: '非法共享定义', value: 'bad' });
	await denied(sessions[1], 'sysTenantConfig/delete', { id: tenant.Id });
	await denied(sessions[2], 'sysConfig/update', { ...configInput, id: system.Id, value: 'bad' });
	await ok(admin, 'sysConfig/update', { ...configInput, id: system.Id, code: `${configCode}-new`, value: 'new-system' });
	assert.equal(await readConfig(admin, 'sysConfig'), null);
	assert.equal(await readConfig(admin, 'sysConfig', `${configCode}-new`), 'new-system');
	await ok(admin, 'sysTenantConfig/update', { ...configInput, id: tenant.Id, code: `${configCode}-new`, value: 'new-tenant' });
	assert.equal(await readConfig(foreign, 'sysTenantConfig'), null);
	assert.equal(await readConfig(foreign, 'sysTenantConfig', `${configCode}-new`), 'tenant-two');
	done();
	stage = 'builtin-definition-protection';
	const builtin = db.prepare('SELECT * FROM SysDictType WHERE SysFlag = 1 LIMIT 1').get();
	assert.ok(builtin);
	await denied(sessions[1], 'sysDictType/update', { id: builtin.Id, name: builtin.Name, code: builtin.Code, isTenant: builtin.IsTenant, sysFlag: 2, status: builtin.Status });
	await denied(sessions[1], 'sysDictType/delete', { id: builtin.Id });
	assert.equal(db.prepare('SELECT SysFlag FROM SysDictType WHERE Id = ?').get(builtin.Id).SysFlag, 1);
	done();
	stage = 'special-cache-key-read-and-delete-preserves-neighbor';
	const cacheKey = `sys_tenant_dict:${currentTenant}:${renamed}`;
	const foreignKey = `sys_tenant_dict:${foreignId}:${renamed}`;
	assert.ok((await ok(admin, 'sysCache/keyList', undefined, 'GET')).includes(cacheKey));
	assert.ok(await ok(admin, `sysCache/value/${encodeURIComponent(cacheKey)}`, undefined, 'GET'));
	await ok(admin, `sysCache/delete/${encodeURIComponent(cacheKey)}`);
	const keys = await ok(admin, 'sysCache/keyList', undefined, 'GET');
	assert.ok(!keys.includes(cacheKey));
	assert.ok(keys.includes(foreignKey));
	assert.equal((await getData(admin, renamed))[0].label, '修改后');
	done();
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = `${error.name}: ${error.message}`;
	process.exitCode = 1;
	save();
} finally {
	for (const item of created.reverse()) {
		try {
			await ok(admin, `${item.prefix}/delete`, { id: item.id });
			assert.equal(db.prepare(`SELECT Id FROM ${item.table} WHERE Id = ?`).get(item.id), undefined);
			if (item.table === 'SysDictType') assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysDictDataTenant WHERE DictTypeId = ?').get(item.id).n, 0);
			if (item.table === 'SysTenantConfig') assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysTenantConfigData WHERE ConfigId = ?').get(item.id).n, 0);
		} catch { report.cleanupErrors.push(`${item.prefix}: fixture cleanup failed`); }
	}
	const loggedOut = new Set();
	for (const session of sessions) {
		if (loggedOut.has(session.accessToken)) continue;
		loggedOut.add(session.accessToken);
		try { await ok(session, 'sysAuth/logout'); } catch { report.cleanupErrors.push('logout failed'); }
	}
	db?.close();
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (!report.cleanupPassed) process.exitCode = 1;
	save();
	console.log(JSON.stringify(report, null, 2));
}
