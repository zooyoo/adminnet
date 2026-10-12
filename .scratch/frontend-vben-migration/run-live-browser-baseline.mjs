import { startMqttApi } from './mqtt-api-startup.mjs';
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
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-api-postgresql-ezuikit-8.0.5-no-mock', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'live-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/live-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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

const liveMenuIds = [];
let liveMenuDigest;
async function runLiveBrowser() {
 const errorsOnly = process.argv.includes('--errors-only');
 report.scope = errorsOnly ? 'production-error-and-resource-cleanup' : 'production-complete-live-playback';
 report.realPlaybackConfirmed = false;
 stage = 'live-menu-fixture';
 liveMenuDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
 const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
 const route = '/' + prefix + '_live';
 const id = await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: '直播隔离验收', name: prefix + '_live', path: route, component: '/elive/index', status: 1 });
 assert.match(String(id), /^[1-9]\d*$/); liveMenuIds.push(String(id)); report.menuIds = [...liveMenuIds];
 assert.ok(JSON.stringify(await api(admin, 'sysMenu/vbenMenuTree', undefined, 'GET')).includes(route));
 proxy = await startProductionProxy(join(root, 'Web/dist'), base);
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
 page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
 const sdkResponses = []; page.on('response', response => { const path = new URL(response.url()).pathname; if (/\/ezuikit-[\w-]+\.js$/u.test(path)) sdkResponses.push({ path, status: response.status() }); });
 const sockets = []; page.on('websocket', socket => { const host = new URL(socket.url()).hostname; if (host !== '127.0.0.1' && host !== 'localhost') { const entry = { socket, closed: false }; socket.on('close', () => { entry.closed = true; }); sockets.push(entry); } });
 async function assertDisposed() {
  await expect(panel.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.frames().filter(frame => frame !== page.mainFrame() && /ys7\.com/u.test(frame.url())).length).toBe(0);
  await expect.poll(() => sockets.filter(entry => !entry.closed && !entry.socket.isClosed()).length, { timeout: 15000 }).toBe(0);
 }
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(route));
 const panel = page.locator('.live-page');
 await expect(panel.getByRole('heading', { name: '直播与视频', exact: true })).toBeVisible();
 record('production-real-login-dynamic-live-menu', { menuId: String(id) });
 const tokenInput = panel.locator('#live-token'), urlInput = panel.locator('#live-url');
 const open = () => panel.getByRole('button', { name: /^(?:打开视频|重试播放)$/u }).click();
 stage = 'live-invalid-input';
 await tokenInput.fill('invalid-local-input'); await urlInput.fill('https://example.invalid/video'); await open();
 await expect(panel.getByRole('alert')).toContainText('ezopen'); await assertDisposed();
 record('invalid-protocol-has-safe-error-without-player');
 let chosenUrl = 'ezopen://open.ys7.com/BC7900686/1.live';
 let demoToken;
 if (!errorsOnly) {
  stage = 'live-official-demo-token';
  const tokenResponse = await fetch('https://open.ys7.com/jssdk/ezopen/demo/token', { signal: AbortSignal.timeout(20000) });
  assert.equal(tokenResponse.status, 200);
  const tokenResult = await tokenResponse.json(); assert.equal(String(tokenResult.code), '200');
  demoToken = secret(tokenResult.data.accessToken); assert.ok(demoToken);
  stage = 'live-real-first-frame';
  const attempts = []; let opened = false;
  for (const device of ['BC7900686', 'G39444019', 'BC7799091', 'BD3957004']) {
   const url = 'ezopen://open.ys7.com/' + device + '/1.live';
   await tokenInput.fill(demoToken); await urlInput.fill(url); await open();
   await expect.poll(async () => (await panel.getByRole('status').first().innerText()).includes('正在打开'), { timeout: 55000 }).toBe(false);
   const state = await panel.getByRole('status').first().innerText(); attempts.push({ device, state });
   if (state.includes('已打开')) { chosenUrl = url; opened = true; break; }
   await panel.getByRole('button', { name: '退出并清除', exact: true }).click();
  }
  report.playbackAttempts = attempts; persist();
  assert.ok(opened, '官方公开示例必须由真实 SDK 成功打开');
  let mediaFrame, mediaState;
  await expect.poll(async () => {
   for (const frame of page.frames()) {
    const state = await frame.evaluate(() => ({ videos: [...document.querySelectorAll('video')].map(v => ({ width: v.videoWidth, height: v.videoHeight, readyState: v.readyState, time: v.currentTime })), canvases: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })) })).catch(() => undefined);
    if (state && (state.videos.some(v => v.width > 0 && v.height > 0 && v.readyState >= 2) || state.canvases.some(c => c.width > 0 && c.height > 0))) { mediaFrame = frame; mediaState = state; return true; }
   }
   return false;
  }, { timeout: 30000 }).toBe(true);
  assert.ok(mediaFrame); report.realMedia = mediaState;
  report.realPlaybackConfirmed = true;
  record('production-sdk-real-authorized-device-first-frame');
  await page.screenshot({ path: join(evidence, '41-live-playing.png'), fullPage: true, mask: [tokenInput, urlInput] });
  stage = 'live-stop';
  await panel.getByRole('button', { name: '停止播放', exact: true }).click(); await assertDisposed();
  await expect(tokenInput).toHaveValue(demoToken); await expect(urlInput).toHaveValue(chosenUrl);
  record('stop-removes-sdk-context-and-keeps-editable-draft');
 }
 stage = 'live-invalid-token';
 const badToken = secret('invalid-live-' + randomBytes(12).toString('hex'));
 await tokenInput.fill(badToken); await urlInput.fill(chosenUrl); await open();
 await expect(panel.getByRole('alert')).toContainText('播放失败', { timeout: 55000 });
 await assertDisposed(); await expect(tokenInput).toHaveValue(badToken); await expect(urlInput).toHaveValue(chosenUrl);
 assert.equal((await panel.innerText()).includes(badToken), false);
 assert.ok(sdkResponses.some(item => item.status === 200), '生产真实 SDK 资产必须成功加载');
 report.sdkResources = sdkResponses;
 record('invalid-token-real-sdk-safe-error-cleanup-and-retry-draft');
 stage = 'live-desktop-visual';
 const mask = [tokenInput, urlInput, ...secrets.map(value => page.getByText(value, { exact: false }))];
 for (const mode of ['light', 'dark']) {
  const dark = await page.locator('html').evaluate(el => el.classList.contains('dark'));
  if (dark !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click();
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(mode === 'dark');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: join(evidence, '41-live-' + mode + '.png'), fullPage: true, mask });
 }
 record('desktop-live-light-dark-no-horizontal-overflow');
 stage = 'live-stop-during-loading';
 await open(); await expect(panel.locator('iframe')).toHaveCount(1);
 await panel.getByRole('button', { name: '停止播放', exact: true }).click(); await assertDisposed();
 await expect(tokenInput).toHaveValue(badToken); await expect(panel.getByRole('status').first()).toContainText('未播放');
 record('stop-during-loading-removes-real-sdk-context-and-retains-draft');
 stage = 'live-route-cleanup';
 await open(); await expect(panel.locator('iframe')).toHaveCount(1);
 const documentIdentity = await page.evaluate(() => window.__liveDocumentIdentity = crypto.randomUUID());
 await page.evaluate(() => { location.hash = '#/platform/cache'; });
 await expect(page.locator('.live-page')).toHaveCount(0);
 assert.equal(await page.evaluate(() => window.__liveDocumentIdentity), documentIdentity);
 await page.evaluate(route => { location.hash = '#' + route; }, route);
 await expect(panel.getByRole('heading', { name: '直播与视频', exact: true })).toBeVisible();
 await expect(tokenInput).toHaveValue(''); await expect(urlInput).toHaveValue(''); await assertDisposed();
 record('same-document-leave-clears-credentials-and-player-context');
 await tokenInput.fill(badToken); await urlInput.fill(chosenUrl);
 await panel.getByRole('button', { name: '退出并清除', exact: true }).click();
 await expect(tokenInput).toHaveValue(''); await expect(urlInput).toHaveValue(''); await assertDisposed();
 record('explicit-clear-removes-credentials-and-player-context');
 report.externalMediaSocketsClosed = sockets.every(entry => entry.closed || entry.socket.isClosed());
 report.browserErrors = errors; assert.deepEqual(errors, []);
}
async function cleanupFixtures() {
 const failures = [];
 for (const id of liveMenuIds) { try { await api(admin, 'sysMenu/delete', { id }); } catch (error) { failures.push(clean(error.message)); } }
 try {
  for (const id of liveMenuIds) for (const [table, field] of [['sysmenu','id'],['systenantmenu','menuid'],['sysrolemenu','menuid'],['sysusermenu','menuid']]) assert.equal(await sql(`SELECT count(*) FROM ${table} WHERE ${field}=${id}`), '0');
  if (liveMenuDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t"), liveMenuDigest);
 } catch (error) { failures.push(clean(error.message)); }
 report.fixtureRecordsRemoved = failures.length === 0; assert.deepEqual(failures, []);
}

try {
  const port = Number(process.argv[2] ?? 5151); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await startMqttApi(['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-SdkFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/payment-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], 330000);
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runLiveBrowser(); report.passed = true;
} catch (error) {
  report.failureStage = stage; report.error = clean(error.stack ?? error.message); persist();
  if (page) { await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true, mask: [page.locator('input[type="password"], #live-url'), ...secrets.map(value => page.getByText(value, { exact: false }))] }).catch(() => {}); report.failureUrl = clean(page.url()); const failureDom = await page.locator('body').evaluate(element => [...element.querySelectorAll('button,input,textarea,[role="dialog"],[role="tab"],iframe,h1,h2')].slice(0,100).map(item => ({ tag: item.tagName, role: item.getAttribute('role'), name: item.getAttribute('aria-label') ?? item.getAttribute('title') ?? item.textContent?.trim().slice(0,80), id: item.id, visible: !!(item.offsetWidth || item.offsetHeight || item.getClientRects().length) }))).catch(() => 'unavailable'); report.failureDom = clean(JSON.stringify(failureDom)); }
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
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'live-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/live-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
