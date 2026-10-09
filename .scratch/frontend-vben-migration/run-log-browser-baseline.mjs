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
const prefix = `acceptance_${randomBytes(5).toString('hex')}`;
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql-logs', steps: [], cleanupErrors: [] };
let runtime, pg, evidence, base, admin, page, browser, proxy, configId, tenantId, stopped = false, stage = 'initialize';
const secrets = [];
function clean(value) { let text = String(value); for (const secret of secrets) text = text.replaceAll(secret, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function record(name) { report.steps.push({ name }); console.log(`PASS ${name}`); }
async function api(session, action, input, method = 'POST', refused = false) {
	const response = await fetch(new URL(`/api/${action}`, base), { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) }, body: method === 'POST' ? JSON.stringify(input ?? {}) : undefined, signal: AbortSignal.timeout(30000) });
	if (refused && [401, 403].includes(response.status)) return;
	const body = await response.text(); assert.ok(body, `${action} empty HTTP ${response.status}`); const result = JSON.parse(body);
	if (refused) { assert.notEqual(result.code, 200); return result; }
	assert.equal(result.code, 200, clean(result.message ?? action)); return result.result;
}
async function sql(statement) { const { stdout } = await execute('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { windowsHide: true, timeout: 30000 }); return stdout.trim(); }
async function count(table) { return Number(await sql(`SELECT count(*) FROM \"${table.toLowerCase()}\"`)); }
async function waitCount(table, expected = 1) { await expect.poll(() => count(table), { timeout: 30000 }).toBeGreaterThanOrEqual(expected); }
async function login(account) { const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]; const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim(); secrets.push(password); const value = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secrets.push(value.accessToken, value.refreshToken); return value; }
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
async function shot(name) { await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 }); await page.screenshot({ path: join(evidence, name), fullPage: true }); }
async function theme(mode) { if ((await page.locator('html').getAttribute('class') ?? '').includes('dark') !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click(); if (mode === 'dark') await expect(page.locator('html')).toHaveClass(/dark/); else await expect(page.locator('html')).not.toHaveClass(/dark/); }
async function waitModalSettled(dialog) { await expect.poll(async () => page.evaluate(() => [...document.querySelectorAll('.ant-modal')].filter(node => node.getAttribute('role') === 'dialog').every(node => { const style = getComputedStyle(node); return style.opacity === '1' && ['none', 'matrix(1, 0, 0, 1, 0, 0)'].includes(style.transform); }))).toBe(true); await expect(dialog).toBeVisible(); }
try {
	runtime = realpathSync(process.argv[2]); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); base = new URL(marker.baseUrl); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime);
	const { stdout: label } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true }); assert.equal(label.trim(), runtime); evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	admin = await login('superAdmin.NET'); stage = 'service';
	await api(admin, 'sysPos/list', undefined, 'GET'); await waitCount('SysLogOp'); await waitCount('SysLogVis');
	const opRows = await api(admin, 'sysLogOp/page', { page: 1, pageSize: 20, startTime: '2000-01-01T00:00:00', endTime: '2100-01-01T00:00:00', account: 'superAdmin.NET' }); assert.ok(opRows.items.length > 0); const op = opRows.items[0]; const opDetail = await api(admin, `sysLogOp/detail/${op.id}`, undefined, 'GET'); assert.equal(opDetail.id, op.id);
	const exRefusal = await api(admin, 'sysConfig/delete', { id: 999999999999 }, 'POST', true); assert.ok(exRefusal); await waitCount('SysLogEx');
	await api(admin, 'sysConfig/add', { name: prefix, code: `${prefix}_code`, value: 'before', sysFlag: 2, groupCode: 'default' });
	const cfgId = configId = (await api(admin, 'sysConfig/page', { page: 1, pageSize: 20, code: `${prefix}_code` })).items.find((item) => item.code === `${prefix}_code`).id;
	await api(admin, 'sysConfig/update', { id: cfgId, name: prefix, code: `${prefix}_code`, value: 'after', sysFlag: 2, groupCode: 'default' }); await waitCount('SysLogDiff');
	const diffRows = await api(admin, 'sysLogDiff/page', { page: 1, pageSize: 20, startTime: '2000-01-01T00:00:00', endTime: '2100-01-01T00:00:00' }); assert.ok(diffRows.items.some((item) => String(item.businessData ?? '').toLowerCase().includes('sysconfig')));
	const diffDetail = await api(admin, `sysLogDiff/detail/${diffRows.items[0].id}`, undefined, 'GET'); assert.ok(String(diffDetail.diffData).includes('before')); assert.ok(String(diffDetail.diffData).includes('after')); assert.equal(diffDetail.sql, null); assert.equal(diffDetail.parameters, null);
	const exRows = await api(admin, 'sysLogEx/page', { page: 1, pageSize: 10 }); assert.ok(exRows.items.length); const exDetail = await api(admin, `sysLogEx/detail/${exRows.items[0].id}`, undefined, 'GET'); assert.ok(exDetail.exception);
	const visRows = await api(admin, 'sysLogVis/page', { page: 1, pageSize: 10 }); assert.ok(visRows.items.some(item => item.actionName.toLowerCase().includes('login')));
	for (const kind of ['Op', 'Ex', 'Vis', 'Diff']) { const empty = await api(admin, `sysLog${kind}/page`, { page: 1, pageSize: 10, startTime: '2100-01-01', endTime: '2101-01-01' }); assert.equal(empty.total, 0); }
	await api(admin, 'sysLogOp/page', { page: 1, pageSize: 20, startTime: '2101-01-01T00:00:00', endTime: '2100-01-01T00:00:00' }, 'POST', true);
	const exported = await fetch(new URL('/api/sysLogOp/export', base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${admin.accessToken}` }, body: JSON.stringify({ startTime: '2000-01-01T00:00:00', endTime: '2100-01-01T00:00:00' }) });
	assert.equal(exported.status, 200); const workbook = Buffer.from(await exported.arrayBuffer()); assert.equal(workbook.subarray(0, 2).toString(), 'PK'); writeFileSync(join(evidence, 'operation-logs.xlsx'), workbook);
	record('real-log-persistence-pagination-details-diff-and-export');
	const ordinary = await login('TestUser3'); for (const path of ['sysLogVis/page', 'sysLogOp/page', 'sysLogEx/page', 'sysLogDiff/page']) await api(ordinary, path, { page: 1, pageSize: 20 }, 'POST', true); for (const path of ['sysLogOp/detail/1', 'sysLogEx/detail/1', 'sysLogDiff/detail/1']) await api(ordinary, path, undefined, 'GET', true); record('tenant-and-permission-boundaries');
	for (const kind of ['Op', 'Ex', 'Vis', 'Diff']) await api(undefined, `sysLog${kind}/page`, { page: 1, pageSize: 10 }, 'POST', true);
	await api(admin, 'sysTenant/add', { name: prefix, adminAccount: prefix, tenantType: 0, status: 1, enableReg: 2, orderNo: 100 });
	tenantId = Number(await sql(`SELECT t.id FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account = '${prefix}'`)); assert.ok(tenantId);
	const menuIds = (await sql("SELECT id FROM sysmenu WHERE permission IN ('sysVislog:page','sysOplog:page','sysExlog:page','sysDifflog:page','sysOplog:export','sysExlog:export','sysVislog:clear','sysOplog:clear','sysExlog:clear')")).split(/\r?\n/).map(Number); assert.equal(menuIds.length, 9);
	await api(admin, 'sysTenant/grantMenu', { id: tenantId, menuIdList: menuIds }); const tenant = await api(admin, 'sysTenant/goTenant', { id: tenantId }); secrets.push(tenant.accessToken, tenant.refreshToken);
	const tenantUser = await api(tenant, 'sysAuth/userInfo', undefined, 'GET'); assert.ok(tenantUser.buttons.includes('sysOplog:page')); assert.equal(tenantUser.currentTenantId, tenantId);
	for (const [kind, foreign] of [['Op', op.id], ['Ex', exDetail.id], ['Diff', diffDetail.id]]) { const result = await api(tenant, `sysLog${kind}/detail/${foreign}`, undefined, 'GET'); assert.equal(result, null); }
	for (const kind of ['Op', 'Ex', 'Vis', 'Diff']) { const result = await api(tenant, `sysLog${kind}/page`, { page: 1, pageSize: 100, tenantId: 1300000000001 }); assert.ok(result.items.every(item => item.tenantId === tenantId)); }
	for (const kind of ['Op', 'Ex', 'Vis']) await api(tenant, `sysLog${kind}/clear`, {}, 'POST', true); record('granted-tenant-cannot-read-or-clear-foreign-logs');
	await api(admin, 'sysTenant/delete', { id: tenantId }); tenantId = undefined;
	if (!process.argv.includes('--service-only')) {
		stage = 'production-browser'; proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1100 } }); page.setDefaultTimeout(20000);
		await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(admin.accessToken)}&redirect=%2Flog%2Foplog`); await expect(page.locator('.log-page')).toBeVisible(); await expect(page.getByRole('heading', { name: '操作日志', exact: true })).toBeVisible(); await expect(page.locator('.ant-table-row')).not.toHaveCount(0); await theme('light'); await shot('27-oplog-light.png');
		await page.getByRole('button', { name: '详情', exact: true }).first().click(); const operationDialog = page.getByRole('dialog', { name: '操作日志详情', exact: true }); await expect(operationDialog).toContainText('requestUrl'); await operationDialog.getByRole('button', { name: '关闭', exact: true }).click();
		await page.goto(`${proxy.baseUrl}/#/log/difflog`); await expect(page.getByRole('heading', { name: '数据差异日志', exact: true })).toBeVisible(); await expect(page.locator('.ant-table-row')).not.toHaveCount(0);
		await theme('dark');
		await page.getByRole('button', { name: '详情', exact: true }).first().click(); const difference = page.getByRole('dialog', { name: '数据差异日志详情', exact: true }); await expect(difference).toContainText('before'); await expect(difference).toContainText('after'); await waitModalSettled(difference); await shot('27-diff-detail-dark.png'); await difference.getByRole('button', { name: '关闭', exact: true }).click(); await expect(difference).not.toBeVisible(); await shot('27-difflog-dark.png');
		await page.goto(`${proxy.baseUrl}/#/log/exlog`); await expect(page.getByRole('heading', { name: '异常日志', exact: true })).toBeVisible(); await expect(page.locator('.ant-table-row')).not.toHaveCount(0); await page.getByRole('button', { name: '详情', exact: true }).first().click(); const exceptionDialog = page.getByRole('dialog', { name: '异常日志详情', exact: true }); await expect(exceptionDialog).toContainText('exception'); await exceptionDialog.getByRole('button', { name: '关闭', exact: true }).click();
		await page.goto(`${proxy.baseUrl}/#/log/vislog`); await expect(page.getByRole('heading', { name: '访问日志', exact: true })).toBeVisible(); await expect(page.locator('.ant-table-row')).not.toHaveCount(0); record('production-desktop-all-log-lists-details-and-themes');
		for (const notice of await page.locator('.ant-notification-notice').all()) await notice.getByRole('button', { name: '关闭', exact: true }).click();
		await expect(page.locator('.ant-notification-notice')).toHaveCount(0, { timeout: 20000 });
		const activeLogPage = page.locator('.log-page').filter({ has: page.getByRole('heading', { name: '访问日志', exact: true }) }); await expect(activeLogPage).toHaveCount(1); const clearButton = activeLogPage.getByRole('button', { name: '清空', exact: true }); await clearButton.click(); const clearDialog = page.getByRole('dialog', { name: '确认清空日志', exact: true }); await expect(clearDialog).toBeVisible(); const beforeClear = await count('SysLogVis'); await clearDialog.locator('.ant-modal-footer button').nth(0).click(); assert.equal(await count('SysLogVis'), beforeClear); await clearButton.click(); await clearDialog.locator('.ant-modal-footer button').nth(1).click(); await expect(clearDialog).not.toBeVisible(); await expect.poll(() => count('SysLogVis')).toBe(0); record('clear-confirmation-cancel-and-persistence');
		await api(admin, 'sysConfig/delete', { id: configId }); configId = undefined;
		await stop(); await activeLogPage.getByRole('button', { name: '刷新日志', exact: true }).click(); await expect(activeLogPage.locator('.ant-alert')).toHaveCount(1); record('real-stopped-api-feedback');
	}
	report.passed = true;
} catch (error) { report.failure = { stage, error: clean(error.stack ?? error) }; console.error(clean(`${stage}: ${error.message}`)); if (page && evidence) await page.screenshot({ path: join(evidence, '27-failure.png'), fullPage: true }).catch(() => {}); }
finally {
	if (configId && !stopped) await api(admin, 'sysConfig/delete', { id: configId }).catch(error => report.cleanupErrors.push(clean(error.message)));
	if (tenantId && !stopped) await api(admin, 'sysTenant/delete', { id: tenantId }).catch(error => report.cleanupErrors.push(clean(error.message)));
	for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(`${name}: ${error.message}`)); } }
	if (pg) try { const { stdout: runtimeLabel } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true }); assert.equal(runtimeLabel.trim(), runtime); await execute('docker', ['rm', '--force', '--volumes', pg.containerName], { windowsHide: true }); report.containerRemoved = true; } catch (error) { report.cleanupErrors.push(clean(error.message)); }
	report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true; if (evidence) { const path = join(evidence, 'log-browser-baseline.json'); writeFileSync(path, JSON.stringify(report, null, 2), 'utf8'); console.log(`Report: ${path}`); }
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
