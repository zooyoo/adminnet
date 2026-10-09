import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';
import { localFileFixtures, localVideo } from './file-fixtures.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'production-desktop-real-isolated-api', steps: [], cleanupErrors: [] };
const prefix = `files-${randomBytes(4).toString('hex')}`;
const secrets = [], physical = [], ids = new Set();
let runtime, base, evidence, db, password, publicKey, admin, ordinary, originalGrants, originalProfile, browser, context, page, proxy, stage = 'initialize', stopped = false;

async function launchApi() {
	return new Promise((resolveLaunch, reject) => {
		const child = spawn('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-OnlineFixture', '-FileDeduplication', '-BuildRoot', join(tmpdir(), 'adminnet-vben-build-17')],
			{ windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
		let output = '';
		const timer = setTimeout(() => { child.kill(); reject(new Error('Isolated API startup timeout')); }, 180_000);
		child.stdout.on('data', (chunk) => {
			output += chunk.toString();
			if (!output.includes('Ready: real sysConfig/sysInfo returned code 200.')) return;
			clearTimeout(timer); child.stdout.destroy(); child.stderr.destroy(); child.unref();
			resolveLaunch(realpathSync(output.match(/Runtime: ([^\r\n]+)/)[1]));
		});
		child.stderr.on('data', () => {});
		child.once('error', reject);
		child.once('exit', (code) => { if (code) { clearTimeout(timer); reject(new Error('Isolated API startup failed')); } });
	});
}
function headers(session) {
	return session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {};
}
function tokens(response, session) {
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
		secrets.push(session.accessToken, session.refreshToken);
	}
}
async function api(session, path, data, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...headers(session) },
		body: method === 'POST' ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30_000),
	});
	tokens(response, session);
	if (refusal && [401, 403].includes(response.status)) return;
	const result = await response.json();
	if (refusal) { assert.notEqual(result.code, 200, `${path} should refuse`); return; }
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}`);
	return result.result;
}
async function login(account) {
	const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(session.accessToken, session.refreshToken); return session;
}
async function upload(session, fixture, isPublic = false, refusal = false, route = 'uploadFile') {
	const data = new FormData();
	data.append('file', new Blob([fixture.bytes], { type: fixture.type }), `${prefix}-${fixture.name}`);
	data.append('fileType', '相关文件'); data.append('isPublic', String(isPublic));
	const response = await fetch(new URL(`/api/sysFile/${route}`, base), { method: 'POST', headers: headers(session), body: data, signal: AbortSignal.timeout(30_000) });
	tokens(response, session);
	if (refusal && [401, 403].includes(response.status)) return;
	const result = await response.json();
	if (refusal) { assert.notEqual(result.code, 200); return; }
	assert.equal(result.code, 200, `upload ${fixture.name} code=${result.code}`);
	ids.add(result.result.id);
	physical.push(join(runtime, 'wwwroot', result.result.filePath, `${result.result.id}${result.result.suffix}`));
	return result.result;
}
async function binary(session, id, refusal = false, route = '/api/sysFile/downloadFile') {
	const response = await fetch(new URL(route, base), {
		method: route.endsWith('downloadFile') ? 'POST' : 'GET',
		headers: { 'Content-Type': 'application/json', ...headers(session) },
		body: route.endsWith('downloadFile') ? JSON.stringify({ id }) : undefined,
	});
	tokens(response, session);
	if (refusal) {
		if ([401, 403].includes(response.status)) return;
		assert.match(response.headers.get('content-type') ?? '', /json/);
		assert.notEqual((await response.json()).code, 200);
		return;
	}
	assert.equal(response.status, 200);
	assert.doesNotMatch(response.headers.get('content-type') ?? '', /json/);
	return { bytes: Buffer.from(await response.arrayBuffer()), disposition: response.headers.get('content-disposition') };
}
async function enter(session) {
	const menus = await api(session, 'sysMenu/vbenMenuTree', undefined, 'GET');
	const paths = [];
	function visit(nodes) { for (const node of nodes) { if (node.component === '/system/file/index') paths.push(node.path); visit(node.children ?? []); } }
	visit(menus);
	assert.ok(paths.includes('/platform/file'), `File menu missing: ${JSON.stringify(paths)}`);
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(session.accessToken)}&redirect=%2Fplatform%2Ffile`);
	await expect(page.getByRole('heading', { name: '文件管理', exact: true })).toBeVisible();
}
async function query(name) {
	await page.locator('.query-form').getByLabel('文件名称', { exact: true }).fill(name);
	await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysFile/page') && response.request().method() === 'POST'),
		page.getByRole('button', { name: /^查\s*询$/ }).click()]);
}
function row(name) { return page.getByRole('row').filter({ has: page.getByText(name, { exact: true }) }); }
async function shot(name) {
	if (!(await page.getByRole('dialog').count())) {
		await page.evaluate(() => {
			for (const element of document.querySelectorAll('*')) {
				if (element.scrollLeft) element.scrollLeft = 0;
			}
		});
	}
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) =>
		animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), fullPage: true, mask: [page.locator('input[type=password]')] });
}
async function stopApi() {
	if (stopped) return;
	await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30_000 });
	stopped = true;
}
async function cleanup() {
	if (originalProfile) {
		try {
			await api(admin, 'sysUser/baseInfo', originalProfile);
			const saved = db.prepare('SELECT Avatar, Signature FROM SysUser WHERE Id = ?').get(originalProfile.id);
			assert.equal(saved.Avatar, originalProfile.avatar ?? null);
			assert.equal(saved.Signature, originalProfile.signature ?? null);
			originalProfile = undefined;
		}
		catch { report.cleanupErrors.push('profile-restore'); }
	}
	// 同时反查前缀，覆盖浏览器已写入但响应等待失败的文件。
	for (const record of db.prepare('SELECT Id FROM SysFile WHERE FileName LIKE ?').all(`${prefix}%`)) ids.add(record.Id);
	for (const id of ids) {
		try { if (db.prepare('SELECT Id FROM SysFile WHERE Id = ?').get(id)) await api(admin, 'sysFile/delete', { id }); }
		catch { report.cleanupErrors.push('file-delete'); }
	}
	if (originalGrants) {
		try {
			await api(admin, 'sysRole/grantMenu', { id: 1300000990201, menuIdList: originalGrants });
			assert.deepEqual(db.prepare('SELECT MenuId FROM SysRoleMenu WHERE RoleId = ? ORDER BY MenuId').all(1300000990201).map((record) => record.MenuId),
				[...originalGrants].sort((a, b) => a - b));
			originalGrants = undefined;
		}
		catch { report.cleanupErrors.push('role-restore'); }
	}
	try {
		assert.equal(db.prepare('SELECT COUNT(*) n FROM SysFile WHERE FileName LIKE ?').get(`${prefix}%`).n, 0);
		for (const path of physical) assert.equal(existsSync(path), false);
	} catch { report.cleanupErrors.push('file-database-storage-cleanup'); }
	report.cleanupPassed = report.cleanupErrors.length === 0;
}

try {
	runtime = await launchApi();
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true }); db.exec('PRAGMA busy_timeout=5000');
	password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey); secrets.push(password);
	admin = await login('superAdmin.NET'); ordinary = await login('TestUser3');
	const fixtures = localFileFixtures(join(root, 'Web/apps/web-antdv-next/package.json'));
	stage = 'real-permission-and-tenant';
	const privateFile = await upload(admin, fixtures[0]);
	assert.equal((await upload(admin, fixtures[0])).id, privateFile.id);
	await api(ordinary, 'sysFile/page', {}, 'POST', true);
	await upload(ordinary, fixtures[0], false, true);
	await binary(ordinary, privateFile.id, true);
	await binary(undefined, privateFile.id, true);
	assert.equal((await fetch(new URL(`/${privateFile.url}`, base))).status, 403);
	assert.equal((await fetch(new URL(`/${privateFile.url}?width=80`, base))).status, 403);
	originalGrants = db.prepare('SELECT MenuId FROM SysRoleMenu WHERE RoleId = ?').all(1300000990201).map((record) => record.MenuId);
	const grants = db.prepare("SELECT Id FROM SysMenu WHERE Permission LIKE 'sysFile:%' OR Path = '/platform/file'").all().map((record) => record.Id);
	await api(admin, 'sysRole/grantMenu', { id: 1300000990201, menuIdList: [...new Set([...originalGrants, ...grants])] });
	ordinary = await login('TestUser3');
	const buttons = (await api(ordinary, 'sysAuth/userInfo', undefined, 'GET')).buttons;
	assert.ok(buttons.includes('sysFile:downloadFile'));
	const foreign = await api(admin, 'sysTenant/changeTenant', { id: 1300000990001 });
	secrets.push(foreign.accessToken, foreign.refreshToken);
	const foreignFile = await upload(foreign, { ...fixtures[0], name: '外租户.png' });
	// 切换接口同时换发响应头令牌；重新登录恢复默认租户后再验证管理页。
	admin = await login('superAdmin.NET');
	await binary(ordinary, foreignFile.id, true);
	await binary(ordinary, foreignFile.id, true, `/api/sysFile/preview/${foreignFile.id}`);
	await api(ordinary, 'sysFile/update', { ...foreignFile, fileName: '禁止修改' }, 'POST', true);
	await api(ordinary, 'sysFile/delete', { id: foreignFile.id }, 'POST', true);
	const ownFile = await upload(ordinary, { ...fixtures[0], name: '本人.png' });
	assert.deepEqual((await binary(ordinary, ownFile.id)).bytes, fixtures[0].bytes);
	assert.equal((await api(ordinary, 'sysFile/page', { page: 1, pageSize: 100, tenantId: 1300000990001 })).items.some((record) => record.id === foreignFile.id), false);
	await api(foreign, 'sysFile/update', { ...foreignFile, isPublic: true });
	assert.deepEqual((await binary(ordinary, foreignFile.id)).bytes, fixtures[0].bytes);
	await api(ordinary, 'sysFile/update', { ...foreignFile, fileName: '禁止改写公开文件' }, 'POST', true);
	await api(ordinary, 'sysFile/delete', { id: foreignFile.id }, 'POST', true);
	await api(foreign, 'sysFile/update', { ...foreignFile, isPublic: false });
	report.steps.push(stage);

	stage = 'real-validation-metadata-public-boundary';
	const before = db.prepare('SELECT * FROM SysFile WHERE Id = ?').get(privateFile.id);
	await api(admin, 'sysFile/update', { ...privateFile, fileName: `${prefix}-重命名`, filePath: '../escape', url: 'https://example.invalid', suffix: '.exe', tenantId: 99, createUserId: 99, bucketName: 'Other', isPublic: true });
	const after = db.prepare('SELECT * FROM SysFile WHERE Id = ?').get(privateFile.id);
	for (const field of ['FilePath', 'Url', 'Suffix', 'TenantId', 'CreateUserId', 'BucketName']) assert.equal(after[field], before[field]);
	const publicResponse = await fetch(new URL(`/${privateFile.url}`, base));
	assert.equal(publicResponse.status, 200); assert.deepEqual(Buffer.from(await publicResponse.arrayBuffer()), fixtures[0].bytes);
	assert.match(publicResponse.headers.get('cache-control') ?? '', /no-store/);
	await api(admin, 'sysFile/update', { ...privateFile, fileName: `${prefix}-重命名`, isPublic: false });
	assert.equal((await fetch(new URL(`/${privateFile.url}`, base))).status, 403);
	await api(admin, 'sysFile/update', { ...privateFile, fileName: '' }, 'POST', true);
	await api(admin, 'sysFile/update', { ...privateFile, fileName: '../escape' }, 'POST', true);
	await upload(admin, { name: '空.png', type: 'image/png', bytes: Buffer.alloc(0) }, false, true);
	await upload(admin, { name: '过大.png', type: 'image/png', bytes: Buffer.alloc(10 * 1024 * 1024 + 1) }, false, true);
	await upload(admin, { name: '非法.exe', type: 'application/x-msdownload', bytes: Buffer.from('bad') }, false, true);
	const downloaded = await binary(admin, privateFile.id);
	assert.deepEqual(downloaded.bytes, fixtures[0].bytes);
	assert.ok(decodeURIComponent(downloaded.disposition).includes('重命名.png'));
	report.steps.push(stage);

	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1440, height: 1100 }, acceptDownloads: true });
	page = await context.newPage(); page.setDefaultTimeout(20_000);
	fixtures.push(await localVideo(page));
	for (const fixture of fixtures) writeFileSync(join(evidence, fixture.name), fixture.bytes);
	stage = 'real-business-image-contract';
	originalProfile = await api(admin, 'sysUser/baseInfo', undefined, 'GET');
	const signature = await upload(admin, { ...fixtures[0], name: '签名.png' }, false, false, 'uploadSignature');
	const avatar = await upload(admin, { ...fixtures[0], name: '头像.png' }, false, false, 'uploadAvatar');
	assert.equal((await upload(admin, { ...fixtures[0], name: '签名.png' }, false, false, 'uploadSignature')).id, signature.id);
	assert.equal((await upload(admin, { ...fixtures[0], name: '头像.png' }, false, false, 'uploadAvatar')).id, avatar.id);
	assert.deepEqual((await binary(admin, signature.id, false, '/api/sysFile/ownSignature')).bytes, fixtures[0].bytes);
	await binary(ordinary, signature.id, true, '/api/sysFile/ownSignature');
	assert.equal((await fetch(new URL(`/${signature.url}`, base))).status, 403);
	assert.equal((await fetch(new URL(`/${avatar.url}`, base))).status, 200);
	await enter(admin);
	await page.goto(`${proxy.baseUrl}/#/profile`);
	await expect.poll(() => page.getByRole('img', { name: '电子签名', exact: true }).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	await expect.poll(() => page.getByRole('img', { name: '个人头像', exact: true }).evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	await shot('file-profile-images.png');
	await page.goto(`${proxy.baseUrl}/#/platform/file`);
	await expect(page.getByRole('heading', { name: '文件管理', exact: true })).toBeVisible();
	report.steps.push(stage);
	stage = 'desktop-upload-image-edit-download';
	await page.getByRole('button', { name: '上传文件', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '上传文件', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByRole('alert')).toContainText('请选择有效文件');
	await dialog.locator('input[type=file]').setInputFiles({ name: `${prefix}-桌面.png`, mimeType: fixtures[0].type, buffer: fixtures[0].bytes });
	await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysFile/uploadFile') && response.request().method() === 'POST'),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	await expect(dialog).toBeHidden();
	await query(`${prefix}-桌面`);
	await expect(row(`${prefix}-桌面`)).toBeVisible();
	const desktopFile = db.prepare('SELECT * FROM SysFile WHERE FileName = ?').get(`${prefix}-桌面`);
	assert.ok(desktopFile); ids.add(desktopFile.Id); physical.push(join(runtime, 'wwwroot', desktopFile.FilePath, `${desktopFile.Id}${desktopFile.Suffix}`));
	await row(`${prefix}-桌面`).getByRole('button', { name: '预览', exact: true }).click();
	dialog = page.getByRole('dialog', { name: `${prefix}-桌面.png`, exact: true });
	await expect(dialog.getByRole('img', { name: `${prefix}-桌面.png` })).toBeVisible();
	await expect.poll(() => dialog.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	await shot('file-image.png');
	await dialog.getByRole('button', { name: '关闭', exact: true }).click();
	await row(`${prefix}-桌面`).getByRole('button', { name: '编辑', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑文件', exact: true });
	await dialog.getByLabel('文件名称', { exact: true }).fill(`${prefix}-桌面改名`);
	await dialog.getByLabel('文件别名', { exact: true }).fill('桌面元数据');
	await dialog.getByLabel('业务数据 ID', { exact: true }).fill('1718');
	await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysFile/update')),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	await expect(dialog).toBeHidden();
	await query(`${prefix}-桌面改名`);
	assert.equal(db.prepare('SELECT FileAlias FROM SysFile WHERE Id = ?').get(desktopFile.Id).FileAlias, '桌面元数据');
	const [download] = await Promise.all([page.waitForEvent('download'), row(`${prefix}-桌面改名`).getByRole('button', { name: '下载', exact: true }).click()]);
	assert.equal(download.suggestedFilename(), `${prefix}-桌面改名.png`);
	await download.saveAs(join(evidence, 'browser-download.png'));
	assert.deepEqual(readFileSync(join(evidence, 'browser-download.png')), fixtures[0].bytes);
	await shot('file-list-dark.png');
	await page.getByRole('button', { name: 'light', exact: true }).click();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	await shot('file-list-light.png');
	report.steps.push(stage);

	stage = 'desktop-office-pdf-media-errors';
	for (const fixture of fixtures.slice(1)) {
		const file = await upload(admin, fixture);
		await query(file.fileName);
		await row(file.fileName).getByRole('button', { name: '预览', exact: true }).click();
		dialog = page.getByRole('dialog', { name: `${file.fileName}${file.suffix}`, exact: true });
		if (fixture.name === '说明.txt') await expect(dialog.getByRole('alert')).toContainText('不支持预览');
		else if (fixture.name === '损坏.docx') await expect(dialog.getByRole('alert')).toContainText('文件加载失败');
		else {
			await expect(dialog.getByText('正在加载文件', { exact: true })).toHaveCount(0, { timeout: 45_000 });
			await expect(dialog.getByRole('alert')).toHaveCount(0);
			if (file.suffix === '.docx') await expect(dialog.getByText('本地文件预览验收', { exact: true })).toBeVisible();
			if (file.suffix === '.xlsx') await expect(dialog.locator('canvas').first()).toBeVisible();
			if (file.suffix === '.pdf') {
				await expect(dialog.locator('canvas').first()).toBeVisible();
				assert.ok(await dialog.locator('canvas').first().evaluate((canvas) => canvas.width > 0 && canvas.height > 0));
			}
			if (['.wav', '.webm'].includes(file.suffix)) {
				const media = dialog.locator('audio,video');
				await expect.poll(() => media.evaluate((element) => element.readyState)).toBeGreaterThanOrEqual(1);
				await media.evaluate((element) => { element.muted = true; return element.play(); });
				await expect.poll(() => media.evaluate((element) => element.currentTime)).toBeGreaterThan(0);
				await media.evaluate((element) => element.pause());
			}
		}
		await shot(`file-preview-${fixture.name.split('.')[0]}.png`);
		await dialog.getByRole('button', { name: '关闭', exact: true }).click();
		await expect(page.locator('.preview-content audio, .preview-content video, .preview-content canvas')).toHaveCount(0);
	}
	report.steps.push(stage);

	stage = 'desktop-delete-cancel-refresh';
	await query(`${prefix}-桌面改名`);
	await page.reload(); await expect(row(`${prefix}-桌面改名`)).toBeVisible();
	await row(`${prefix}-桌面改名`).getByRole('button', { name: '删除', exact: true }).click();
	dialog = page.getByRole('dialog');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	assert.ok(db.prepare('SELECT Id FROM SysFile WHERE Id = ?').get(desktopFile.Id));
	await row(`${prefix}-桌面改名`).getByRole('button', { name: '删除', exact: true }).click();
	await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysFile/delete')),
		page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/ }).click()]);
	await expect(row(`${prefix}-桌面改名`)).toHaveCount(0);
	assert.equal(db.prepare('SELECT Id FROM SysFile WHERE Id = ?').get(desktopFile.Id), undefined);
	report.steps.push(stage);

	await cleanup(); assert.equal(report.cleanupPassed, true);
	await query(prefix);
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	stage = 'real-outage-draft';
	await page.getByRole('button', { name: '上传文件', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '上传文件', exact: true });
	await dialog.locator('input[type=file]').setInputFiles({ name: `${prefix}-停机.png`, mimeType: fixtures[0].type, buffer: fixtures[0].bytes });
	await stopApi();
	const [outage] = await Promise.all([page.waitForResponse((response) => response.url().endsWith('/sysFile/uploadFile')),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.equal(outage.status(), 502);
	await expect(dialog).toBeVisible(); await expect(dialog.getByText(`${prefix}-停机.png`, { exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await expect(page.locator('.ant-message-error')).toHaveCount(1);
	assert.equal(db.prepare('SELECT COUNT(*) n FROM SysFile WHERE FileName LIKE ?').get(`${prefix}%`).n, 0);
	await page.screenshot({ path: join(evidence, 'file-outage.png'), fullPage: true });
	report.steps.push(stage); report.passed = true;
} catch (error) {
	let message = String(error.message ?? error);
	for (const value of secrets) if (value) message = message.replaceAll(value, '[REDACTED]');
	report.error = { stage, message }; process.exitCode = 1;
	if (evidence) {
		writeFileSync(join(evidence, 'file-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
		try { await page?.screenshot({ path: join(evidence, 'file-failed.png'), fullPage: true, mask: [page.locator('input[type=password]')] }); } catch {}
	}
} finally {
	if (!report.cleanupPassed && admin && db && !stopped) await cleanup();
	for (const [name, action] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['database', () => db?.close()], ['api', () => runtime && stopApi()]]) {
		try { await action(); } catch { report.cleanupErrors.push(name); process.exitCode = 1; }
	}
	report.cleanupPassed = report.cleanupPassed && report.cleanupErrors.length === 0;
	if (evidence) writeFileSync(join(evidence, 'file-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
