import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
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
const prefix = 'stress_' + randomBytes(5).toString('hex');
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql-controlled-stress', steps: [], cleanupErrors: [] };
const secrets = [];
const received = [];
let runtime, marker, pg, evidence, base, admin, tenantId, browser, page, proxy, targetUri, stopped = false, stage = 'start';
let active = 0, peak = 0, redirectEscapes = 0;
const receiver = createServer(async (request, response) => {
  const started = performance.now(); active += 1; peak = Math.max(peak, active);
  response.once('close', () => { active -= 1; });
  const url = new URL(request.url, 'http://127.0.0.1');
  if (!url.pathname.startsWith('/probe/')) { redirectEscapes += 1; response.writeHead(200); response.end('escaped'); return; }
  const chunks = []; for await (const chunk of request) chunks.push(chunk);
  const body = Buffer.concat(chunks).toString('utf8');
  const item = { ordinal: received.length + 1, method: request.method, path: url.pathname, query: [...url.searchParams], header: request.headers['x-probe'], body, started, ended: undefined, status: 0 };
  received.push(item);
  if (url.pathname.includes('/redirect')) { item.status = 302; item.ended = performance.now(); response.writeHead(302, { Location: '/outside' }); response.end(); return; }
  const delay = url.pathname.includes('/timeout') ? 2600 : url.pathname.includes('/slow') ? 350 : 25;
  await new Promise(resolve => setTimeout(resolve, delay));
  item.status = url.pathname.includes('/fail') || (url.pathname.includes('/mixed') && item.ordinal % 3 === 0) ? 503 : 200;
  item.ended = performance.now(); if (!response.destroyed) { response.writeHead(item.status, { 'Content-Type': 'text/plain' }); response.end('isolated-receiver'); }
});
function clean(value) { let text = String(value); for (const secret of secrets) text = text.replaceAll(secret, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { if (evidence) writeFileSync(join(evidence, 'stress-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8'); }
function record(name, details) { report.steps.push({ name, ...details }); persist(); console.log('PASS ' + name); }
async function api(session, path, input, method = 'POST', refused = false) {
  const response = await fetch(new URL('/api/' + path, base), { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.accessToken } : {}) }, body: method === 'POST' ? JSON.stringify(input ?? {}) : undefined, signal: AbortSignal.timeout(30000) });
  if (refused && [401, 403].includes(response.status)) return;
  const result = JSON.parse(await response.text()); if (refused) { assert.notEqual(result.code, 200); return; }
  assert.ok(response.ok, path + ' HTTP ' + response.status); assert.equal(result.code, 200, clean(result.message ?? path)); return result.result;
}
async function login(account) { const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]; const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim(); secrets.push(password); const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secrets.push(session.accessToken, session.refreshToken); return session; }
async function sql(statement) { const { stdout } = await execute('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { windowsHide: true, timeout: 30000 }); return stdout.trim(); }
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
function input(path = 'mixed/{key}', method = 'POST') { return { requestUri: targetUri + path, requestMethod: method, numberOfRequests: 4, numberOfRounds: 3, maxDegreeOfParallelism: 2, headers: { 'X-Probe': prefix }, requestParameters: [{ key: 'label', value: '隔离 表单&=' }, { key: 'label', value: '重复值' }], pathParameters: { key: '轮次 测试' }, queryParameters: { q: 'Query 空格&=', existing: 'override' } }; }
function verifyCounts(result, messages) { assert.equal(result.totalRequests, messages.length); assert.equal(result.successfulRequests, messages.filter(item => item.status >= 200 && item.status < 300).length); assert.equal(result.failedRequests, messages.filter(item => item.status < 200 || item.status >= 300).length); assert.equal(result.totalRequests, result.successfulRequests + result.failedRequests); for (const [key, value] of Object.entries(result)) assert.ok(typeof value === 'number' && Number.isFinite(value) && value >= 0, key); assert.ok(result.maxResponseTime >= result.averageResponseTime); assert.ok(result.averageResponseTime >= result.minResponseTime); const percentiles = [10, 25, 50, 75, 90, 99, 999].map(value => result[`percentile${value}ResponseTime`]); for (let index = 1; index < percentiles.length; index++) assert.ok(percentiles[index] >= percentiles[index - 1]); assert.ok(Math.abs(result.queriesPerSecond - result.totalRequests / result.totalTimeInSeconds) < 0.001); if (!result.successfulRequests) for (const key of Object.keys(result).filter(key => /ResponseTime$/.test(key))) assert.equal(result[key], 0, 'no successful samples: ' + key); }
async function shot(name) { await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 }); await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0); await page.locator('.stress-page').evaluate(element => { for (let current = element; current; current = current.parentElement) if (current.scrollHeight > current.clientHeight) current.scrollTop = 0; }); await page.screenshot({ path: join(evidence, name), fullPage: true }); await page.getByLabel('执行结果', { exact: true }).screenshot({ path: join(evidence, name.replace(/\.png$/, '-results.png')) }); }
async function theme(mode) { const html = page.locator('html'); const toggle = page.locator('button.theme-toggle'); if ((await html.getAttribute('class') ?? '').split(/\s+/).includes('dark') !== (mode === 'dark')) await toggle.click(); await expect.poll(async () => (await html.getAttribute('class') ?? '').split(/\s+/).includes('dark')).toBe(mode === 'dark'); await page.mouse.move(400, 100); }
async function runBrowser() {
  proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(20000);
  await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fplatform%2FstressTest');
  const panel = page.locator('.stress-page'); await expect(panel).toBeVisible(); await expect(panel).toContainText('隔离压测接收端');
  const uri = panel.getByRole('textbox', { name: '请求地址', exact: true });
  await uri.fill(targetUri + 'mixed/{key}?existing=original');
  await panel.getByLabel('每轮请求量', { exact: true }).fill('4'); await panel.getByLabel('压测轮数', { exact: true }).fill('3'); await panel.getByLabel('最大并行量', { exact: true }).fill('2');
  await panel.getByRole('combobox', { name: '请求方式', exact: true }).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^POST$/ }).click();
  for (const [group, pairs] of [['Headers', [['X-Probe', prefix]]], ['Body', [['label', '隔离 表单&='], ['label', '重复值']]], ['Path', [['key', '轮次 测试']]], ['Query', [['q', 'Query 空格&='], ['existing', 'override']]]]) {
    await panel.getByRole('tab', { name: group, exact: true }).click();
    for (const [index, [key, value]] of pairs.entries()) {
      await panel.getByRole('button', { name: `添加 ${group} 参数`, exact: true }).click();
      await panel.getByRole('textbox', { name: `${group} 参数名 ${index + 1}`, exact: true }).fill(key);
      await panel.getByRole('textbox', { name: `${group} 参数值 ${index + 1}`, exact: true }).fill(value);
    }
  }
  const start = panel.getByRole('button', { name: '开始压测', exact: true });
  const offset = received.length; const resultPromise = page.waitForResponse(response => response.url().includes('/sysCommon/stressTest') && response.request().method() === 'POST'); await start.click(); const response = await resultPromise; assert.ok(response.ok()); const envelope = await response.json(); assert.equal(envelope.code, 200); verifyCounts(envelope.result, received.slice(offset)); await expect(panel).toContainText('12'); await theme('light'); await shot('29-stress-light.png'); await theme('dark'); await shot('29-stress-dark.png'); record('production-browser-request-parameters-real-result-and-themes', { total: envelope.result.totalRequests, successful: envelope.result.successfulRequests, failed: envelope.result.failedRequests });
  await uri.fill('http://127.0.0.1:1/probe/'); const beforeUnauthorized = received.length; await start.click(); await expect(panel).toContainText(/授权|允许/); assert.equal(received.length, beforeUnauthorized); record('production-validation-unauthorized-target-sends-nothing');
  await uri.fill(targetUri + 'slow'); await panel.getByLabel('每轮请求量', { exact: true }).fill('20'); await panel.getByLabel('压测轮数', { exact: true }).fill('2'); const beforeCancel = received.length; await start.click(); await expect.poll(() => received.length).toBeGreaterThan(beforeCancel); await panel.getByRole('button', { name: '取消压测', exact: true }).click(); await expect(start).toBeEnabled(); await expect(panel).toContainText(/已取消|取消执行/); await page.waitForTimeout(500); const canceled = received.length; await page.waitForTimeout(500); assert.equal(received.length, canceled); assert.ok(canceled - beforeCancel < 40); record('production-cancel-stops-dispatch-and-no-false-completion', { dispatched: canceled - beforeCancel });
  await start.click(); await expect.poll(() => received.length).toBeGreaterThan(canceled); await page.goto(proxy.baseUrl + '/#/dashboard/home'); await expect(page.getByRole('heading', { name: '工作台', exact: true })).toBeVisible(); await page.waitForTimeout(500); const departed = received.length; await page.waitForTimeout(500); assert.equal(received.length, departed); await page.goto(proxy.baseUrl + '/#/platform/stressTest'); await expect(panel).toBeVisible(); await expect(panel.getByLabel('执行结果', { exact: true })).toContainText('尚未执行压测'); record('production-deactivation-aborts-and-clears-prior-result');
  await uri.fill(targetUri + 'ok'); await panel.getByLabel('每轮请求量', { exact: true }).fill('4'); await panel.getByLabel('压测轮数', { exact: true }).fill('1'); await stop(); await start.click(); await expect(panel).toContainText(/执行失败|连接|请求失败|网络/); await expect(uri).toHaveValue(targetUri + 'ok'); await expect(start).toBeEnabled(); await shot('29-stress-stopped-api.png'); record('real-stopped-api-error-preserves-editable-request-draft');
}
try {
  await new Promise((resolve, reject) => { receiver.once('error', reject); receiver.listen(0, '127.0.0.1', resolve); }); targetUri = 'http://127.0.0.1:' + receiver.address().port + '/probe/';
  const port = Number(process.argv[2] ?? 5029); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-StressTestService', targetUri], { windowsHide: true, timeout: 180000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true })).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); admin = await login('superAdmin.NET'); stage = 'service';
  const config = JSON.parse(readFileSync(join(runtime, 'appsettings.json'), 'utf8').replace(/^\uFEFF/, '')); assert.ok(config.DbConnection.ConnectionConfigs.every(item => item.DbType === 'PostgreSQL')); const runtimeInfo = await api(admin, 'sysServer/runtimeInfo', undefined, 'GET'); assert.equal(runtimeInfo.runtimeInfo.databaseType, 'PostgreSQL'); assert.equal(runtimeInfo.runtimeInfo.processId, marker.processId); record('isolated-real-postgresql-process-and-authorized-local-target');
  const targets = await api(admin, 'sysCommon/stressTestTargets', undefined, 'GET'); assert.deepEqual(targets.targets, [{ name: '隔离压测接收端', requestUri: targetUri }]); assert.equal(targets.maxTotalRequests, 60); assert.equal(targets.maxConcurrency, 4);
  const ordinary = await login('TestUser3'); const beforeRefused = received.length; for (const session of [undefined, ordinary]) { await api(session, 'sysCommon/stressTestTargets', undefined, 'GET', true); await api(session, 'sysCommon/stressTest', input(), 'POST', true); }
  await api(admin, 'sysTenant/add', { name: prefix, adminAccount: prefix, tenantType: 0, status: 1, enableReg: 2 }); tenantId = Number(await sql("SELECT t.id FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account='" + prefix + "'")); assert.ok(tenantId); const menuId = Number(await sql("SELECT id FROM sysmenu WHERE permission='sysCommon:stressTest'")); assert.ok(menuId); await api(admin, 'sysTenant/grantMenu', { id: tenantId, menuIdList: [menuId] }); const tenant = await api(admin, 'sysTenant/goTenant', { id: tenantId }); secrets.push(tenant.accessToken, tenant.refreshToken); const tenantInfo = await api(tenant, 'sysAuth/userInfo', undefined, 'GET'); assert.notEqual(tenantInfo.accountType, 999); assert.ok(tenantInfo.buttons.includes('sysCommon:stressTest'), 'permission granted before testing superadmin boundary'); await api(tenant, 'sysCommon/stressTestTargets', undefined, 'GET', true); await api(tenant, 'sysCommon/stressTest', input(), 'POST', true); assert.equal(received.length, beforeRefused); await api(admin, 'sysTenant/delete', { id: tenantId }); tenantId = undefined; record('anonymous-ordinary-and-explicitly-granted-non-superadmin-refused-without-dispatch');
  for (const patch of [{ requestUri: 'http://127.0.0.1:1/probe/' }, { requestUri: targetUri + '../outside' }, { requestUri: targetUri + 'ok#fragment' }, { numberOfRequests: 0 }, { numberOfRounds: null }, { numberOfRounds: 4, numberOfRequests: 20 }, { maxDegreeOfParallelism: 5 }, { requestMethod: 'TRACE' }, { headers: { Host: 'other-host' } }]) await api(admin, 'sysCommon/stressTest', { ...input(), ...patch }, 'POST', true); assert.equal(received.length, beforeRefused); record('server-target-path-method-budget-header-validation-before-network');
  for (const method of ['GET', 'POST', 'PUT', 'DELETE']) { const offset = received.length; peak = 0; const result = await api(admin, 'sysCommon/stressTest', input('mixed/{key}?existing=original', method)); const batch = received.slice(offset); verifyCounts(result, batch); assert.equal(batch.length, 12); assert.ok(peak <= 2 && peak > 1); for (const item of batch) { assert.equal(item.method, method); assert.equal(decodeURIComponent(item.path), '/probe/mixed/轮次 测试'); assert.equal(item.header, prefix); const query = new URLSearchParams(item.query); assert.equal(query.get('q'), 'Query 空格&='); assert.equal(query.get('existing'), 'override'); if (method === 'GET') assert.equal(item.body, ''); else assert.deepEqual([...new URLSearchParams(item.body)], [['label', '隔离 表单&='], ['label', '重复值']]); } for (let round = 1; round < 3; round++) assert.ok(batch[round * 4].started >= Math.max(...batch.slice((round - 1) * 4, round * 4).map(item => item.ended))); report[method] = { total: result.totalRequests, successful: result.successfulRequests, failed: result.failedRequests, peak }; }
  record('four-methods-headers-form-path-query-sequential-rounds-bounded-concurrency-and-consistent-statistics');
  const failOffset = received.length; const failed = await api(admin, 'sysCommon/stressTest', { ...input('fail'), numberOfRequests: 3, numberOfRounds: 1 }); verifyCounts(failed, received.slice(failOffset)); assert.equal(failed.successfulRequests, 0); assert.equal(failed.failedRequests, 3);
  const redirectOffset = received.length; const redirect = await api(admin, 'sysCommon/stressTest', { ...input('redirect'), numberOfRequests: 2, numberOfRounds: 1 }); verifyCounts(redirect, received.slice(redirectOffset)); assert.equal(redirectEscapes, 0); assert.equal(redirect.failedRequests, 2); record('all-failure-is-reported-and-redirect-cannot-escape-authorized-prefix');
  const timeoutOffset = received.length; const timedOut = await api(admin, 'sysCommon/stressTest', { ...input('timeout'), numberOfRequests: 2, numberOfRounds: 1 }); verifyCounts(timedOut, received.slice(timeoutOffset)); assert.equal(timedOut.failedRequests, 2); record('real-request-timeout-counted-as-failure-with-no-successful-response-samples');
  stage = 'production-browser'; await runBrowser(); report.passed = true; persist();
} catch (error) {
  report.failure = { stage, error: clean(error.stack ?? error) }; persist(); console.error(clean(stage + ': ' + error.message));
  if (page && evidence) { const sample = await page.locator('.stress-page').evaluate(element => ({ text: element.innerText.slice(0, 3000), fields: [...element.querySelectorAll('input,textarea,button')].map(node => ({ tag: node.tagName, role: node.getAttribute('role'), label: node.getAttribute('aria-label'), placeholder: node.getAttribute('placeholder'), text: node.tagName === 'BUTTON' ? node.innerText : undefined })) })).catch(() => undefined); if (sample) writeFileSync(join(evidence, '29-failure-dom.json'), clean(JSON.stringify(sample, null, 2)), 'utf8'); await page.screenshot({ path: join(evidence, '29-failure.png'), fullPage: true }).catch(() => {}); }
} finally {
  if (tenantId && !stopped) await api(admin, 'sysTenant/delete', { id: tenantId }).catch(error => report.cleanupErrors.push(clean(error.message)));
  for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime ? stop() : undefined], ['receiver', async () => { receiver.closeAllConnections(); await new Promise((resolve, reject) => receiver.close(error => error ? reject(error) : resolve())); }]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(name + ': ' + error.message)); } }
  if (pg) try { assert.equal((await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true })).stdout.trim(), runtime); await execute('docker', ['rm', '--force', '--volumes', pg.containerName], { windowsHide: true }); await assert.rejects(() => execute('docker', ['inspect', pg.containerName], { windowsHide: true })); report.containerRemoved = true; } catch (error) { report.cleanupErrors.push(clean(error.message)); }
  if (base) { try { await fetch(new URL('/api/sysConfig/sysInfo', base), { signal: AbortSignal.timeout(2000) }); report.cleanupErrors.push('isolated API remains reachable'); } catch { report.apiStopped = true; } }
  report.receiverClosed = !receiver.listening; report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.receiverClosed; persist(); if (evidence) console.log('Report: ' + join(evidence, 'stress-browser-baseline.json'));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
