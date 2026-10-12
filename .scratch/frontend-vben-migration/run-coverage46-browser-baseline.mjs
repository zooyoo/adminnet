import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRuntimeNginx } from './runtime45-nginx-fixture.mjs';
import { startMqttApi } from './mqtt-api-startup.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const prefix = 'tpl_' + randomBytes(5).toString('hex');
const baselinePrefix = 'baseline_' + randomBytes(5).toString('hex');
const runtimeMarkerPath = join(root, '.scratch/frontend-vben-migration/plugin-startup-runtime-' + randomBytes(16).toString('hex') + '.json');
const secrets = [], fixtures = [], createdIds = new Set(), requestCounts = new Map();
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-nginx-cross-module-users-tenants-postgresql-no-mock', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'coverage46-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/coverage46-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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

const coverageMenus = [], coverageTenants = [], nginxResources = [];
let coverageBaseline, coverageOnlineBaseline;
const coverageTables = ['sysmenu', 'systenant', 'sysorg', 'syspos', 'sysrole', 'sysrolemenu', 'systenantmenu', 'sysuserrole', 'sysusermenu', 'sysuserextorg'];
async function coverageDigest() {
  const parts = [];
  for (const table of coverageTables) parts.push(await sql("SELECT md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY id), '')) FROM " + table + ' x'));
  parts.push(await sql("SELECT md5(coalesce(string_agg(concat(id, ':', account, ':', tenantid, ':', orgid, ':', posid), '|' ORDER BY id), '')) FROM sysuser"));
  return parts.join(':');
}
async function cleanupFixtures() {
  for (const item of coverageTenants.toReversed()) {
    if (await sql('SELECT count(*) FROM systenant WHERE id=' + item.id) !== '0') await api(admin, 'sysTenant/delete', { id: item.id });
    for (const table of ['sysorg', 'syspos', 'sysrole', 'systenantmenu', 'sysuser']) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE tenantid=' + item.id), '0');
  }
  for (const id of coverageMenus.toReversed()) {
    if (await sql('SELECT count(*) FROM sysmenu WHERE id=' + id) !== '0') await api(admin, 'sysMenu/delete', { id });
    for (const table of ['sysmenu', 'sysrolemenu', 'systenantmenu', 'sysusermenu']) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + (table === 'sysmenu' ? 'id' : 'menuid') + '=' + id), '0');
  }
  if (coverageBaseline) assert.equal(await coverageDigest(), coverageBaseline, 'Owned tenants, roles, users and grants must return to the original values');
  report.fixtureRecordsRemoved = true;
}
async function cleanupRuntimeNginx() {
  const settled = await Promise.allSettled(nginxResources.map(resource => resource.close()));
  const errors = settled.filter(item => item.status === 'rejected').map(item => item.reason);
  if (errors.length) throw new AggregateError(errors, 'Owned Nginx cleanup failed');
  report.nginxRemoved = true;
}
async function refused(session, path, input) {
  const response = await fetch(new URL('/api/' + path, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.accessToken }, body: JSON.stringify(input) });
  const body = await response.text();
  const result = body ? JSON.parse(body) : {};
  assert.ok(response.status === 403 || (response.status === 200 && [400, 403].includes(result.code)), path + ' must reject unauthorized access');
  assert.ok(result.result == null);
  return { path, status: response.status, code: result.code };
}
async function loginCoverage(account, password, tenantId) {
  if (!password) password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/u)[1];
  secret(password);
  const identity = await api(undefined, 'sysAuth/login', { account, tenantId, password: sm2.doEncrypt(password, getPublishedPublicKey(), 1) });
  secret(identity.accessToken); secret(identity.refreshToken); return identity;
}
async function runRuntimeBrowser() {
  report.scope = 'available-integrations-with-user-deferred-live-playback';
  report.proposalComplete = false; report.deferredProposals = [41];
  coverageBaseline = await coverageDigest(); coverageOnlineBaseline = await sql('SELECT count(*) FROM sysonlineuser');
  stage = 'real-role-user-tenant-fixtures';
  for (const [suffix, component, title] of [['pos', '/system/pos/index', '连续职位'], ['org', '/system/org/index', '连续机构']]) {
    const name = prefix + '_' + suffix;
    coverageMenus.push(String(await api(admin, 'sysMenu/add', { pid: 0, type: 1, title: prefix + '_' + title, name, path: '/' + name, component, visible: true, isKeepAlive: true, status: 1, orderNo: 1, icon: 'ele-Menu' })));
  }
  const buttons = JSON.parse(await sql("SELECT coalesce(json_agg(id::text), '[]'::json) FROM sysmenu WHERE permission LIKE 'sysPos:%' OR permission LIKE 'sysOrg:%'"));
  const readButton = await sql("SELECT id::text FROM sysmenu WHERE permission='sysPos:list'");
  assert.match(readButton, /^\d+$/u);
  const profileButtons = JSON.parse(await sql("SELECT coalesce(json_agg(id::text), '[]'::json) FROM sysmenu WHERE permission='sysUser:baseInfo'"));
  assert.equal(profileButtons.length, 1, 'Fixture grants only the existing own-profile permission');
  const home = JSON.parse(await sql("SELECT coalesce(json_agg(id::text), '[]'::json) FROM sysmenu WHERE name='home' OR title='工作台'"));
  for (const key of ['a', 'b']) {
    const account = prefix + '_admin_' + key, tenantName = prefix + '_租户_' + key;
    await api(admin, 'sysTenant/add', { name: tenantName, adminAccount: account, tenantType: 0, status: 1, enableReg: 2, orderNo: 100 });
    const item = JSON.parse(await sql("SELECT row_to_json(x) FROM (SELECT id::text AS id, userid::text AS userid, orgid::text AS orgid FROM systenant WHERE userid=(SELECT id FROM sysuser WHERE account=" + quote(account) + ')) x'));
    coverageTenants.push({ ...item, account, tenantName });
    await api(admin, 'sysTenant/grantMenu', { id: item.id, menuIdList: [...coverageMenus, ...buttons, ...profileButtons, ...home] });
    const identity = await loginCoverage(account, undefined, item.id), positionName = prefix + '_position_' + key;
    await api(identity, 'sysPos/add', { name: positionName, code: positionName, status: 1, orderNo: 100 });
    const posId = await sql('SELECT id::text FROM syspos WHERE tenantid=' + item.id + ' AND name=' + quote(positionName));
    Object.assign(coverageTenants.at(-1), { identity, positionName, posId });
  }
  const [a, b] = coverageTenants, normalRole = prefix + '_read_role', normalAccount = prefix + '_reader';
  await api(admin, 'sysRole/add', { tenantId: a.id, name: normalRole, code: normalRole, status: 1, dataScope: 1, menuIdList: [coverageMenus[0], readButton, ...profileButtons, ...home] });
  const roleId = await sql('SELECT id::text FROM sysrole WHERE tenantid=' + a.id + ' AND code=' + quote(normalRole)); assert.match(roleId, /^\d+$/u);
  const userId = await api(admin, 'sysUser/add', { account: normalAccount, realName: prefix + '_普通用户', tenantId: a.id, orgId: a.orgid, posId: a.posId, accountType: 777, langCode: 'zh-CN', roleIdList: [roleId], extOrgIdList: [] });
  const normalPassword = secret(await api(admin, 'sysUser/resetPwd', { id: userId }));
  const reader = await loginCoverage(normalAccount, normalPassword, a.id), readerInfo = await api(reader, 'sysAuth/userInfo', undefined, 'GET');
  assert.equal(String(readerInfo.tenantId), a.id); assert.equal(readerInfo.accountType, 777);
  assert.ok(readerInfo.buttons.includes('sysPos:list')); assert.equal(readerInfo.buttons.includes('sysPos:add'), false);
  const tenantAList = await api(a.identity, 'sysPos/list?tenantId=' + b.id, undefined, 'GET');
  assert.ok(tenantAList.some(row => String(row.id) === a.posId)); assert.equal(tenantAList.some(row => String(row.id) === b.posId), false);
  const refusals = [await refused(a.identity, 'sysPos/update', { id: b.posId, tenantId: a.id, name: 'forged', code: 'forged', status: 1, orderNo: 1 }), await refused(reader, 'sysPos/add', { tenantId: a.id, name: prefix + '_forbidden', code: prefix + '_forbidden', status: 1 }), await refused(reader, 'sysTenant/changeTenant', { id: b.id })];
  assert.equal(await sql('SELECT name FROM syspos WHERE id=' + b.posId), b.positionName);
  record('postgresql-two-tenants-read-only-user-and-rejected-cross-boundary-operations', { tenantIds: [a.id, b.id], roleId, userId: String(userId), refusals });
  const nginx = await createRuntimeNginx({ root, runtime, backend: base.href, native, template: 'Web/scripts/deploy/nginx.conf' }); nginxResources.push(nginx); await nginx.setApiUrl('/prod-api/');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } }); page = await context.newPage(); page.setDefaultTimeout(20000);
  const browserErrors = []; page.on('pageerror', error => browserErrors.push(clean(error.message)));
  const mainPath = '/' + prefix + '_pos';
  async function animations() { await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().iterations))).length)).toBe(0); }
  async function navigate(path) { await page.evaluate(value => { location.hash = value; }, path); await expect(page.getByText(/加载菜单中/u)).toBeHidden({ timeout: 30000 }); await animations(); }
  async function shot(name) { await animations(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true); await page.screenshot({ path: join(evidence, name), fullPage: true, animations: 'disabled', mask: [page.locator('input[type=password]')] }); }
  async function uiLogin(account, password, tenantId) {
    if (!password) password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/u)[1]; secret(password);
    await page.goto(nginx.baseUrl + '/#/login' + (tenantId ? '?tenantId=' + tenantId : ''));
    await expect(page).toHaveURL(/#\/auth\/login(?:\?|$)/u);
    const loginButton = page.getByRole('button', { name: /^登\s*录$/u }); await expect(loginButton).toBeEnabled();
    await page.getByLabel('账号', { exact: true }).fill(account); await page.getByLabel('密码', { exact: true }).fill(password);
    await expect(page.getByLabel('账号', { exact: true })).toHaveValue(account);
    const [response] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/api/sysAuth/login') && value.request().method() === 'POST'), loginButton.click()]);
    const result = await response.json(); assert.equal(result.code, 200, clean(result.message)); secret(result.result.accessToken); secret(result.result.refreshToken);
    await expect(page).not.toHaveURL(/#\/auth\/login/u); await expect(page.getByText(/加载菜单中/u)).toBeHidden({ timeout: 30000 });
  }
  stage = 'anonymous-legacy-public-dial-route';
  const contact = { realName: prefix + '_拨号', number: '+86 (138) 0013-8000' }, legacyToken = secret('unused-' + randomBytes(12).toString('hex'));
  await page.goto(nginx.baseUrl + '/$callTel#/$callTel?code=' + encodeURIComponent(encodeURIComponent(JSON.stringify(contact))) + '&token=' + encodeURIComponent(legacyToken));
  await expect(page.getByRole('link', { name: '拨打电话', exact: true })).toHaveAttribute('href', 'tel:+8613800138000'); await expect(page.getByText(contact.realName, { exact: true })).toBeVisible(); await expect(page).not.toHaveURL(/token=/u); await shot('46-public-dial.png');
  await page.reload(); await expect(page.getByRole('link', { name: '拨打电话', exact: true })).toBeVisible();
  await page.goto(nginx.baseUrl + '/#/$callTel?code=%25malformed'); await expect(page.getByRole('alert')).toContainText('拨号信息无效'); await expect(page.getByRole('link', { name: '拨打电话', exact: true })).toHaveCount(0);
  record('anonymous-public-dial-legacy-double-encoding-deep-refresh-and-invalid-input');
  stage = 'normal-user-continuous-position-profile-workbench';
  await uiLogin(normalAccount, normalPassword, a.id); await navigate(mainPath); const panel = page.locator('.position-page');
  const positionRow = name => panel.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await expect(positionRow(a.positionName)).toBeVisible(); await expect(positionRow(b.positionName)).toHaveCount(0); await expect(panel.getByRole('button', { name: '新增职位', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '切换租户', exact: true })).toHaveCount(0); if (await page.locator('html').evaluate(element => element.classList.contains('dark'))) await page.getByRole('button', { name: 'light', exact: true }).click();
  await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(false); await shot('46-normal-position-light.png');
  await page.reload(); await expect(positionRow(a.positionName)).toBeVisible();
  await navigate('/profile'); await expect(page.getByLabel('账号', { exact: true })).toHaveValue(normalAccount);
  await navigate('/dashboard/home'); await expect(page.locator('.workbench')).toBeVisible();
  await navigate(mainPath); await expect(positionRow(a.positionName)).toBeVisible(); record('normal-user-read-only-tenant-filter-deep-refresh-profile-workbench-and-cache-return');
  stage = 'normal-user-logout-and-identity-cleanup';
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); const confirm = page.getByRole('dialog').filter({ hasText: '退出' }); await confirm.getByRole('button', { name: /^确\s*(?:定|认)$/u }).click(); await expect(page).toHaveURL(/#\/auth\/login/u); await expect(page.getByText(a.positionName, { exact: true })).toHaveCount(0);
  await navigate(mainPath); await expect(page).toHaveURL(/#\/auth\/login/u); record('logout-clears-old-identity-cache-and-protects-deep-route');
  stage = 'administrator-cross-tenant-same-document-workflow';
  await uiLogin('superAdmin.NET'); const documentId = await page.evaluate(() => { window.__coverageDocument = crypto.randomUUID(); return window.__coverageDocument; });
  async function switchTenant(item) {
    await page.getByRole('button', { name: '切换租户', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '切换租户', exact: true }); await dialog.getByRole('combobox', { name: '租户', exact: true }).click(); await page.getByRole('option', { name: item.tenantName, exact: true }).click();
    const changed = page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/api/sysTenant/changeTenant') && value.request().method() === 'POST'); await dialog.getByRole('button', { name: /^确\s*(?:定|认)$/u }).click(); const result = await (await changed).json(); assert.equal(result.code, 200, clean(result.message)); secret(result.result.accessToken); secret(result.result.refreshToken);
    const info = await api(result.result, 'sysAuth/userInfo', undefined, 'GET'); assert.equal(String(info.currentTenantId), item.id); await expect(dialog).toBeHidden(); assert.equal(await page.evaluate(() => window.__coverageDocument), documentId); await navigate(mainPath); await expect(positionRow(item.positionName)).toBeVisible();
  }
  await switchTenant(a); await panel.getByRole('button', { name: '新增职位', exact: true }).click(); let editor = page.getByRole('dialog', { name: '添加职位', exact: true }); await editor.getByLabel('职位名称', { exact: true }).fill(prefix + '_discarded_draft'); await editor.getByRole('button', { name: /^取\s*消$/u }).click();
  await switchTenant(b); await expect(positionRow(a.positionName)).toHaveCount(0); await panel.getByRole('button', { name: '新增职位', exact: true }).click(); editor = page.getByRole('dialog', { name: '添加职位', exact: true }); await expect(editor.getByLabel('职位名称', { exact: true })).toHaveValue('');
  const newName = prefix + '_ui_b'; await editor.getByLabel('职位名称', { exact: true }).fill(newName); await editor.getByLabel('职位编码', { exact: true }).fill(newName); const added = page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/api/sysPos/add') && value.request().method() === 'POST'); await editor.getByRole('button', { name: /^确\s*(?:定|认)$/u }).click(); assert.equal((await (await added).json()).code, 200); await expect(positionRow(newName)).toBeVisible(); assert.equal(await sql('SELECT tenantid::text FROM syspos WHERE name=' + quote(newName)), b.id);
  await navigate('/' + prefix + '_org'); await expect(page.locator('.org-page').getByRole('tree').getByText(b.tenantName, { exact: true })).toBeVisible(); await navigate(mainPath); await expect(positionRow(newName)).toBeVisible(); await switchTenant(a); await expect(positionRow(newName)).toHaveCount(0); await expect(positionRow(a.positionName)).toBeVisible(); record('administrator-same-document-tenant-switch-clears-drafts-and-maintains-pg-isolation');
  stage = 'desktop-theme-continuous-workflow';
  for (const mode of ['light', 'dark']) { const dark = await page.locator('html').evaluate(element => element.classList.contains('dark')); if (dark !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click(); await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(mode === 'dark'); await shot('46-admin-tenant-' + mode + '.png'); }
  record('desktop-themes-tenant-workflow-no-horizontal-overflow'); await context.close(); await expect.poll(() => sql('SELECT count(*) FROM sysonlineuser'), { timeout: 30000 }).toBe(coverageOnlineBaseline); assert.deepEqual(browserErrors, []); report.browserErrors = browserErrors; report.serverSessionCleanupConfirmed = true; await cleanupFixtures(); record('owned-pg-relations-and-online-sessions-restored');
}

try {
  const port = Number(process.argv[2] ?? 5156); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const bootstrap = JSON.parse(readFileSync(join(root, '.scratch/frontend-vben-migration/codegen43-bootstrap-control.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(bootstrap.ready, true); assert.match(basename(dirname(bootstrap.outputRoot)), /^adminnet-codegen43-bootstrap-[a-f0-9]{32}$/); assert.equal(dirname(dirname(realpathSync(bootstrap.outputRoot))).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
  const { stdout } = await startMqttApi(['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-OnlineFixture', '-JobFixture', '-FileDeduplication', '-BuildRoot', bootstrap.outputRoot, '-RuntimeMarkerPath', runtimeMarkerPath], 330000);
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runRuntimeBrowser(); report.passed = true;
} catch (error) {
  report.failureStage = stage; report.error = clean(error.stack ?? error.message); persist();
  if (page) { await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: true, mask: [page.locator('input[type="password"]'), ...secrets.map(value => page.getByText(value, { exact: false }))] }).catch(() => {}); report.failureUrl = clean(page.url()); const failureDom = await page.locator('body').evaluate(element => [...element.querySelectorAll('button,input,textarea,[role="dialog"],[role="tab"],iframe,h1,h2')].slice(0,100).map(item => ({ tag: item.tagName, role: item.getAttribute('role'), name: item.getAttribute('aria-label') ?? item.getAttribute('title') ?? item.textContent?.trim().slice(0,80), id: item.id, visible: !!(item.offsetWidth || item.offsetHeight || item.getClientRects().length) }))).catch(() => 'unavailable'); report.failureDom = clean(JSON.stringify(failureDom)); }
  process.exitCode = 1;
} finally {
  try { recoverStartupOwnership(); } catch (error) { report.cleanupErrors.push(clean('startup ownership recovery: ' + error.message)); }
  if (admin && base && !stopped && report.fixtureRecordsRemoved !== true) await cleanupFixtures().catch(error => report.cleanupErrors.push(clean('fixtures: ' + error.message)));
  for (const [name, work] of [['browser', () => browser?.close()], ['nginx', () => cleanupRuntimeNginx()], ['api', () => !stopped && runtime && existsSync(join(runtime, 'isolated-run.json')) ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(name + ': ' + error.message)); } }
  if (runtime) try {
    const candidates = (await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim().split(/\r?\n/).filter(Boolean);
    for (const id of candidates) { assert.match(id, /^[a-f0-9]{12,64}$/); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', id])).stdout.trim(), runtime); await native('docker', ['rm', '--force', '--volumes', id]); await assert.rejects(() => native('docker', ['inspect', id])); }
    assert.equal((await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim(), ''); report.containerRemoved = true;
  } catch (error) { report.cleanupErrors.push(clean(error.message)); }
  if (base) { try { await fetch(new URL('/api/sysConfig/sysInfo', base), { signal: AbortSignal.timeout(2000) }); report.cleanupErrors.push('isolated API remains reachable'); } catch { report.apiStopped = true; } }
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true && report.nginxRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'coverage46-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/coverage46-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
