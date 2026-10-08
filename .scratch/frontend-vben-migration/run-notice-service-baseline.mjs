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
const baseUrl = new URL(marker.baseUrl);
assert.equal(baseUrl.protocol, 'http:');
assert.equal(baseUrl.hostname, '127.0.0.1');
const require = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const { sm2 } = require('sm-crypto-v2');
const seed = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8');
const password = seed.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
assert.ok(password && publicKey);
const database = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
database.exec('PRAGMA busy_timeout = 5000');
const report = { passed: false, proposalComplete: false, steps: [], pending: ['rich-text-ui', 'real-browser-signalr-delivery', 'tenant-boundaries', 'visual-acceptance'] };
const sessions = [];

async function call(path, data, session, method = 'POST') {
	const response = await fetch(new URL(`/api/${path}`, baseUrl), {
		method,
		headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' && data !== undefined ? JSON.stringify(data) : undefined,
		signal: AbortSignal.timeout(15_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	return response.json();
}
async function login(account) {
	const response = await call('sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	assert.equal(response.code, 200, `Real login failed for ${account}.`);
	sessions.push(response.result);
	return response.result;
}
function stored(id) {
	return database.prepare('SELECT * FROM SysNotice WHERE Id = ?').get(id);
}

try {
	const admin = await login('superAdmin.NET');
	const tenantAdmin = await login('Admin.NET');
	const reader = await login('TestUser3');
	const tenantIdentity = await call('sysAuth/userInfo', undefined, tenantAdmin, 'GET');
	assert.equal(tenantIdentity.code, 200);
	const readerIdentity = await call('sysAuth/userInfo', undefined, reader, 'GET');
	assert.equal(readerIdentity.code, 200);
	const identity = await call('sysAuth/userInfo', undefined, admin, 'GET');
	assert.equal(identity.code, 200);
	report.steps.push('three-real-sm2-logins');

	const title = `notice-${Date.now()}`;
	const html = '<p><strong>isolated notice</strong></p>';
	assert.equal((await call('sysNotice/add', {
		id: 999, title, content: html, type: 1, status: 1, createUserId: tenantIdentity.result.id,
		publicTime: '2000-01-01T00:00:00',
	}, admin)).code, 200);
	const page = await call('sysNotice/page', { page: 1, pageSize: 20, title }, admin);
	assert.equal(page.code, 200);
	const notice = page.result.items.find((item) => item.title === title);
	assert.ok(notice);
	const created = stored(notice.id);
	assert.equal(String(created.CreateUserId), String(identity.result.id));
	assert.equal(created.Status, 0);
	assert.equal(created.PublicTime, null);
	report.steps.push('forged-create-metadata-ignored-real-draft');

	const forged = await call('sysNotice/update', {
		id: notice.id, title: 'forged-overwrite', content: 'forged', type: 1, createUserId: tenantIdentity.result.id,
	}, tenantAdmin);
	assert.notEqual(forged.code, 200);
	assert.equal(stored(notice.id).Title, title);
	report.steps.push('real-foreign-owner-update-rejected');
	assert.equal((await call('sysNotice/add', { title: 'unauthorized', content: 'test', type: 1 }, reader)).code, 403);
	report.steps.push('unauthorized-create-rejected');

	assert.equal((await call('sysNotice/update', { id: notice.id, title, content: `${html}<p>edited</p>`, type: 2, status: 1 }, admin)).code, 200);
	assert.equal(stored(notice.id).Status, 0);
	assert.equal(stored(notice.id).Type, 2);
	assert.equal((await call('sysNotice/public', { id: notice.id }, admin)).code, 200);
	const published = stored(notice.id);
	assert.equal(published.Status, 1);
	const unread = await call('sysNotice/unReadList', undefined, reader, 'GET');
	assert.equal(unread.code, 200);
	assert.ok(unread.result.some((item) => String(item.id) === String(notice.id)));
	report.steps.push('real-edit-publish-persisted-unread');

	assert.equal((await call('sysNotice/setRead', { id: notice.id }, reader)).code, 200);
	const receipt = database.prepare('SELECT Id, ReadStatus, ReadTime FROM SysNoticeUser WHERE NoticeId = ? AND UserId = ?').get(notice.id, readerIdentity.result.id);
	assert.equal(receipt.ReadStatus, 1);
	assert.equal((await call('sysNotice/setRead', { id: notice.id }, reader)).code, 200);
	assert.equal((await call('sysNotice/public', { id: notice.id }, admin)).code, 200);
	const after = database.prepare('SELECT Id, ReadStatus, ReadTime FROM SysNoticeUser WHERE NoticeId = ? AND UserId = ?').get(notice.id, readerIdentity.result.id);
	assert.deepEqual(after, receipt);
	assert.equal(stored(notice.id).PublicTime, published.PublicTime);
	const afterUnread = await call('sysNotice/unReadList', undefined, reader, 'GET');
	assert.equal(afterUnread.code, 200);
	assert.ok(!afterUnread.result.some((item) => String(item.id) === String(notice.id)));
	report.steps.push('real-read-and-republish-preserve-receipt');

	assert.notEqual((await call('sysNotice/update', { id: notice.id, title: 'changed-after-publish', content: 'changed', type: 1, createUserId: identity.result.id }, admin)).code, 200);
	assert.notEqual((await call('sysNotice/delete', { id: notice.id }, admin)).code, 200);
	assert.equal(stored(notice.id).Title, title);
	report.steps.push('published-edit-and-delete-rejected');
	report.passed = true;
} catch (error) {
	report.error = String(error.message).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
	process.exitCode = 1;
} finally {
	for (const session of sessions) await call('sysAuth/logout', undefined, session).catch(() => {});
	database.close();
	const evidence = join(runtime, 'evidence');
	mkdirSync(evidence, { recursive: true });
	writeFileSync(join(evidence, 'notice-service-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
