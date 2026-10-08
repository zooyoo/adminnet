import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { createServer, request } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(repositoryRoot, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runtimeRoot = realpathSync(resolve(process.argv[2] ?? ''));
const marker = JSON.parse(readFileSync(join(runtimeRoot, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(dirname(runtimeRoot).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtimeRoot), /^adminnet-vben-[a-f0-9]{32}$/);
assert.equal(marker.runtimeRoot.toLowerCase(), runtimeRoot.toLowerCase());
const apiUrl = new URL(marker.baseUrl);
assert.equal(apiUrl.protocol, 'http:');
assert.equal(apiUrl.hostname, '127.0.0.1');
const distRoot = realpathSync(join(repositoryRoot, 'Web/dist'));
assert.ok(existsSync(join(distRoot, 'index.html')), 'Build the production frontend first.');
const outputRoot = join(runtimeRoot, 'evidence');
mkdirSync(outputRoot, { recursive: true });
const database = new DatabaseSync(join(runtimeRoot, 'main.db'), { readOnly: true });
const passwordSeed = readFileSync(join(repositoryRoot, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8');
const password = passwordSeed.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
assert.ok(password, 'The isolated seed password must be available.');
const account = 'superAdmin.NET';
const mimeTypes = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json',
	'.svg': 'image/svg+xml',
	'.png': 'image/png',
	'.woff2': 'font/woff2',
	'.ico': 'image/x-icon',
};
const upstreamRequests = new Set();
const server = createServer((incoming, outgoing) => {
	const url = new URL(incoming.url, 'http://127.0.0.1');
	if (url.pathname.startsWith('/prod-api/')) {
		const upstream = request(new URL(url.pathname.slice('/prod-api'.length) + url.search, apiUrl), {
			method: incoming.method,
			agent: false,
			headers: { ...incoming.headers, host: apiUrl.host, connection: 'close' },
		}, (response) => {
			outgoing.writeHead(response.statusCode, response.headers);
			response.pipe(outgoing);
		});
		upstreamRequests.add(upstream);
		upstream.on('close', () => upstreamRequests.delete(upstream));
		upstream.setTimeout(15_000, () => upstream.destroy());
		upstream.on('error', () => {
			outgoing.writeHead(502);
			outgoing.end('Isolated API unavailable');
		});
		incoming.pipe(upstream);
		return;
	}
	try {
		const target = realpathSync(join(distRoot, decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)));
		if (!target.startsWith(distRoot + sep) || !statSync(target).isFile()) {
			outgoing.writeHead(404).end();
			return;
		}
		outgoing.writeHead(200, { 'content-type': mimeTypes[extname(target)] ?? 'application/octet-stream' });
		createReadStream(target).pipe(outgoing);
	} catch {
		outgoing.writeHead(404).end();
	}
});
await new Promise((resolveListening, reject) => {
	server.once('error', reject);
	server.listen(0, '127.0.0.1', resolveListening);
});
const baseUrl = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'msedge' });
const report = { baselinePassed: false, proposalComplete: false, scenarios: [], pending: ['captcha-positive', 'second-verification', 'token-renewal', 'permission-denial', 'tenant-isolation', 'service-failure', 'mobile-touch-logout', 'visual-acceptance'] };

try {
	for (const device of [
		{ name: 'desktop', viewport: { width: 1440, height: 1000 } },
		{ name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
	]) {
		const context = await browser.newContext(device);
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		const errors = [];
		page.on('pageerror', (error) => errors.push(error.message));
		const code = `baseline-${device.name}-${Date.now()}`;
		let loginToken;
		let positionAddRequests = 0;
		page.on('request', (outgoing) => {
			if (new URL(outgoing.url()).pathname.endsWith('/api/sysPos/add')) positionAddRequests++;
			if (new URL(outgoing.url()).pathname.endsWith('/api/sysAuth/login')) {
				const payload = outgoing.postDataJSON();
				assert.notEqual(payload.password, password, 'Password must be encrypted on the wire.');
				assert.match(payload.password, /^[a-f0-9]+$/i);
			}
		});
		async function login() {
			await page.goto(`${baseUrl}/#/auth/login?redirect=%2Fsystem%2Fpos`);
			await expect(page.locator('button[type=submit]')).toBeEnabled();
			await page.getByLabel('账号', { exact: true }).fill(account);
			await page.getByLabel('密码', { exact: true }).fill(password);
			const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/login'));
			await page.locator('button[type=submit]').click();
			const result = await (await loginResponse).json();
			assert.equal(result.code, 200, 'Real login must succeed.');
			loginToken = result.result.accessToken;
			assert.ok(loginToken);
			await expect(page).toHaveURL(/#\/system\/pos$/);
			await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
		}
		try {
			await login();
			await page.reload();
			await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
			await page.getByRole('button', { name: '新增职位', exact: true }).click();
			const dialog = page.getByRole('dialog');
			const requestsBeforeValidation = positionAddRequests;
			await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
			await expect(dialog.getByText('请输入职位名称', { exact: true })).toBeVisible();
			await expect(dialog.getByText('请输入职位编码', { exact: true })).toBeVisible();
			assert.equal(positionAddRequests, requestsBeforeValidation, 'Invalid input must not submit an API request.');
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(code).count, 0);
			await dialog.getByLabel('职位名称', { exact: true }).fill(code);
			await dialog.getByLabel('职位编码', { exact: true }).fill(code);
			await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
			await expect(dialog).toBeHidden();
			await expect(page.getByRole('cell', { name: code, exact: true }).first()).toBeVisible();
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(code).count, 1);
			await page.getByRole('button', { name: '新增职位', exact: true }).click();
			await dialog.getByLabel('职位名称', { exact: true }).fill(code);
			await dialog.getByLabel('职位编码', { exact: true }).fill(code);
			const duplicateResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPos/add'));
			await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
			const duplicateResult = await (await duplicateResponse).json();
			assert.notEqual(duplicateResult.code, 200, 'The real API must reject a duplicate position.');
			await expect(dialog).toBeVisible();
			await expect(dialog.getByLabel('职位名称', { exact: true })).toHaveValue(code);
			await expect(dialog.getByLabel('职位编码', { exact: true })).toHaveValue(code);
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(code).count, 1);
			await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
			await expect(dialog).toBeHidden();
			const invalidResponse = await context.request.post(new URL('/api/sysPos/add', apiUrl).href, {
				headers: { Authorization: `Bearer ${loginToken}` },
				data: { name: '', code: `${code}-invalid`, status: 1 },
			});
			assert.notEqual((await invalidResponse.json()).code, 200, 'The API must independently reject an empty name.');
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(`${code}-invalid`).count, 0);
			await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: '编辑职位' }).click();
			await dialog.getByLabel('职位名称', { exact: true }).fill(`${code}-edited`);
			await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
			await expect(dialog).toBeHidden();
			await expect(page.getByRole('cell', { name: `${code}-edited`, exact: true })).toBeVisible();
			assert.equal(database.prepare('SELECT Name FROM SysPos WHERE Code = ?').get(code).Name, `${code}-edited`);
			await page.getByRole('row').filter({ hasText: code }).getByRole('button', { name: '删除职位' }).click();
			await page.getByRole('button', { name: /^确\s*定$/ }).click();
			await expect(page.getByRole('cell', { name: `${code}-edited`, exact: true })).toHaveCount(0);
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(code).count, 0);
			await expect(page.getByText('保存成功', { exact: true })).toHaveCount(0, { timeout: 15_000 });
			await expect(page.getByText('删除成功', { exact: true })).toHaveCount(0, { timeout: 15_000 });
			await expect(page.getByText('登录成功', { exact: true })).toHaveCount(0, { timeout: 15_000 });
			await page.screenshot({ path: join(outputRoot, `${device.name}-positions.png`), fullPage: true });
			assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
			if (device.hasTouch) {
				const headerLogout = page.getByRole('button', { name: '退出登录' })
					.or(page.locator('button').filter({ has: page.locator('svg.lucide-log-out') }))
					.or(page.getByRole('img', { name: /管理员/ }));
				await expect(headerLogout.first()).toBeVisible({ timeout: 5000 });
				await headerLogout.first().tap();
				const dropdownLogout = page.getByRole('menuitem', { name: /退出登录/ }).or(page.getByText('退出登录', { exact: true }));
				if (await dropdownLogout.first().isVisible({ timeout: 1000 }).catch(() => false)) {
					await dropdownLogout.first().tap();
				}
			} else {
				await page.keyboard.press('Alt+q');
			}
			const logoutDialog = page.getByRole('dialog');
			await expect(logoutDialog).toBeVisible();
			const logoutResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/logout'));
			const confirmBtn = logoutDialog.getByRole('button', { name: /^确\s*认$/ });
			if (device.hasTouch) {
				await confirmBtn.tap();
			} else {
				await confirmBtn.click();
			}
			assert.equal((await (await logoutResponse).json()).code, 200);
			await expect(page).toHaveURL(/#\/auth\/login$/);
			await page.goto(`${baseUrl}/#/system/pos`);
			await expect(page).toHaveURL(/#\/auth\/login/);
			await login();
			assert.deepEqual(errors, []);
			report.scenarios.push({
				device: device.name,
				login: true,
				refresh: true,
				databaseCrud: true,
				inputValidation: true,
				serverValidation: true,
				duplicateDraftPreserved: true,
				logoutMethod: device.hasTouch ? 'touch-header-logout' : 'keyboard-alt-q',
				relogin: true,
			});
			if (device.hasTouch) {
				report.pending = report.pending.filter((item) => item !== 'mobile-touch-logout');
			}
			console.log(`${device.name}: real login, validation, duplicate rejection, persisted CRUD, logout (${device.hasTouch ? 'touch' : 'keyboard'}) and relogin passed.`);
		} catch (error) {
			await page.getByLabel('密码', { exact: true }).fill('').catch(() => {});
			await page.screenshot({ path: join(outputRoot, `${device.name}-failure.png`), fullPage: true }).catch(() => {});
			throw error;
		} finally {
			if (loginToken) {
				await context.request.post(new URL('/api/sysAuth/logout', apiUrl).href, { headers: { Authorization: `Bearer ${loginToken}` }, timeout: 15_000 });
			}
			await context.close();
		}
	}
	const restrictedContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	let restrictedToken;
	try {
		const restrictedPage = await restrictedContext.newPage();
		await restrictedPage.goto(`${baseUrl}/#/auth/login`);
		await expect(restrictedPage.locator('button[type=submit]')).toBeEnabled();
		await restrictedPage.getByLabel('账号', { exact: true }).fill('TestUser3');
		await restrictedPage.getByLabel('密码', { exact: true }).fill(password);
		const loginResponse = restrictedPage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/login'));
		const userInfoResponse = restrictedPage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/userInfo'));
		await restrictedPage.locator('button[type=submit]').click();
		const loginResult = await (await loginResponse).json();
		assert.equal(loginResult.code, 200, 'The restricted real account must authenticate successfully.');
		restrictedToken = loginResult.result.accessToken;
		const userInfo = await (await userInfoResponse).json();
		assert.equal(userInfo.code, 200);
		assert.ok(!userInfo.result.buttons.includes('sysPos:add'), 'The fixture account must not hold position write permission.');
		const restrictedCode = `baseline-denied-${Date.now()}`;
		const deniedResponse = await restrictedContext.request.post(new URL('/api/sysPos/add', apiUrl).href, {
			headers: { Authorization: `Bearer ${restrictedToken}` },
			data: { name: restrictedCode, code: restrictedCode, status: 1 },
		});
		const deniedBody = await deniedResponse.json();
		assert.ok(deniedResponse.status() === 403 || deniedBody.code === 403, 'The service must reject an authenticated unauthorized write with 403.');
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(restrictedCode).count, 0);
		await restrictedPage.goto(`${baseUrl}/#/system/pos`);
		await expect(restrictedPage.getByRole('button', { name: '新增职位', exact: true })).toHaveCount(0);
		report.scenarios.push({ account: 'TestUser3', authenticated: true, serverWriteForbidden: true, noDatabaseMutation: true });
		report.pending = report.pending.filter((item) => item !== 'permission-denial');
		console.log('restricted account: real authentication, server-side 403 and unchanged database passed.');
	} finally {
		if (restrictedToken) {
			await restrictedContext.request.post(new URL('/api/sysAuth/logout', apiUrl).href, { headers: { Authorization: `Bearer ${restrictedToken}` }, timeout: 15_000 });
		}
		await restrictedContext.close();
	}
	const outageContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	let mobileOutageContext;
	try {
		const outagePage = await outageContext.newPage();
		await outagePage.goto(`${baseUrl}/#/auth/login?redirect=%2Fsystem%2Fpos`);
		await expect(outagePage.locator('button[type=submit]')).toBeEnabled();
		await outagePage.getByLabel('账号', { exact: true }).fill('Admin.NET');
		await outagePage.getByLabel('密码', { exact: true }).fill(password);
		const tenantLoginResponse = outagePage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/login'));
		await outagePage.locator('button[type=submit]').click();
		const tenantLogin = await (await tenantLoginResponse).json();
		assert.equal(tenantLogin.code, 200);
		const tenantHeaders = { Authorization: `Bearer ${tenantLogin.result.accessToken}` };
		await expect(outagePage).toHaveURL(/#\/system\/pos$/);
		const foreignPosition = database.prepare('SELECT * FROM SysPos WHERE Id = ?').get(1300000990901);
		assert.ok(foreignPosition, 'The cross-tenant fixture must exist.');
		const tenantList = await outageContext.request.get(new URL('/api/sysPos/list?tenantId=1300000990001', apiUrl).href, { headers: tenantHeaders });
		const tenantListBody = await tenantList.json();
		assert.equal(tenantListBody.code, 200);
		assert.ok(!tenantListBody.result.some((position) => String(position.id) === String(foreignPosition.Id)));
		for (const operation of ['update', 'delete']) {
			const crossTenantResponse = await outageContext.request.post(new URL(`/api/sysPos/${operation}`, apiUrl).href, {
				headers: tenantHeaders,
				data: { id: foreignPosition.Id, name: 'cross-tenant-change', code: foreignPosition.Code, tenantId: foreignPosition.TenantId },
			});
			assert.notEqual((await crossTenantResponse.json()).code, 200, `Cross-tenant ${operation} must be rejected.`);
			assert.deepEqual(database.prepare('SELECT * FROM SysPos WHERE Id = ?').get(foreignPosition.Id), foreignPosition);
		}
		const forgedCode = `baseline-forged-tenant-${Date.now()}`;
		const forgedResponse = await outageContext.request.post(new URL('/api/sysPos/add', apiUrl).href, {
			headers: tenantHeaders,
			data: { name: forgedCode, code: forgedCode, tenantId: foreignPosition.TenantId, status: 1 },
		});
		const forgedResult = await forgedResponse.json();
		const forgedRow = database.prepare('SELECT * FROM SysPos WHERE Code = ?').get(forgedCode);
		assert.ok(!forgedRow || String(forgedRow.TenantId) === '1300000000001', 'A tenant administrator must never write a position into another tenant.');
		if (forgedResult.code === 200) {
			assert.ok(forgedRow);
			const forgedUpdate = await outageContext.request.post(new URL('/api/sysPos/update', apiUrl).href, {
				headers: tenantHeaders,
				data: { id: forgedRow.Id, name: `${forgedCode}-edited`, code: forgedCode, tenantId: foreignPosition.TenantId },
			});
			assert.equal((await forgedUpdate.json()).code, 200);
			const updatedRow = database.prepare('SELECT * FROM SysPos WHERE Id = ?').get(forgedRow.Id);
			assert.equal(String(updatedRow.TenantId), '1300000000001', 'Updating an owned position must not move it into another tenant.');
			assert.equal(updatedRow.Name, `${forgedCode}-edited`);
			const cleanup = await outageContext.request.post(new URL('/api/sysPos/delete', apiUrl).href, { headers: tenantHeaders, data: { id: forgedRow.Id } });
			assert.equal((await cleanup.json()).code, 200);
			assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Id = ?').get(forgedRow.Id).count, 0);
		}
		report.scenarios.push({ account: 'Admin.NET', crossTenantListHidden: true, crossTenantUpdateDenied: true, crossTenantDeleteDenied: true, tenantSpoofingPrevented: true });
		report.pending = report.pending.filter((item) => item !== 'tenant-isolation');
		console.log('tenant administrator: cross-tenant list, mutation and tenant spoofing checks passed.');
		await outagePage.getByRole('button', { name: '新增职位', exact: true }).click();
		const outageDialog = outagePage.getByRole('dialog');
		const outageCode = `baseline-outage-${Date.now()}`;
		await outageDialog.getByLabel('职位名称', { exact: true }).fill(outageCode);
		await outageDialog.getByLabel('职位编码', { exact: true }).fill(outageCode);
		mobileOutageContext = await browser.newContext({
			viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
			storageState: await outageContext.storageState(),
		});
		const mobileOutagePage = await mobileOutageContext.newPage();
		await mobileOutagePage.goto(`${baseUrl}/#/system/pos`);
		await mobileOutagePage.getByRole('button', { name: '新增职位', exact: true }).click();
		const mobileOutageDialog = mobileOutagePage.getByRole('dialog');
		await mobileOutageDialog.getByLabel('职位名称', { exact: true }).fill(`${outageCode}-mobile`);
		await mobileOutageDialog.getByLabel('职位编码', { exact: true }).fill(`${outageCode}-mobile`);
		execFileSync('pwsh', [
			'-NoProfile', '-File', join(repositoryRoot, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'),
			'-RuntimeRoot', runtimeRoot,
		], { windowsHide: true, timeout: 30_000, stdio: 'pipe' });
		const outageResponse = outagePage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPos/add'));
		await outageDialog.getByRole('button', { name: /^确\s*定$/ }).click();
		assert.equal((await outageResponse).status(), 502, 'The proxy must expose the actual stopped backend as unavailable.');
		await expect(outagePage.getByText('请求失败（502）', { exact: true })).toBeVisible();
		await expect(outageDialog).toBeVisible();
		await expect(outageDialog.getByLabel('职位名称', { exact: true })).toHaveValue(outageCode);
		await expect(outageDialog.getByLabel('职位编码', { exact: true })).toHaveValue(outageCode);
		await expect(outageDialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
		await expect(outagePage.getByText('保存成功', { exact: true })).toHaveCount(0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(outageCode).count, 0);
		await outagePage.screenshot({ path: join(outputRoot, 'desktop-service-outage.png'), fullPage: true });
		report.scenarios.push({ device: 'desktop', backendStopped: true, failedSaveDraftPreserved: true, noFalseSuccess: true, noDatabaseMutation: true });
		const mobileOutageResponse = mobileOutagePage.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPos/add'));
		await mobileOutageDialog.getByRole('button', { name: /^确\s*定$/ }).tap();
		assert.equal((await mobileOutageResponse).status(), 502);
		await expect(mobileOutagePage.getByText('请求失败（502）', { exact: true })).toBeVisible();
		await expect(mobileOutageDialog).toBeVisible();
		await expect(mobileOutageDialog.getByLabel('职位名称', { exact: true })).toHaveValue(`${outageCode}-mobile`);
		await expect(mobileOutageDialog.getByLabel('职位编码', { exact: true })).toHaveValue(`${outageCode}-mobile`);
		await expect(mobileOutageDialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
		await expect(mobileOutagePage.getByText('保存成功', { exact: true })).toHaveCount(0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code = ?').get(`${outageCode}-mobile`).count, 0);
		await mobileOutagePage.screenshot({ path: join(outputRoot, 'mobile-service-outage.png'), fullPage: true });
		report.scenarios.push({ device: 'mobile', backendStopped: true, failedSaveDraftPreserved: true, noFalseSuccess: true, noDatabaseMutation: true });
		report.pending = report.pending.filter((item) => item !== 'service-failure');
		console.log('desktop/mobile: stopped backend, visible save failure, preserved drafts and unchanged database passed.');
	} finally {
		await mobileOutageContext?.close();
		await outageContext.close();
	}
	report.baselinePassed = true;
} finally {
	writeFileSync(join(outputRoot, 'position-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	database.close();
	await browser.close();
	for (const upstream of upstreamRequests) upstream.destroy();
	await new Promise((resolveClosed) => {
		server.close(resolveClosed);
		server.closeAllConnections();
	});
}
