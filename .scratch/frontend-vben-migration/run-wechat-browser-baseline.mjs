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
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-api-postgresql-wechat-first-integration-no-mock', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'wechat-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/wechat-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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

// 由验收生成器在同一隔离宿主内组合；先创建并验证真实授权，再断言数据归属。
async function grantWechat(fixture, actions) {
  actions.forEach(action => assert.ok(['page', 'add', 'update', 'delete'].includes(action)));
  const codes = actions.map(action => 'sysWechatUser:' + action);
  const menuIds = codes.length ? (await sql("SELECT id FROM sysmenu WHERE permission IN ('" + codes.join("','") + "') ORDER BY id")).split(/\r?\n/).filter(Boolean) : [];
  assert.equal(menuIds.length, codes.length, '每个微信管理动作都有实际菜单权限');
  await api(admin, 'sysTenant/grantMenu', { id: fixture.id, menuIdList: menuIds });
  fixture.session = await api(admin, 'sysTenant/goTenant', { id: fixture.id });
  secret(fixture.session.accessToken); secret(fixture.session.refreshToken);
  const info = await api(fixture.session, 'sysAuth/userInfo', undefined, 'GET');
  assert.notEqual(info.accountType, 999);
  codes.forEach(code => assert.ok(info.buttons.includes(code), '真实操作者拥有 ' + code));
}
async function createWechatTenant(suffix, actions) {
  const account = prefix + '_' + suffix;
  const fixture = { account, name: account }; fixtures.push(fixture);
  await api(admin, 'sysTenant/add', { name: account, adminAccount: account, tenantType: 0, status: 1, enableReg: 2 });
  const parts = (await sql("SELECT t.id || '|' || t.userid FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account='" + account + "'")).split('|');
  assert.equal(parts.length, 2); parts.forEach(value => assert.match(value, /^[1-9]\d*$/));
  [fixture.id, fixture.userId] = parts;
  await grantWechat(fixture, actions);
  return fixture;
}
async function runWechatPermissions() {
  stage = 'wechat-real-permission-and-tenant-matrix';
  const editor = await createWechatTenant('editor', ['page', 'add', 'update', 'delete']);
  const other = await createWechatTenant('other', ['page', 'add', 'update', 'delete']);
  const reader = await createWechatTenant('reader', ['page']);
  const denied = await createWechatTenant('denied', []);
  const snapshot = () => sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM syswechatuser t");
  async function refuse(session, action, input, kind = true) {
    const before = await snapshot(); await api(session, 'sysWechatUser/' + action, input, 'POST', kind);
    assert.equal(await snapshot(), before, '被拒请求不得修改任意微信资料');
  }
  const draft = { userId: editor.userId, platformType: 1, openId: prefix + '_own_open', nickName: prefix + '_own' };
  await api(editor.session, 'sysWechatUser/add', draft);
  const ownPage = await api(editor.session, 'sysWechatUser/page', { nickName: draft.nickName, page: 1, pageSize: 100 });
  assert.equal(ownPage.items.length, 1);
  const own = ownPage.items[0]; createdIds.add(String(own.id));
  assert.equal(String(own.tenantId), editor.id);
  await api(other.session, 'sysWechatUser/add', { ...draft, userId: other.userId, openId: prefix + '_foreign_open', nickName: prefix + '_foreign' });
  const foreign = (await api(other.session, 'sysWechatUser/page', { nickName: prefix + '_foreign', page: 1, pageSize: 100 })).items[0];
  assert.ok(foreign); createdIds.add(String(foreign.id));
  assert.equal((await api(editor.session, 'sysWechatUser/page', { nickName: prefix + '_foreign', page: 1, pageSize: 100 })).total, 0);
  for (const [action, input] of [['page', { page: 1, pageSize: 20, tenantId: other.id }], ['add', { ...draft, userId: other.userId }], ['add', { ...draft, userId: 0 }], ['update', { ...foreign, nickName: prefix + '_forged' }], ['update', { ...own, userId: other.userId }], ['delete', { id: foreign.id }]]) await refuse(editor.session, action, input);
  for (const session of [undefined, denied.session]) for (const [action, input] of [['page', { page: 1, pageSize: 20 }], ['add', draft], ['update', own], ['delete', { id: own.id }]]) await refuse(session, action, input, 'auth');
  for (const [action, input] of [['add', { ...draft, userId: reader.userId }], ['update', own], ['delete', { id: own.id }]]) await refuse(reader.session, action, input, 'auth');
  await api(editor.session, 'sysWechatUser/update', { ...own, city: '本租户合法更新' });
  assert.equal(await sql('SELECT city FROM syswechatuser WHERE id=' + own.id), '本租户合法更新');
  await api(editor.session, 'sysWechatUser/delete', { id: own.id });
  assert.equal(await sql('SELECT count(*) FROM syswechatuser WHERE id=' + own.id), '0');
  assert.equal((await api(reader.session, 'sysWechatUser/page', { page: 1, pageSize: 20 })).total, 0);
  record('real-authorized-own-crud-cross-tenant-anonymous-ungranted-and-readonly-refusals');
  stage = 'wechat-platform-pagination-and-validation';
  for (const platformType of [1, 2, 3, 4, 5]) {
    await api(editor.session, 'sysWechatUser/add', { ...draft, platformType, openId: prefix + '_platform_' + platformType, nickName: prefix + '_platform_' + platformType, sex: 0 });
    const filtered = await api(editor.session, 'sysWechatUser/page', { nickName: prefix + '_platform_', platformType, page: 1, pageSize: 20 });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].platformType, platformType);
    createdIds.add(String(filtered.items[0].id));
  }
  const pagedIds = new Set();
  for (const pageNumber of [1, 2, 3]) {
    const result = await api(editor.session, 'sysWechatUser/page', { nickName: prefix + '_platform_', page: pageNumber, pageSize: 2 });
    assert.equal(result.total, 5);
    assert.equal(result.items.length, pageNumber === 3 ? 1 : 2);
    for (const item of result.items) { assert.ok(!pagedIds.has(String(item.id))); pagedIds.add(String(item.id)); }
  }
  assert.equal(pagedIds.size, 5);
  for (const change of [{ openId: '' }, { openId: 'x'.repeat(65) }, { platformType: 99 }, { sex: 3 }, { avatar: 'javascript:alert(1)' }, { mobile: '1'.repeat(17) }]) await refuse(editor.session, 'add', { ...draft, ...change });
  for (const input of [{ page: 0, pageSize: 20 }, { page: 1, pageSize: 201 }, { page: 1, pageSize: 20, platformType: 99 }]) await refuse(editor.session, 'page', input);
  record('real-platform-enums-filter-pagination-and-invalid-input-refusals');
  return { editor, other, reader, denied };
}

async function cleanupWechatTenants() {
  const failures = [];
  const attempt = async (label, work) => { try { return await work(); } catch (error) { failures.push(clean(label + ': ' + error.message)); } };
  // 新增接口失败也可能留下部分关联，按唯一账号恢复本次拥有的租户 ID。
  for (const fixture of fixtures) if (!fixture.id) await attempt('recover tenant', async () => {
    const value = await sql("SELECT DISTINCT t.id FROM systenant t WHERE t.userid IN (SELECT id FROM sysuser WHERE account=" + quote(fixture.account) + ") OR t.id IN (SELECT tenantid FROM sysorg WHERE name=" + quote(fixture.name) + ")");
    if (value) { assert.match(value, /^[1-9]\d*$/); fixture.id = value; }
  });
  const ids = fixtures.filter(item => item.id).map(item => item.id);
  ids.forEach(id => assert.match(id, /^[1-9]\d*$/));
  const predicate = ids.join(',') || '-1';
  const ownership = await attempt('snapshot associations', async () => {
    const roles = (await sql('SELECT id FROM sysrole WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean);
    const users = (await sql('SELECT id FROM sysuser WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean);
    [...roles, ...users].forEach(id => assert.match(id, /^[1-9]\d*$/));
    return { roles: roles.join(',') || '-1', users: users.join(',') || '-1' };
  });
  for (const fixture of [...fixtures].reverse()) if (fixture.id) await attempt('remove tenant', async () => {
    if (Number(await sql('SELECT count(*) FROM systenant WHERE id=' + fixture.id))) await api(admin, 'sysTenant/delete', { id: fixture.id });
  });
  for (const table of ['systenant', 'sysuser', 'sysorg', 'sysrole', 'syspos', 'systenantmenu', 'systenantconfigdata']) await attempt('residue ' + table, async () => {
    assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + (table === 'systenant' ? 'id' : 'tenantid') + ' IN (' + predicate + ')'), '0');
  });
  if (ownership) for (const [table, column, set] of [['sysrolemenu','roleid',ownership.roles], ['sysuserrole','userid',ownership.users], ['sysuserrole','roleid',ownership.roles], ['sysuserextorg','userid',ownership.users], ['sysusermenu','userid',ownership.users], ['sysuserconfigdata','userid',ownership.users], ['sysroleorg','roleid',ownership.roles]]) await attempt('residue ' + table + ':' + column, async () => assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + column + ' IN (' + set + ')'), '0'));
  await attempt('account residue', async () => assert.equal(await sql("SELECT count(*) FROM sysuser WHERE starts_with(account, '" + prefix + "')"), '0'));
  await attempt('organization residue', async () => assert.equal(await sql("SELECT count(*) FROM sysorg WHERE starts_with(name, '" + prefix + "')"), '0'));
  assert.deepEqual(failures, []);
  fixtures.length = 0;
  report.tenantFixturesRemoved = true;
}
// 首轮真实集成：桌面新增、数据库持久化、资料清空与删除；权限矩阵另行扩展。
async function runWechat() {
  stage = 'wechat-production-login';
  initialTemplateDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM syswechatuser t");
  await runWechatPermissions();
  proxy = await startProductionProxy(join(root, 'Web/dist'), base);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  const errors = [];
  let addRequests = 0;
  page.on('request', request => { if (new URL(request.url()).pathname === '/prod-api/api/sysWechatUser/add' && request.method() === 'POST') addRequests++; });
  page.on('pageerror', error => errors.push(clean(error.message)));
  page.on('request', request => { const token = request.headers().authorization; if (token) secret(token.replace(/^Bearer /, '')); });
  page.on('response', response => { for (const key of ['access-token', 'x-access-token']) secret(response.headers()[key]); });
  const isApi = name => response => new URL(response.url()).pathname === '/prod-api/api/sysWechatUser/' + name && response.request().method() === 'POST';
  const [first] = await Promise.all([page.waitForResponse(isApi('page')), page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fsystem%2FweChatUser')]);
  assert.equal(first.status(), 200); assert.equal((await first.json()).code, 200);
  const panel = page.locator('.wechat-page'); await expect(panel).toBeVisible();
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
  assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  record('production-desktop-real-wechat-page');
  stage = 'wechat-browser-create';
  await panel.getByRole('button', { name: '新增微信用户', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新增微信用户', exact: true });
  await dialog.locator('#wechat-editor_openId').fill(prefix + '_open');
  await dialog.getByRole('textbox', { name: '昵称', exact: true }).fill(prefix);
  await dialog.getByRole('textbox', { name: '城市', exact: true }).fill('测试城市');
  await dialog.locator('#wechat-editor_avatar').fill('/favicon.ico');
  const [added] = await Promise.all([page.waitForResponse(isApi('add')), dialog.getByRole('button', { name: '保存资料', exact: true }).click({ clickCount: 2 })]);
  assert.equal(added.status(), 200); assert.equal((await added.json()).code, 200);
  await expect(dialog).toBeHidden();
  const rows = await api(admin, 'sysWechatUser/page', { nickName: prefix, page: 1, pageSize: 100 });
  const browserRows = rows.items.filter(row => row.nickName === prefix && row.openId === prefix + '_open');
  assert.equal(browserRows.length, 1);
  assert.equal(addRequests, 1, '连续双击保存仅发送一次真实新增请求');
  const saved = browserRows[0]; createdIds.add(String(saved.id));
  for (const key of ['sessionKey', 'accessToken', 'refreshToken', 'expiresIn', 'scope']) assert.equal(Object.hasOwn(saved, key), false);
  assert.equal(await sql('SELECT city FROM syswechatuser WHERE id=' + saved.id), '测试城市');
  // 仅为本次已登记测试记录设置虚构认证字段，建立非空保留前提；业务修改仍走真实 API。
  assert.match(String(saved.id), /^[1-9]\d*$/);
  await sql("UPDATE syswechatuser SET sessionkey='fixture-session', accesstoken='fixture-access', refreshtoken='fixture-refresh', expiresin=7200, scope='fixture-scope' WHERE id=" + saved.id + " AND nickname='" + prefix + "'");
  assert.equal(await sql("SELECT count(*) FROM syswechatuser WHERE id=" + saved.id + " AND sessionkey='fixture-session' AND accesstoken='fixture-access' AND refreshtoken='fixture-refresh'"), '1');
  const credentials = await sql('SELECT md5(row(sessionkey,accesstoken,refreshtoken,expiresin,scope,createtime,createuserid)::text) FROM syswechatuser WHERE id=' + saved.id);
  record('browser-created-profile-persisted-without-credential-response');
  stage = 'wechat-profile-clear';
  await api(admin, 'sysWechatUser/update', { ...saved, city: null, nickName: prefix + '_edited', accessToken: 'ignored-extra-field' });
  assert.equal(await sql('SELECT city IS NULL FROM syswechatuser WHERE id=' + saved.id), 't');
  assert.equal(await sql('SELECT md5(row(sessionkey,accesstoken,refreshtoken,expiresin,scope,createtime,createuserid)::text) FROM syswechatuser WHERE id=' + saved.id), credentials);
  record('real-update-clears-optional-value-preserves-credentials-and-create-audit');
  await panel.locator('#wechat-query_nickName').fill(prefix);
  const [listed] = await Promise.all([page.waitForResponse(isApi('page')), panel.locator('button[type="submit"]').click()]);
  assert.equal((await listed.json()).code, 200);
  const row = panel.getByRole('row').filter({ hasText: prefix + '_edited' }); await expect(row).toBeVisible();
  const avatar = row.locator('img');
  await expect(avatar).toBeVisible();
  await expect.poll(() => avatar.evaluate(image => image.complete && image.naturalWidth > 0)).toBe(true);
  record('real-avatar-resource-renders-and-double-submit-is-prevented');
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '38-wechat-list.png'), fullPage: true, animations: 'disabled' });
  await row.getByRole('button', { name: /^编\s*辑$/ }).click();
  const edit = page.getByRole('dialog', { name: '编辑微信用户', exact: true });
  await expect(edit.getByRole('textbox', { name: '城市', exact: true })).toHaveValue('');
  await page.screenshot({ path: join(evidence, '38-wechat-editor.png'), fullPage: true, animations: 'disabled' });
  await edit.locator('#wechat-editor_city').fill('桌面编辑城市');
  const [updated] = await Promise.all([page.waitForResponse(isApi('update')), edit.getByRole('button', { name: '保存资料', exact: true }).click()]);
  assert.equal((await updated.json()).code, 200);
  await expect(edit).toBeHidden();
  assert.equal(await sql('SELECT city FROM syswechatuser WHERE id=' + saved.id), '桌面编辑城市');
  assert.equal(await sql('SELECT md5(row(sessionkey,accesstoken,refreshtoken,expiresin,scope,createtime,createuserid)::text) FROM syswechatuser WHERE id=' + saved.id), credentials);
  record('browser-edit-persists-profile-and-retains-nonempty-credentials');
  await row.getByRole('button', { name: /^删\s*除$/ }).click();
  const removal = page.getByRole('dialog', { name: '删除微信用户', exact: true });
  const [deleted] = await Promise.all([page.waitForResponse(isApi('delete')), removal.getByRole('button', { name: '确认删除', exact: true }).click()]);
  assert.equal((await deleted.json()).code, 200);
  await expect(removal).toBeHidden();
  assert.equal(await sql('SELECT count(*) FROM syswechatuser WHERE id=' + saved.id), '0');
  record('browser-delete-confirmation-persisted');
  await cleanupFixtures();
  stage = 'wechat-stopped-api-draft';
  await panel.getByRole('button', { name: '新增微信用户', exact: true }).click();
  await dialog.locator('#wechat-editor_openId').fill(prefix + '_offline');
  await stop();
  const [failed] = await Promise.all([page.waitForResponse(isApi('add')), dialog.getByRole('button', { name: '保存资料', exact: true }).click()]);
  assert.ok(failed.status() >= 500);
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.locator('#wechat-editor_openId')).toHaveValue(prefix + '_offline');
  await expect(dialog.getByRole('button', { name: '保存资料', exact: true })).toBeEnabled();
  await page.screenshot({ path: join(evidence, '38-wechat-offline.png'), fullPage: true, animations: 'disabled' });
  assert.deepEqual(errors, []);
  record('real-stopped-api-keeps-draft-and-restores-submit');
}
async function cleanupWechatProfiles() {
  const owned = await api(admin, 'sysWechatUser/page', { nickName: prefix, page: 1, pageSize: 100 });
  assert.ok(owned.total <= 100 && owned.items.every(row => row.nickName.startsWith(prefix)));
  const failures = [];
  for (const row of owned.items) try { await api(admin, 'sysWechatUser/delete', { id: row.id }); } catch (error) { failures.push(clean(error.message)); }
  assert.deepEqual(failures, []);
  assert.equal(await sql("SELECT count(*) FROM syswechatuser WHERE starts_with(nickname, '" + prefix + "')"), '0');
  if (initialTemplateDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM syswechatuser t"), initialTemplateDigest);
  report.fixtureRecordsRemoved = true;
}



async function cleanupFixtures() {
  const errors = [];
  report.fixtureRecordsRemoved = false;
  for (const [label, work] of [['profiles', cleanupWechatProfiles], ['tenants', cleanupWechatTenants]]) {
    try { await work(); } catch (error) { errors.push(clean(label + ': ' + error.message)); }
  }
  report.fixtureRecordsRemoved = errors.length === 0 && report.tenantFixturesRemoved === true;
  assert.deepEqual(errors, []);
}
try {
  const port = Number(process.argv[2] ?? 5038); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-SdkFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/wechat-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], { windowsHide: true, timeout: 330000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runWechat(); report.passed = true;
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
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'wechat-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/wechat-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
