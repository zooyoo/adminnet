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
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-api-postgresql-dingtalk-removal-no-mock', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'dingtalk-removal-baseline.json') : join(root, '.scratch/frontend-vben-migration/dingtalk-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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

// 仅连接已校验的一次性 PostgreSQL/API；不模拟请求、不调用外部消息服务。
async function runRemoval() {
  stage = 'removed-swagger-and-routes';
  assert.ok(!existsSync(join(root, '.scratch/frontend-vben-migration/dingtalk-removal-api-build/Admin.NET.Plugin.DingTalk.dll')));
  const documents = {};
  for (const group of ['Default', 'GoView']) {
    const response = await fetch(new URL('/swagger/' + group + '/swagger.json', base), { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    documents[group] = await response.json();
    assert.ok(Object.keys(documents[group].paths).length > 0);
    assert.ok(Object.keys(documents[group].paths).every(path => !/dingtalk/i.test(path)));
  }
  const removed = await fetch(new URL('/swagger/DingTalk/swagger.json', base), { signal: AbortSignal.timeout(30000) });
  assert.equal(removed.status, 404);
  assert.deepEqual(documents.Default.components.schemas.TemplateTypeEnum.enum, [1, 2, 3, 4, 7]);
  // 使用第 35 项真实生成快照逐项验证旧路由，不调用未知的外部地址。
  const oldSwagger = JSON.parse(readFileSync(join(tmpdir(), 'adminnet-vben-0ded3c4486e24fd498e15e123b1733a3/evidence/swagger-DingTalk.json'), 'utf8'));
  let routeCount = 0;
  for (const [path, operations] of Object.entries(oldSwagger.paths)) {
    assert.match(path, /^\/api\/dingTalk\//i);
    for (const method of Object.keys(operations).filter(value => ['get', 'post', 'put', 'delete', 'patch'].includes(value))) {
      const response = await fetch(new URL(path.replace(/\{[^}]+\}/g, '1'), base), { method: method.toUpperCase(), headers: { Authorization: 'Bearer ' + admin.accessToken, 'Content-Type': 'application/json' }, ...(method === 'get' ? {} : { body: '{}' }), signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 404, method + ' ' + path);
      routeCount++;
    }
  }
  assert.ok(routeCount > 0);
  record('removed-dingtalk-document-and-all-previous-routes', { routeCount, retainedGoViewPaths: Object.keys(documents.GoView.paths).length });
  stage = 'retained-template-type-and-persistence';
  initialTemplateDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM systemplate t");
  const fixtureTenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
  assert.match(fixtureTenantId, /^[1-9]\d*$/);
  const draft = { name: prefix + '_wechatwork', code: prefix + '_code', groupName: prefix, type: 7, content: '保留企业微信 @(name)', orderNo: 1, tenantId: fixtureTenantId };
  await api(admin, 'sysTemplate/add', { ...draft, type: 5 }, 'POST', true);
  await api(admin, 'sysTemplate/page', { page: 1, pageSize: 20, type: 5 }, 'POST', true);
  assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM systemplate t"), initialTemplateDigest);
  await api(admin, 'sysTemplate/add', draft);
  const result = await api(admin, 'sysTemplate/page', { page: 1, pageSize: 20, name: draft.name, type: 7 });
  assert.equal(result.items.length, 1);
  const saved = result.items[0];
  createdIds.add(String(saved.id));
  assert.equal(saved.type, 7);
  assert.equal(await sql('SELECT type FROM systemplate WHERE id=' + String(saved.id)), '7');
  assert.equal(await api(admin, 'sysTemplate/proView', { id: saved.id, data: { name: '测试' } }), '保留企业微信 测试');
  record('removed-type-five-refused-unchanged-and-type-seven-persisted');
  stage = 'production-real-account-login';
  proxy = await startProductionProxy(join(root, 'Web/dist'), base);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  const errors = [], removedCalls = [];
  page.on('pageerror', error => errors.push(clean(error.message)));
  page.on('request', request => {
    const token = request.headers().authorization;
    if (token) secret(token.replace(/^Bearer /, ''));
    if (/\/api\/dingTalk\//i.test(new URL(request.url()).pathname)) removedCalls.push(new URL(request.url()).pathname);
  });
  page.on('response', response => { for (const name of ['access-token', 'x-access-token']) secret(response.headers()[name]); });
  await page.goto(proxy.baseUrl + '/#/login?tenantId=' + encodeURIComponent(fixtureTenantId) + '&redirect=%2Fsystem%2Ftemplate');
  const loginPanel = page.locator('.login-form');
  await expect(loginPanel).toBeVisible();
  const submit = loginPanel.getByRole('button', { name: /^登\s*录$/ });
  await expect(submit).toBeEnabled();
  await expect(page.locator('#__app-loading__')).toBeHidden({ timeout: 20000 });
  await expect(page.getByText(/钉钉|DingTalk|Dingding/i)).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '36-login-no-dingtalk.png'), fullPage: true, animations: 'disabled' });
  const password = secret(readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]);
  await loginPanel.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
  await loginPanel.getByLabel('密码', { exact: true }).fill(password);
  const [loginResponse] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/prod-api/api/sysAuth/login' && response.request().method() === 'POST'), submit.click()]);
  assert.equal(loginResponse.status(), 200);
  const loginResult = await loginResponse.json();
  secret(loginResult.result?.accessToken); secret(loginResult.result?.refreshToken);
  assert.equal(loginResult.code, 200);
  const panel = page.locator('.template-page');
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox', { name: '查询模板名称', exact: true }).fill(draft.name);
  const [listed] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/prod-api/api/sysTemplate/page' && response.request().method() === 'POST'),
    panel.getByRole('button', { name: '查询模板', exact: true }).click(),
  ]);
  assert.equal(listed.status(), 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.code, 200);
  report.templateQuery = listed.request().postDataJSON();
  assert.equal(String(report.templateQuery.tenantId), fixtureTenantId, '真实登录及数据所属租户一致');
  report.templateResultCount = listedBody.result?.items?.length;
  persist();
  assert.equal(listedBody.result.items.length, 1, '浏览器真实查询返回本次模板');
  await expect(panel.getByRole('row').filter({ hasText: draft.name })).toBeVisible();
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
  assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 15000 });
  await panel.getByRole('button', { name: '新增模板', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模板', exact: true });
  await dialog.getByRole('combobox', { name: '模板类型', exact: true }).click();
  const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option-content');
  await expect(options).toHaveText(['通知', '短信', '邮件', '微信', '企业微信']);
  const dropdown = page.locator('.ant-select-dropdown:visible');
  await expect(dropdown).toHaveCount(1);
  await expect.poll(() => dropdown.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
  await expect(options.filter({ hasText: /^企业微信$/ })).toBeVisible();
  await page.screenshot({ path: join(evidence, '36-template-types.png'), fullPage: true });
  await options.filter({ hasText: /^企业微信$/ }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  record('production-account-login-and-template-options-without-dingtalk');
  await cleanupFixtures();
  stage = 'production-retained-cache';
  const isKeys = response => new URL(response.url()).pathname === '/prod-api/api/sysCache/keyList' && response.request().method() === 'GET';
  const [keys] = await Promise.all([page.waitForResponse(isKeys), page.evaluate(() => { location.hash = '/platform/cache'; })]);
  assert.equal(keys.status(), 200); assert.equal((await keys.json()).code, 200);
  const cachePanel = page.locator('.cache-page');
  await expect(cachePanel).toBeVisible();
  const refresh = cachePanel.getByRole('button', { name: '刷新缓存列表', exact: true });
  const [response] = await Promise.all([page.waitForResponse(isKeys), refresh.click()]);
  assert.equal(response.status(), 200); assert.equal((await response.json()).code, 200);
  await expect(refresh).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '36-retained-cache.png'), fullPage: true, animations: 'disabled' });
  record('production-retained-cache-real-api-success');
  stage = 'production-real-api-stop';
  await stop();
  const [failed] = await Promise.all([page.waitForResponse(isKeys), refresh.click()]);
  assert.ok(failed.status() >= 500);
  await expect(cachePanel.getByRole('alert')).toBeVisible();
  await expect(refresh).toBeEnabled();
  assert.deepEqual(errors, []); assert.deepEqual(removedCalls, []);
  record('production-stopped-api-recoverable-error-no-dingtalk-requests');
}
async function cleanupFixtures() {
  const owned = await api(admin, 'sysTemplate/page', { page: 1, pageSize: 100, name: prefix });
  assert.ok(owned.total <= 100 && owned.items.every(row => row.name.startsWith(prefix)));
  const failures = [];
  for (const row of owned.items) try { await api(admin, 'sysTemplate/delete', { id: row.id }); } catch (error) { failures.push(error.message); }
  assert.deepEqual(failures, []);
  assert.equal(await sql("SELECT count(*) FROM systemplate WHERE starts_with(name, '" + prefix + "')"), '0');
  if (initialTemplateDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM systemplate t"), initialTemplateDigest);
  report.fixtureRecordsRemoved = true;
}
try {
  const port = Number(process.argv[2] ?? 5036); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-SdkFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/dingtalk-removal-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], { windowsHide: true, timeout: 330000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runRemoval(); report.passed = true;
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
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'dingtalk-removal-baseline.json') : join(root, '.scratch/frontend-vben-migration/dingtalk-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
