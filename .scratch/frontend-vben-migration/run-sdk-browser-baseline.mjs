import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
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
const prefix = 'tpl_' + randomBytes(5).toString('hex');
const baselinePrefix = 'baseline_' + randomBytes(5).toString('hex');
const runtimeMarkerPath = join(root, '.scratch/frontend-vben-migration/plugin-startup-runtime-' + randomBytes(16).toString('hex') + '.json');
const secrets = [], fixtures = [], createdIds = new Set(), requestCounts = new Map();
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-api-postgresql-generated-sdk-no-mock', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'sdk-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/plugin-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
function record(name, details = {}) { report.steps.push({ name, ...details }); persist(); console.log('PASS ' + name); }
async function api(session, path, input, method = 'POST', refused = false) {
  const response = await fetch(new URL('/api/' + path, base), { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: 'Bearer ' + session.accessToken } : {}) }, body: method === 'POST' ? JSON.stringify(input ?? {}) : undefined, signal: AbortSignal.timeout(30000) });
  if (refused === 'auth' && [401, 403].includes(response.status)) { const text = await response.text(); if (!text) return; const result = JSON.parse(text); assert.ok([401, 403].includes(result.code)); assert.equal(result.type, 'error'); assert.ok(result.result == null); return; }
  const text = await response.text(); let result; try { result = JSON.parse(text); } catch { throw Error(path + ' returned non-JSON HTTP ' + response.status); }
  if (refused) { assert.ok(response.status < 500, path + ' refused without HTTP 500'); if (refused === 'auth') { assert.ok([401, 403].includes(result.code), path + ' authorization code ' + result.code); assert.equal(result.type, 'error'); assert.ok(result.result == null, path + ' unauthorized result must be empty'); } else { assert.ok(![200, 401, 403].includes(result.code), path + ' must fail business validation rather than authorization'); assert.equal(result.type, 'error'); assert.ok(result.result == null); } return; }
  assert.ok(response.ok, path + ' HTTP ' + response.status); assert.equal(result.code, 200, clean(result.message ?? path)); return result.result;
}
async function login(account) {
  const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1];
  const publicKey = getPublishedPublicKey();
  secret(password); const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secret(session.accessToken); secret(session.refreshToken); return session;
}

function quote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
async function native(program, args, timeout = 30000) {
  const script = "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n& " + quote(program) + ' ' + args.map(quote).join(' ') + "\nif ($LASTEXITCODE -ne 0) { throw 'Native command failed' }";
  return execute('pwsh', ['-NoProfile', '-Command', script], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8 });
}
async function sql(statement) { assert.match(pg.containerName, /^[a-zA-Z0-9_-]+$/); const { stdout } = await native('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement]); return stdout.trim(); }
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
function recoverStartupOwnership() {
  if (!runtime && existsSync(runtimeMarkerPath)) { const handoff = JSON.parse(readFileSync(runtimeMarkerPath, 'utf8').replace(/^\uFEFF/, '')); runtime = realpathSync(handoff.runtimeRoot); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/); base = new URL(handoff.baseUrl); assert.equal(base.hostname, '127.0.0.1'); evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); }
  if (runtime && existsSync(join(runtime, 'isolated-run.json'))) { marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); }
  if (runtime && existsSync(join(runtime, 'isolated-postgres.json'))) { pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(pg.runtimeRoot, runtime); }
}
function getPublishedPublicKey() {
  const keys = new Set();
  for (const file of readdirSync(join(root, 'Web/dist'), { recursive: true })) {
    if (file.endsWith('.js')) for (const match of readFileSync(join(root, 'Web/dist', file), 'utf8').matchAll(/(?<![a-f0-9])04[a-f0-9]{128}(?![a-f0-9])/gi)) keys.add(match[0]);
  }
  assert.equal(keys.size, 1, '生产静态文件中唯一公开 SM2 公钥');
  return [...keys][0];
}

// 生产桌面页面直接调用再生成 SDK；不拦截或模拟请求。
async function runSdkBrowser() {
  stage = 'production-sdk-authenticated-cache';
  proxy = await startProductionProxy(join(root, 'Web/dist'), base);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  const errors = [];
  const sharedTokens = new Set(['Bearer ' + admin.accessToken]);
  page.on('request', request => {
    const authorization = request.headers().authorization;
    if (authorization) secret(authorization.replace(/^Bearer /, ''));
    if (authorization && new URL(request.url()).pathname.startsWith('/prod-api/api/') && !new URL(request.url()).pathname.startsWith('/prod-api/api/sysCache/')) sharedTokens.add(authorization);
  });
  page.on('response', response => {
    for (const name of ['access-token', 'x-access-token']) {
      const token = response.headers()[name];
      if (token) { secret(token); if (name === 'access-token') sharedTokens.add('Bearer ' + token); }
    }
  });
  page.on('pageerror', error => errors.push(clean(error.message)));
  const isKeys = response => new URL(response.url()).pathname === '/prod-api/api/sysCache/keyList' && response.request().method() === 'GET';
  const [first] = await Promise.all([
    page.waitForResponse(isKeys),
    page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fplatform%2Fcache'),
  ]);
  assert.equal(first.status(), 200);
  const sdkAuthorization = (await first.request().allHeaders()).authorization;
  assert.ok(Boolean(sdkAuthorization) && sharedTokens.has(sdkAuthorization), 'SDK 使用普通请求或真实刷新响应中的共享令牌');
  const payload = await first.json();
  assert.equal(payload.code, 200);
  assert.ok(Array.isArray(payload.result));
  assert.ok(payload.result.length > 0, '实际登录已产生缓存键');
  const panel = page.locator('.cache-page');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '缓存列表', exact: true })).toBeVisible();
  await expect.poll(() => panel.locator('[role="treeitem"]').count()).toBeGreaterThan(0);
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
  assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  record('production-sdk-shared-bearer-single-prefix-raw-response', { keyCount: payload.result.length });
  const [refresh] = await Promise.all([page.waitForResponse(isKeys), panel.getByRole('button', { name: '刷新缓存列表', exact: true }).click()]);
  assert.equal(refresh.status(), 200);
  assert.equal((await refresh.json()).code, 200);
  await expect(panel.getByRole('button', { name: '刷新缓存列表', exact: true })).toBeEnabled();
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '35-sdk-cache.png'), fullPage: true });
  record('production-sdk-refresh-success');
  report.fixtureRecordsRemoved = true; // 此流程不创建业务实体，缓存仅属于一次性隔离进程。
  stage = 'production-sdk-stopped-api';
  await stop();
  for (let attempt = 0; attempt < 2; attempt++) {
    const [failed] = await Promise.all([page.waitForResponse(isKeys), panel.getByRole('button', { name: '刷新缓存列表', exact: true }).click()]);
    assert.ok(failed.status() >= 500);
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('button', { name: '刷新缓存列表', exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: join(evidence, '35-sdk-stopped-api.png'), fullPage: true });
  assert.deepEqual(errors, []);
  record('production-sdk-stopped-api-error-and-retry');
}
async function cleanupFixtures() { report.fixtureRecordsRemoved = true; }
try {
  const port = Number(process.argv[2] ?? 5035); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-SdkFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/plugin-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], { windowsHide: true, timeout: 330000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runSdkBrowser(); report.passed = true;
} catch (error) {
  report.failureStage = stage; report.error = clean(error.stack ?? error.message); persist();
  if (page) { await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true, mask: [page.locator('input[type="password"]'), ...secrets.map(value => page.getByText(value, { exact: true }))] }).catch(() => {}); report.failureUrl = clean(page.url()); const failureDom = await page.locator('body').evaluate(element => [...element.querySelectorAll('button,input,textarea,[role="dialog"],[role="tab"],iframe,h1,h2')].slice(0,100).map(item => ({ tag: item.tagName, role: item.getAttribute('role'), name: item.getAttribute('aria-label') ?? item.getAttribute('title') ?? item.textContent?.trim().slice(0,80), id: item.id, visible: !!(item.offsetWidth || item.offsetHeight || item.getClientRects().length) }))).catch(() => 'unavailable'); report.failureDom = clean(JSON.stringify(failureDom)); }
  process.exitCode = 1;
} finally {
  try { recoverStartupOwnership(); } catch (error) { report.cleanupErrors.push(clean('startup ownership recovery: ' + error.message)); }
  if (admin && base && !stopped && report.fixtureRecordsRemoved !== true) await cleanupFixtures().catch(error => report.cleanupErrors.push(clean('fixtures: ' + error.message)));
  for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime && existsSync(join(runtime, 'isolated-run.json')) ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(name + ': ' + error.message)); } }
  if (runtime) try {
    const candidates = (await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim().split(/\r?\n/).filter(Boolean);
    for (const id of candidates) { assert.match(id, /^[a-f0-9]{12,64}$/); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', id])).stdout.trim(), runtime); await native('docker', ['rm', '--force', '--volumes', id]); await assert.rejects(() => native('docker', ['inspect', id])); }
    assert.equal((await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim(), ''); report.containerRemoved = true;
  } catch (error) { report.cleanupErrors.push(clean(error.message)); }
  if (base) { try { await fetch(new URL('/api/sysConfig/sysInfo', base), { signal: AbortSignal.timeout(2000) }); report.cleanupErrors.push('isolated API remains reachable'); } catch { report.apiStopped = true; } }
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'sdk-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/plugin-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
