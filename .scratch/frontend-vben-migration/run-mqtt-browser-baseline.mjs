import { startMqttApi } from './mqtt-api-startup.mjs';
import { createMqttProbe } from './mqtt-probe-fixture.mjs';
import { recoverMqttFixture } from './mqtt-fixture-recovery.mjs';
import { createMqttBroker } from './mqtt-broker-fixture.mjs';
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
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-api-postgresql-mqtt-local-broker-no-mock', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'mqtt-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/mqtt-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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

let mqttBroker;
let mqttProbe;
let secondMqttBroker;
const mqttMenuIds = [];
let mqttMenuDigest;
async function runMqttBrowser() {
 stage = 'mqtt-menu-fixture';
 mqttMenuDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
 const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
 const route = '/' + prefix + '_mqtt';
 const id = await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: 'MQTT隔离验收', name: prefix + '_mqtt', path: route, component: '/mqttx/index', status: 1 });
 assert.match(String(id), /^[1-9]\d*$/); mqttMenuIds.push(String(id)); report.menuIds = [...mqttMenuIds];
 assert.ok(JSON.stringify(await api(admin, 'sysMenu/vbenMenuTree', undefined, 'GET')).includes(route));
 mqttBroker = await createMqttBroker(runtime, native, secret);
 report.brokerImage = mqttBroker.image;
 proxy = await startProductionProxy(join(root, 'Web/dist'), base);
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
 page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
 await page.addInitScript(() => {
  window.__mqttSockets = [];
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
   constructor(...args) { super(...args); window.__mqttSockets.push(this); }
  };
 });
 const sockets = []; page.on('websocket', socket => { const entry = { socket, url: socket.url(), closed: false, error: false }; sockets.push(entry); socket.on('close', () => { entry.closed = true; }); socket.on('socketerror', () => { entry.error = true; }); });
 async function assertSocketsClosed(urls) {
  const started = Date.now();
  try {
   // 原生 WebSocket.close() 先进入 CLOSING；必须等待真实关闭握手完成。
   await expect.poll(() => page.evaluate(urls => window.__mqttSockets.filter(socket => urls.includes(socket.url) && socket.readyState !== WebSocket.CLOSED).length, urls), { timeout: 35000 }).toBe(0);
   await expect.poll(() => sockets.filter(entry => urls.includes(entry.url) && !entry.socket.isClosed()).length).toBe(0);
  } finally {
   report.socketCloseWaitMs = Date.now() - started;
   report.socketStates = await page.evaluate(urls => window.__mqttSockets.filter(socket => urls.includes(socket.url)).map(socket => ({ url: socket.url, readyState: socket.readyState })), urls);
   report.socketEvents = sockets.filter(entry => urls.includes(entry.url)).map(entry => ({ url: entry.url, closedEvent: entry.closed, closed: entry.socket.isClosed(), error: entry.error }));
   persist();
  }
 }
 stage = 'mqtt-production-page';
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(route));
 const panel = page.locator('.mqtt-page'); await expect(panel).toBeVisible();
 await expect(panel.getByRole('heading', { name: 'MQTT 连接与消息', exact: true })).toBeVisible();
 assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
 record('production-real-login-dynamic-mqtt-menu');
 stage = 'mqtt-connect-subscribe-publish';
 const deviceToken = secret(randomBytes(16).toString('hex'));
 await panel.locator('#mqtt-mqttToken').fill(deviceToken);
 for (const [field, value] of Object.entries({ host: '127.0.0.1', port: String(mqttBroker.port), username: mqttBroker.username, password: mqttBroker.password, repacket: mqttBroker.registration })) await panel.locator('#mqtt-' + field).fill(value);
 const topic = mqttBroker.prefix + '/probe';
 await panel.locator('#mqtt-topics').fill(topic);
 await panel.locator('#mqtt-publish-topic').fill(topic);
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 1 个主题', { exact: true })).toBeVisible();
 await panel.getByRole('checkbox', { name: '原始消息（不封装设备指令）' }).check();
 await panel.locator('#mqtt-payload').fill('desktop-real-mqtt-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('desktop-real-mqtt-' + prefix);
 record('browser-real-broker-auth-subscribe-publish-receive');
 await page.screenshot({ path: join(evidence, '40-mqtt-connected.png'), fullPage: true, mask: [panel.locator('#mqtt-password'), panel.locator('#mqtt-mqttToken')] });
 stage = 'mqtt-device-protocol';
 mqttProbe = await createMqttProbe(mqttBroker);
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：未连接' })).toBeVisible();
 await panel.getByRole('button', { name: '按注册包生成主题', exact: true }).click();
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 3 个主题', { exact: true })).toBeVisible();
 await panel.getByRole('checkbox', { name: '原始消息（不封装设备指令）' }).uncheck();
 await panel.locator('#mqtt-payload').fill('55 AA AA AA AA 91 CF');
 const clientId = await panel.locator('#mqtt-clientId').inputValue();
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect.poll(() => mqttProbe.received).toContainEqual({ token: deviceToken, cmd: '55 AA AA AA AA 91 CF', cmdpara: '', clientid: clientId });
 await mqttProbe.publish('out', { regpacket: mqttBroker.registration, redata: '55 AA AA AA AA 82 01 01' });
 await mqttProbe.publish('out', { regpacket: mqttBroker.registration, redata: '55 AA AA AA AA 84 AC 01' });
 await mqttProbe.publish('will', { regpacket: mqttBroker.registration, redata: 'online' });
 await mqttProbe.publish('dht', { regpacket: mqttBroker.registration, temperature: 23.5, humidity: 60, runsec: 42 });
 const devicePanel = panel.getByRole('heading', { name: '设备状态', exact: true }).locator('..');
 await expect(devicePanel).toContainText(/1 路：\s*开/);
 await expect(devicePanel).toContainText('在线');
 await expect(devicePanel).toContainText('23.5');
 await expect(devicePanel).toContainText('60');
 await expect(devicePanel).toContainText('42');
 record('real-device-command-envelope-relay-ac-online-sensor-status');
 for (const mode of ['light', 'dark']) {
   if (((await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')) !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click();
   await expect.poll(async () => (await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')).toBe(mode === 'dark');
   await page.mouse.move(240, 100);
   await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
   await page.screenshot({ path: join(evidence, '40-mqtt-device-' + mode + '.png'), fullPage: true, mask: [panel.locator('#mqtt-password'), panel.locator('#mqtt-mqttToken')] });
 }
 record('desktop-device-state-light-dark-no-horizontal-overflow');
 await mqttProbe.destroy(); mqttProbe = undefined;
 await panel.getByRole('button', { name: '取消订阅', exact: true }).click();
 await panel.locator('#mqtt-topics').fill(topic);
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 1 个主题', { exact: true })).toBeVisible();
 await panel.locator('#mqtt-publish-topic').fill(topic);
 await panel.getByRole('checkbox', { name: '原始消息（不封装设备指令）' }).check();
 await panel.locator('#mqtt-payload').fill('credentials-' + deviceToken);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('[已隐藏]');
 await expect(panel.getByLabel('接收消息内容')).not.toContainText(deviceToken);
 record('real-echo-message-log-redacts-device-token');
 await panel.locator('#mqtt-payload').fill('post-redaction-probe');
 stage = 'mqtt-real-broker-reconnect';
 await mqttBroker.stop();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：重连中' })).toBeVisible();
 await mqttBroker.start();
 // 默认重连间隔为 5 秒，断言截止时间必须覆盖 broker 启动和下一次重连。
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible({ timeout: 30000 });
 await panel.locator('#mqtt-payload').fill('reconnected-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('reconnected-' + prefix);
 record('real-broker-restart-resubscribes-and-receives');
 stage = 'mqtt-unsubscribe-disconnect';
 await panel.getByRole('button', { name: '取消订阅', exact: true }).click();
 await expect(panel.getByText('已订阅 0 个主题', { exact: true })).toBeVisible();
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：未连接' })).toBeVisible();
 await expect(panel.locator('#mqtt-host')).toBeEnabled();
 await assertSocketsClosed([mqttBroker.url]);
 record('browser-unsubscribe-and-explicit-disconnect');
 stage = 'mqtt-topic-acl-delivery-isolation';
 const forbiddenPrefix = mqttBroker.prefix + '-denied';
 await panel.locator('#mqtt-topics').fill(topic + '\n' + forbiddenPrefix + '/into');
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 2 个主题', { exact: true })).toBeVisible();
 // 此 broker 对 MQTT 3.1.1 订阅返回成功，在投递时按用户 ACL 过滤。
 mqttProbe = await createMqttProbe({ ...mqttBroker, prefix: forbiddenPrefix, username: mqttBroker.probeUsername, password: mqttBroker.probePassword });
 const forbiddenPayload = { proof: 'foreign-user-message-' + prefix };
 await mqttProbe.publish('into', forbiddenPayload);
 await expect.poll(() => mqttProbe.received).toContainEqual(forbiddenPayload);
 // 等到允许主题的后续消息到达，作为真实 broker 已处理前一条消息的屏障。
 await panel.locator('#mqtt-publish-topic').fill(topic);
 await panel.locator('#mqtt-payload').fill('authorized-after-acl-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('authorized-after-acl-' + prefix);
 await expect(panel.getByLabel('接收消息内容')).not.toContainText(forbiddenPayload.proof);
 await mqttProbe.destroy(); mqttProbe = undefined;
 await panel.getByRole('button', { name: '取消订阅', exact: true }).click();
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await assertSocketsClosed([mqttBroker.url]);
 record('real-broker-acl-isolates-foreign-user-messages-with-authorized-control');
 stage = 'mqtt-invalid-authentication';
 await panel.locator('#mqtt-password').fill('invalid-' + prefix);
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('alert')).toContainText('MQTT 连接或操作失败');
 await expect(panel.locator('#mqtt-password')).toHaveValue('invalid-' + prefix);
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await assertSocketsClosed([mqttBroker.url]);
 record('real-broker-refuses-wrong-password-draft-remains-disconnect-stops-retry');
 stage = 'mqtt-switch-broker';
 secondMqttBroker = await createMqttBroker(runtime, native, secret);
 for (const [field, value] of Object.entries({ port: String(secondMqttBroker.port), username: secondMqttBroker.username, password: secondMqttBroker.password, repacket: secondMqttBroker.registration })) await panel.locator('#mqtt-' + field).fill(value);
 const secondTopic = secondMqttBroker.prefix + '/probe';
 await panel.locator('#mqtt-topics').fill(secondTopic);
 await panel.locator('#mqtt-publish-topic').fill(secondTopic);
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 1 个主题', { exact: true })).toBeVisible();
 await panel.locator('#mqtt-payload').fill('second-broker-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('second-broker-' + prefix);
 await expect(panel.getByLabel('接收消息内容')).not.toContainText('reconnected-' + prefix);
 await assertSocketsClosed([mqttBroker.url]);
 record('switch-to-second-real-broker-old-connection-closed');
 stage = 'mqtt-same-document-leave';
 await page.evaluate(() => { location.hash = '/platform/cache'; });
 await expect(page.locator('.cache-page')).toBeVisible();
 await assertSocketsClosed([mqttBroker.url, secondMqttBroker.url]);
 await page.goBack();
 await expect(panel).toBeVisible();
 for (const field of ['password', 'username', 'mqttToken']) await expect(panel.locator('#mqtt-' + field)).toHaveValue('');
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：未连接' })).toBeVisible();
 await expect(panel.getByText('已订阅 0 个主题', { exact: true })).toBeVisible();
 await expect(panel.getByLabel('接收消息内容')).not.toContainText('second-broker-' + prefix);
 record('same-document-leave-closes-sockets-clears-credentials-and-messages');
 assert.deepEqual(errors, []);
}
async function cleanupFixtures() {
 const failures = [];
 for (const id of mqttMenuIds) {
  try { await api(admin, 'sysMenu/delete', { id }); } catch (error) { failures.push(clean(error.message)); }
 }
 try {
  for (const id of mqttMenuIds) for (const [table, field] of [['sysmenu','id'],['systenantmenu','menuid'],['sysrolemenu','menuid'],['sysusermenu','menuid']]) assert.equal(await sql(`SELECT count(*) FROM ${table} WHERE ${field}=${id}`), '0');
  if (mqttMenuDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t"), mqttMenuDigest);
 } catch (error) { failures.push(clean(error.message)); }
 report.fixtureRecordsRemoved = failures.length === 0;
 assert.deepEqual(failures, []);
}
async function cleanupMqttBroker() {
 const results = await Promise.allSettled([mqttProbe, mqttBroker, secondMqttBroker].filter(Boolean).map(resource => resource.destroy()));
 const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
 if (errors.length) throw new AggregateError(errors, 'MQTT broker cleanup failed');
 report.brokerRemoved = true;
}

try {
  const port = Number(process.argv[2] ?? 5040); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  if (process.argv[3]) { runtime = realpathSync(process.argv[3]); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/); } else {
  const { stdout } = await startMqttApi(['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-SdkFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/payment-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], 330000);
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  }
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); if (!process.argv[3]) persist(); stage = 'service'; admin = await login('superAdmin.NET');
  if (process.argv[3]) { stage = 'interrupted-fixture-recovery'; await recoverMqttFixture({ runtime, evidence, native, api, sql, admin, report }); record('interrupted-owned-fixtures-recovered'); } await runMqttBrowser(); report.passed = true;
} catch (error) {
  report.failureStage = stage; report.error = clean(error.stack ?? error.message); persist();
  if (page) { await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true, mask: [page.locator('input[type="password"], #mqtt-payload, .command-select'), ...secrets.map(value => page.getByText(value, { exact: false }))] }).catch(() => {}); report.failureUrl = clean(page.url()); const failureDom = await page.locator('body').evaluate(element => [...element.querySelectorAll('button,input,textarea,[role="dialog"],[role="tab"],iframe,h1,h2')].slice(0,100).map(item => ({ tag: item.tagName, role: item.getAttribute('role'), name: item.getAttribute('aria-label') ?? item.getAttribute('title') ?? item.textContent?.trim().slice(0,80), id: item.id, visible: !!(item.offsetWidth || item.offsetHeight || item.getClientRects().length) }))).catch(() => 'unavailable'); report.failureDom = clean(JSON.stringify(failureDom)); }
  process.exitCode = 1;
} finally {
  try { recoverStartupOwnership(); } catch (error) { report.cleanupErrors.push(clean('startup ownership recovery: ' + error.message)); }
  if (admin && base && !stopped && report.fixtureRecordsRemoved !== true) await cleanupFixtures().catch(error => report.cleanupErrors.push(clean('fixtures: ' + error.message)));
  for (const [name, work] of [['mqtt-broker', () => cleanupMqttBroker()], ['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime && existsSync(join(runtime, 'isolated-run.json')) ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(name + ': ' + error.message)); } }
  if (runtime) try {
    const candidates = (await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim().split(/\r?\n/).filter(Boolean);
    for (const id of candidates) { assert.match(id, /^[a-f0-9]{12,64}$/); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', id])).stdout.trim(), runtime); await native('docker', ['rm', '--force', '--volumes', id]); await assert.rejects(() => native('docker', ['inspect', id])); }
    assert.equal((await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim(), ''); report.containerRemoved = true;
  } catch (error) { report.cleanupErrors.push(clean(error.message)); }
  if (base) { try { await fetch(new URL('/api/sysConfig/sysInfo', base), { signal: AbortSignal.timeout(2000) }); report.cleanupErrors.push('isolated API remains reachable'); } catch { report.apiStopped = true; } }
  report.cleanupPassed = report.brokerRemoved === true && report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'mqtt-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/mqtt-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
