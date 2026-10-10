import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const prefix = 'monitor_' + randomBytes(5).toString('hex');
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql-monitor', steps: [], cleanupErrors: [] };
const secrets = [];
let runtime, marker, pg, evidence, base, admin, tenantId, page, browser, proxy, stage = 'initialize', stopped = false;
function clean(value) { let text = String(value); for (const secret of secrets) text = text.replaceAll(secret, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function record(name) { report.steps.push({ name }); console.log('PASS ' + name); }
async function api(session, path, input, method = 'POST', refused = false) {
	const response = await fetch(new URL('/api/' + path, base), { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.accessToken } : {}) }, body: method === 'POST' ? JSON.stringify(input ?? {}) : undefined, signal: AbortSignal.timeout(30000) });
	if (refused && [401, 403].includes(response.status)) return;
	const body = await response.text(); assert.ok(body, path + ' empty HTTP ' + response.status); const result = JSON.parse(body);
	if (refused) { assert.notEqual(result.code, 200); return; }
	assert.equal(result.code, 200, clean(result.message ?? path)); return result.result;
}
async function sql(statement) { const { stdout } = await execute('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { windowsHide: true, timeout: 30000 }); return stdout.trim(); }
async function login(account) { const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]; const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim(); secrets.push(password); const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secrets.push(session.accessToken, session.refreshToken); return session; }
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
async function shot(name) { await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 }); await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0); await page.screenshot({ path: join(evidence, name), fullPage: true }); }
async function theme(mode) {
	const root = page.locator('html'); const toggle = page.locator('button.theme-toggle'); await expect(toggle).toHaveCount(1);
	if ((await root.getAttribute('class') ?? '').split(/\s+/).includes('dark') !== (mode === 'dark')) await toggle.click();
	await expect.poll(async () => (await root.getAttribute('class') ?? '').split(/\s+/).includes('dark')).toBe(mode === 'dark');
	await expect.poll(() => page.locator('.server-page .ant-card').first().evaluate(element => { const channels = getComputedStyle(element).backgroundColor.match(/\d+/g)?.slice(0, 3).map(Number) ?? []; return channels.length === 3 && channels.reduce((sum, value) => sum + value, 0) / 3 < 128; })).toBe(mode === 'dark');
	await page.mouse.move(400, 100);
	report.themes ??= []; report.themes.push({ mode, background: await page.locator('.server-page .ant-card').first().evaluate(element => getComputedStyle(element).backgroundColor) });
}
try {
	runtime = realpathSync(process.argv[2]); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1');
	assert.equal((await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true })).stdout.trim(), runtime);
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); admin = await login('superAdmin.NET'); stage = 'service';
	const run = await api(admin, 'sysServer/runtimeInfo', undefined, 'GET'); assert.equal(run.runtimeInfo.processId, marker.processId); assert.equal(run.runtimeInfo.databaseType, 'PostgreSQL'); assert.equal(run.runtimeInfo.commandLineArgs.length, 0); assert.ok(run.runtimeInfo.processorCount > 0);
	const hw = await api(admin, 'sysServer/hardwareInfo', undefined, 'GET'); assert.ok(hw.cpuInfo.processorName); assert.equal(typeof hw.cpuInfo.usagePercentage, 'number'); assert.ok(hw.cpuInfo.usagePercentage >= 0 && hw.cpuInfo.usagePercentage <= 100); assert.ok(hw.ramInfo.totalBytes > 0); assert.ok(hw.ramInfo.usedBytes > 0); assert.ok(hw.diskInfos.length > 0); assert.ok(hw.diskInfos.every(disk => disk.freeSpace <= disk.totalSpace && disk.usedSpace >= 0));
	const packages = await api(admin, 'sysServer/nuGetPackageInfo', undefined, 'GET'); assert.ok(packages.length > 0); assert.ok(packages.some(item => item.packageName.includes('Furion'))); assert.ok(packages.every(item => typeof item.packageVersion === 'string' && item.packageVersion.length > 0)); report.packageCount = packages.length; record('real-process-hardware-memory-disk-and-packages');
	const ordinary = await login('TestUser3'); for (const path of ['runtimeInfo', 'hardwareInfo', 'nuGetPackageInfo']) { await api(ordinary, 'sysServer/' + path, undefined, 'GET', true); await api(undefined, 'sysServer/' + path, undefined, 'GET', true); }
	await api(admin, 'sysTenant/add', { name: prefix, adminAccount: prefix, tenantType: 0, status: 1, enableReg: 2 }); tenantId = Number(await sql("SELECT t.id FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account='" + prefix + "'")); assert.ok(tenantId);
	const menuId = Number(await sql("SELECT id FROM sysmenu WHERE permission='sysServer:page'")); assert.ok(menuId); await api(admin, 'sysTenant/grantMenu', { id: tenantId, menuIdList: [menuId] }); const tenant = await api(admin, 'sysTenant/goTenant', { id: tenantId }); secrets.push(tenant.accessToken, tenant.refreshToken); const user = await api(tenant, 'sysAuth/userInfo', undefined, 'GET'); assert.ok(user.buttons.includes('sysServer:page')); assert.equal((await api(tenant, 'sysServer/runtimeInfo', undefined, 'GET')).runtimeInfo.processId, marker.processId); record('anonymous-ordinary-refusal-and-explicit-monitor-grant');
	await api(admin, 'sysTenant/delete', { id: tenantId }); tenantId = undefined;
	stage = 'production-browser'; proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(20000);
	let requests = 0; page.on('request', request => { if (request.url().includes('/sysServer/')) requests += 1; });
	await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fplatform%2Fserver'); const monitor = page.locator('.server-page'); await expect(monitor).toBeVisible(); await expect(monitor).toContainText(String(marker.processId)); await page.reload(); await expect(monitor).toContainText(String(marker.processId)); await expect(monitor).toContainText(hw.cpuInfo.processorName); await expect(monitor.locator('.ant-progress')).toHaveCount(2 + hw.diskInfos.length); await theme('light'); await shot('28-monitor-light.png');
	const initial = requests; await expect.poll(() => requests, { timeout: 25000 }).toBeGreaterThan(initial); record('production-real-readings-and-automatic-refresh');
	await theme('dark'); await shot('28-monitor-dark.png'); await monitor.locator('.package-list').scrollIntoViewIfNeeded(); const dependency = packages.find(item => item.packageName === 'Furion'); assert.ok(dependency); await expect(monitor.locator('.package-list')).toContainText(dependency.packageVersion); await shot('28-monitor-packages-dark.png'); await page.goto(proxy.baseUrl + '/#/dashboard/home'); await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible(); const departed = requests; await page.waitForTimeout(12000); assert.equal(requests, departed); record('leaving-monitor-releases-polling');
	await page.goto(proxy.baseUrl + '/#/platform/server'); await expect(monitor).toContainText(String(marker.processId)); await monitor.getByRole('switch', { name: '自动刷新监控' }).click(); await stop(); await monitor.getByRole('button', { name: '刷新监控', exact: true }).click(); await expect(monitor.locator('.server-error')).toHaveCount(3); await expect(monitor).toContainText(String(marker.processId)); record('real-stopped-api-errors-preserve-previous-readings');
	report.passed = true;
} catch (error) { report.failure = { stage, error: clean(error.stack ?? error) }; console.error(clean(stage + ': ' + error.message)); if (page && evidence) await page.screenshot({ path: join(evidence, '28-failure.png'), fullPage: true }).catch(() => {}); }
finally {
	if (tenantId && !stopped) await api(admin, 'sysTenant/delete', { id: tenantId }).catch(error => report.cleanupErrors.push(clean(error.message)));
	for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(name + ': ' + error.message)); } }
	if (pg) try { assert.equal((await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true })).stdout.trim(), runtime); await execute('docker', ['rm', '--force', '--volumes', pg.containerName], { windowsHide: true }); report.containerRemoved = true; } catch (error) { report.cleanupErrors.push(clean(error.message)); }
	report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true; if (evidence) { const path = join(evidence, 'server-browser-baseline.json'); writeFileSync(path, JSON.stringify(report, null, 2), 'utf8'); console.log('Report: ' + path); }
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
