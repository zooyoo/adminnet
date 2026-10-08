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
const require = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const { sm2 } = require('sm-crypto-v2');
const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8')
	.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
assert.ok(password && publicKey);
const db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
db.exec('PRAGMA busy_timeout=5000');
const sessions = [];
const report = { passed: false, proposalComplete: false, steps: [], pending: ['production-browser-role-edit', 'menu-runtime-flags', 'translation-and-data-scope', 'visual-acceptance'] };

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
async function login(account) {
	const result = await ok(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	sessions.push(result);
	return result;
}
function grants(id) {
	return db.prepare('SELECT MenuId FROM SysRoleMenu WHERE RoleId = ? ORDER BY MenuId').all(id).map((row) => String(row.MenuId));
}

try {
	const admin = await login('superAdmin.NET');
	const tenant = await login('Admin.NET');
	const reader = await login('TestUser3');
	const tenantInfo = await ok(tenant, 'sysAuth/userInfo', undefined, 'GET');
	for (const permission of ['sysRole:update', 'sysRole:grantMenu', 'sysRole:grantDataScope', 'sysRole:setStatus', 'sysRole:delete']) {
		assert.ok(tenantInfo.buttons.includes(permission), `The tenant test account must hold ${permission}; denial must test the target boundary.`);
	}
	const role = db.prepare('SELECT * FROM SysRole WHERE Code = ?').get('isolated-online-read');
	const pos = db.prepare('SELECT * FROM SysMenu WHERE Path = ?').get('/system/pos');
	const queryMenu = db.prepare('SELECT Id FROM SysMenu WHERE Permission = ?').get('sysPos:list');
	const createMenu = db.prepare('SELECT Id FROM SysMenu WHERE Permission = ?').get('sysPos:add');
	assert.ok(role && pos && queryMenu && createMenu);
	report.steps.push('isolated-role-and-real-sm2-logins');

	await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id] });
	const partial = await ok(admin, `sysRole/ownMenuList?Id=${role.Id}`, undefined, 'GET');
	assert.ok(partial.map(String).includes(String(queryMenu.Id)));
	assert.ok(!partial.map(String).includes(String(pos.Id)), 'Partially selected parent must not return as fully checked.');
	assert.ok(grants(role.Id).includes(String(pos.Id)), 'Backend must persist parent closure.');
	let permissions = await ok(reader, 'sysAuth/userInfo', undefined, 'GET');
	assert.ok(permissions.buttons.includes('sysPos:list'));
	assert.ok(!permissions.buttons.includes('sysPos:add'));
	assert.equal((await call(reader, 'sysPos/add', { name: 'forbidden', code: 'forbidden', status: 1 })).code, 403);
	await ok(reader, 'sysPos/list', undefined, 'GET');
	report.steps.push('partial-selection-ancestors-and-real-write-denial');

	const before = grants(role.Id);
	await ok(admin, 'sysRole/update', { id: role.Id, name: role.Name, code: role.Code, status: 1, tenantId: 1300000990001 });
	assert.deepEqual(grants(role.Id), before);
	assert.equal(db.prepare('SELECT TenantId FROM SysRole WHERE Id = ?').get(role.Id).TenantId, role.TenantId);
	report.steps.push('omitted-grants-preserved-forged-tenant-ignored');

	await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [] });
	assert.deepEqual(grants(role.Id), []);
	permissions = await ok(reader, 'sysAuth/userInfo', undefined, 'GET');
	assert.ok(!permissions.buttons.includes('sysPos:list'));
	assert.equal((await call(reader, 'sysPos/list', undefined, 'GET')).code, 403);
	const relogged = await login('TestUser3');
	permissions = await ok(relogged, 'sysAuth/userInfo', undefined, 'GET');
	assert.ok(!permissions.buttons.includes('sysPos:list'));
	report.steps.push('revoke-all-invalidates-existing-session-and-relogin');

	await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id] });
	const code = `foreign-role-${Date.now()}`;
	await ok(admin, 'sysRole/add', { name: code, code, tenantId: 1300000990001, status: 1, menuIdList: [] });
	const foreign = db.prepare('SELECT * FROM SysRole WHERE Code = ?').get(code);
	assert.ok(foreign);
	const foreignInput = { id: foreign.Id, name: 'unauthorized-edit', code, menuIdList: [] };
	for (const [path, data] of [
		['sysRole/update', foreignInput],
		['sysRole/grantMenu', { id: foreign.Id, menuIdList: [] }],
		['sysRole/grantMenu', { id: role.Id, menuIdList: [], roleIdList: [foreign.Id] }],
		['sysRole/grantDataScope', { id: foreign.Id, dataScope: 4, orgIdList: [] }],
		['sysRole/setStatus', { id: foreign.Id, status: 2 }],
		['sysRole/delete', { id: foreign.Id }],
	]) {
		const response = await call(tenant, path, data);
		assert.ok(response.code !== 200, `${path}: must reject foreign tenant`);
	}
	assert.equal(db.prepare('SELECT Name FROM SysRole WHERE Id = ?').get(foreign.Id).Name, code);
	assert.ok(grants(role.Id).includes(String(queryMenu.Id)));
	report.steps.push('cross-tenant-role-mutations-and-synchronization-denied');

	const source = grants(role.Id);
	assert.notEqual((await call(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id], roleIdList: [foreign.Id] })).code, 200);
	assert.deepEqual(grants(role.Id), source);
	report.steps.push('super-admin-sync-validates-each-target-menu-scope');

	const state = db.prepare('SELECT Name, Code, DataScope FROM SysRole WHERE Id = ?').get(role.Id);
	assert.notEqual((await call(tenant, 'sysRole/update', { id: role.Id, name: 'partial-must-not-save', code: 'partial', menuIdList: [999999999999] })).code, 200);
	assert.deepEqual(db.prepare('SELECT Name, Code, DataScope FROM SysRole WHERE Id = ?').get(role.Id), state);
	for (const scope of [0, 6, 1]) {
		assert.notEqual((await call(tenant, 'sysRole/grantDataScope', { id: role.Id, dataScope: scope, orgIdList: [] })).code, 200);
	}
	assert.notEqual((await call(tenant, 'sysRole/grantDataScope', { id: role.Id, dataScope: 5, orgIdList: [1300000990001] })).code, 200);
	assert.equal(db.prepare('SELECT DataScope FROM SysRole WHERE Id = ?').get(role.Id).DataScope, state.DataScope);
	report.steps.push('invalid-menu-no-partial-update-and-scope-validation');
	await ok(admin, 'sysRole/delete', { id: foreign.Id });
	const userQueryMenu = db.prepare('SELECT Id FROM SysMenu WHERE Permission = ?').get('sysUser:page');
	assert.ok(userQueryMenu);
	const readerRecord = db.prepare('SELECT Id, OrgId, TenantId, LangCode FROM SysUser WHERE Account = ?').get('TestUser3');
	const candidateOrgs = db.prepare('SELECT DISTINCT OrgId FROM SysUser WHERE TenantId = ? AND OrgId != ? AND AccountType NOT IN (888,999)').all(role.TenantId, readerRecord.OrgId);
	assert.ok(candidateOrgs.length > 0, 'Need a second populated organization to verify data filtering.');
	const otherOrg = candidateOrgs[0].OrgId;
	const inherentOrgs = [
		readerRecord.OrgId,
		...db.prepare('SELECT OrgId FROM SysUserExtOrg WHERE UserId = ?').all(readerRecord.Id).map((row) => row.OrgId),
		...db.prepare('SELECT Id FROM SysOrg WHERE CreateUserId = ? AND TenantId = ?').all(readerRecord.Id, role.TenantId).map((row) => row.Id),
	];
	const users = db.prepare('SELECT Id, OrgId FROM SysUser WHERE TenantId = ? AND AccountType NOT IN (888,999)').all(role.TenantId);
	const expectedUsers = (orgs) => users.filter((user) => !orgs || orgs.some((id) => String(id) === String(user.OrgId))).map((user) => String(user.Id)).sort();
	await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id, userQueryMenu.Id] });
	for (const scope of [
		{ dataScope: 3, orgIdList: [], allowed: inherentOrgs },
		{ dataScope: 5, orgIdList: [otherOrg], allowed: [...inherentOrgs, otherOrg] },
		{ dataScope: 5, orgIdList: [], allowed: inherentOrgs },
		{ dataScope: 1, orgIdList: [], allowed: undefined },
		{ dataScope: 3, orgIdList: [], allowed: inherentOrgs },
	]) {
		await ok(admin, 'sysRole/grantDataScope', { id: role.Id, dataScope: scope.dataScope, orgIdList: scope.orgIdList });
		const result = await ok(reader, 'sysUser/page', { page: 1, pageSize: 100 });
		assert.deepEqual(result.items.map((user) => String(user.id)).sort(), expectedUsers(scope.allowed), `Scope ${scope.dataScope} must filter real user records after cache invalidation.`);
	}
	await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id] });
	report.steps.push('real-department-custom-empty-all-data-scopes-and-cache-transitions');
	const suffix = Date.now();
	const directoryId = await ok(admin, 'sysMenu/add', {
		title: `验收目录${suffix}`, type: 1, pid: 0, tenantId: role.TenantId,
		name: `acceptanceDir${suffix}`, path: `/acceptance-${suffix}`, component: 'layout/routerView/parent', status: 1,
	});
	const createdMenuIds = [];
	try {
		for (const variant of [
			{ name: 'flags', isHide: true, isKeepAlive: true, isAffix: true, isIframe: false, outLink: '' },
			{ name: 'external', isHide: false, isKeepAlive: false, isAffix: false, isIframe: false, outLink: 'http://127.0.0.1:1/isolated-external' },
			{ name: 'iframe', isHide: false, isKeepAlive: false, isAffix: false, isIframe: true, outLink: 'http://127.0.0.1:1/isolated-frame' },
		]) {
			const id = await ok(admin, 'sysMenu/add', {
				...variant, pid: directoryId, tenantId: role.TenantId, title: `${variant.name}-${suffix}`,
				name: `${variant.name}${suffix}`, path: `/acceptance-${suffix}/${variant.name}`,
				component: '/system/pos/index', type: 2, icon: 'ele-Setting', status: 1, orderNo: 120,
			});
			createdMenuIds.push(id);
			const tree = await ok(admin, 'sysMenu/vbenMenuTree', undefined, 'GET');
			const flatten = (nodes) => nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
			const runtimeMenu = flatten(tree).find((node) => node.name === `${variant.name}${suffix}`);
			assert.ok(runtimeMenu);
			assert.equal(runtimeMenu.path, `/acceptance-${suffix}/${variant.name}`);
			assert.equal(runtimeMenu.meta.hideInMenu, variant.isHide);
			assert.equal(runtimeMenu.meta.keepAlive, variant.isKeepAlive);
			assert.equal(runtimeMenu.meta.affixTab, variant.isAffix);
			assert.equal(runtimeMenu.meta.icon, 'ele-Setting');
			assert.equal(runtimeMenu.meta.title, `${variant.name}-${suffix}`);
			if (variant.name === 'iframe') assert.equal(runtimeMenu.meta.iframeSrc, variant.outLink);
			if (variant.name === 'external') assert.equal(runtimeMenu.meta.link, variant.outLink);
			if (variant.name === 'flags') assert.equal(runtimeMenu.component, '/system/pos/index');
			else assert.equal(runtimeMenu.component, 'IFrameView');
		}
		const buttonId = await ok(admin, 'sysMenu/add', {
			pid: createdMenuIds[0], title: '隔离测试按钮', type: 3, permission: `isolated${suffix}:read`, tenantId: role.TenantId, status: 1,
		});
		createdMenuIds.push(buttonId);
		const tree = await ok(admin, 'sysMenu/vbenMenuTree', undefined, 'GET');
		assert.ok(!JSON.stringify(tree).includes(`isolated${suffix}:read`));
		report.steps.push('real-menu-directory-button-flags-links-dto-roundtrip');
		const translation = { entityName: 'SysMenu', entityId: createdMenuIds[0], fieldName: 'Title', langCode: 'en-US', content: `Translated Menu ${suffix}` };
		await ok(admin, 'sysLangText/batchSave', [translation]);
		const savedTranslations = await ok(admin, 'sysLangText/list', { entityName: 'SysMenu', entityId: createdMenuIds[0], fieldName: 'Title' });
		assert.ok(savedTranslations.some((item) => item.langCode === 'en-US' && item.content === translation.content));
		await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id, createdMenuIds[0]] });
		await ok(reader, 'sysUser/setLangCode/en-US');
		const translatedReader = await login('TestUser3');
		try {
			const findMenu = (nodes) => nodes.flatMap((node) => [node, ...findMenu(node.children ?? [])]);
			const localized = findMenu(await ok(translatedReader, 'sysMenu/vbenMenuTree', undefined, 'GET'));
			assert.equal(localized.find((node) => node.name === `flags${suffix}`)?.meta.title, translation.content);
			translation.content = `Updated Translation ${suffix}`;
			await ok(admin, 'sysLangText/batchSave', [translation]);
			const refreshed = findMenu(await ok(translatedReader, 'sysMenu/vbenMenuTree', undefined, 'GET'));
			assert.equal(refreshed.find((node) => node.name === `flags${suffix}`)?.meta.title, translation.content);
			report.steps.push('real-menu-translation-language-relogin-and-cache-refresh');
		} finally {
			await ok(translatedReader, `sysUser/setLangCode/${encodeURIComponent(readerRecord.LangCode || 'zh-CN')}`);
			await ok(admin, 'sysRole/grantMenu', { id: role.Id, menuIdList: [queryMenu.Id] });
		}
	} finally {
		for (const id of createdMenuIds.reverse()) await ok(admin, 'sysMenu/delete', { id });
		await ok(admin, 'sysMenu/delete', { id: directoryId });
	}
	report.passed = true;
} catch (error) {
	report.error = String(error.message).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
	process.exitCode = 1;
} finally {
	for (const session of sessions) await call(session, 'sysAuth/logout').catch(() => {});
	db.close();
	mkdirSync(join(runtime, 'evidence'), { recursive: true });
	writeFileSync(join(runtime, 'evidence', 'role-service-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
