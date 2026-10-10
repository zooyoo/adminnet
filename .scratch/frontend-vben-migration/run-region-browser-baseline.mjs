import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
const prefix = 'region_' + randomBytes(5).toString('hex');
const baselinePrefix = 'baseline_' + randomBytes(5).toString('hex');
const runtimeMarkerPath = join(root, '.scratch/frontend-vben-migration/region-startup-runtime-' + randomBytes(16).toString('hex') + '.json');
const secrets = [], fixtures = [], createdIds = new Set(), requestCounts = new Map();
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql-region-management', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialRegionDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'region-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/region-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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
  const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim();
  secret(password); const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secret(session.accessToken); secret(session.refreshToken); return session;
}

function quote(value) { return "'" + String(value).replaceAll("'", "''") + "'"; }
async function native(program, args, timeout = 30000) {
  const script = "$ErrorActionPreference = 'Stop'\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n& " + quote(program) + ' ' + args.map(quote).join(' ') + "\nif ($LASTEXITCODE -ne 0) { throw 'Native command failed' }";
  return execute('pwsh', ['-NoProfile', '-Command', script], { windowsHide: true, timeout, maxBuffer: 1024 * 1024 * 8 });
}
async function sql(statement) { assert.match(pg.containerName, /^[a-zA-Z0-9_-]+$/); const { stdout } = await native('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement]); return stdout.trim(); }
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
async function grant(fixture, permissions) {
  const menuIds = (await sql("SELECT id FROM sysmenu WHERE permission IN ('" + permissions.join("','") + "') ORDER BY id")).split(/\r?\n/).filter(Boolean); assert.equal(menuIds.length, permissions.length);
  await api(admin, 'sysTenant/grantMenu', { id: fixture.id, menuIdList: menuIds }); fixture.session = await api(admin, 'sysTenant/goTenant', { id: fixture.id }); secret(fixture.session.accessToken); secret(fixture.session.refreshToken);
  const info = await api(fixture.session, 'sysAuth/userInfo', undefined, 'GET'); assert.notEqual(info.accountType, 999); for (const permission of permissions) assert.ok(info.buttons.includes(permission)); return info;
}
async function createTenant(suffix) {
  const account = prefix + '_' + suffix, fixture = { account, name: account }; fixtures.push(fixture);
  await api(admin, 'sysTenant/add', { name: account, adminAccount: account, tenantType: 0, status: 1, enableReg: 2 });
  const parts = (await sql("SELECT t.id || '|' || t.userid || '|' || u.orgid FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account='" + account + "'")).split('|'); assert.equal(parts.length, 3); parts.forEach(value => assert.match(value, /^\d+$/));
  [fixture.id, fixture.userId, fixture.orgId] = parts; await grant(fixture, ['sysRegion:page', 'sysRegion:add', 'sysRegion:update', 'sysRegion:delete']); return fixture;
}
async function rows(session = admin, query = {}) { return api(session, 'sysRegion/page', { page: 1, pageSize: 100, name: prefix, ...query }); }
async function row(name, session = admin) { const found = (await rows(session)).items.find(item => item.name === name); assert.ok(found, 'fixture region is readable'); return found; }
async function add(input, session = admin) {
  const returned = await api(session, 'sysRegion/add', { orderNo: 100, pid: 0, ...input });
  const actual = await sql("SELECT id FROM sysregion WHERE name='" + input.name + "' AND code='" + input.code.trim() + "'"); assert.match(actual, /^\d+$/); assert.equal(String(returned), actual, 'snowflake ID must roundtrip without losing precision'); createdIds.add(actual); return row(input.name, session);
}
async function originalSnapshot() { return sql("SELECT count(*) || '|' || md5(coalesce(string_agg(row_to_json(r)::text, '|' ORDER BY id), '')) FROM sysregion r WHERE NOT starts_with(name, '" + prefix + "')"); }
async function prepareOriginalBaseline() {
  initialRegionDigest = await originalSnapshot();
  report.initialRegionCount = Number(initialRegionDigest.split('|')[0]);
  report.initialRegionDigest = initialRegionDigest.split('|')[1];
  if (report.initialRegionCount === 0) {
    assert.deepEqual(await api(admin, 'sysRegion/tree', undefined, 'GET'), []);
    const insert = async input => {
      const id = await api(admin, 'sysRegion/add', { orderNo: 1, pid: 0, ...input });
      assert.match(String(id), /^\d+$/);
      assert.equal(await sql("SELECT id::text FROM sysregion WHERE name='" + input.name + "'"), String(id));
      return String(id);
    };
    const province = await insert({ name: baselinePrefix + '_原有四川省', code: '510000', shortName: '川', mergerName: '中国,四川省', zipCode: '610000', cityCode: '028', level: 1, pinYin: 'SiChuan', lng: 104.06, lat: 30.67, remark: '隔离库的既有基线数据，业务操作不得更改' });
    const city = await insert({ name: baselinePrefix + '_原有成都市', code: '510100', pid: province, orderNo: 2, shortName: '蓉', mergerName: '中国,四川省,成都市', zipCode: '610000', cityCode: '028', level: 2, pinYin: 'ChengDu', lng: 104.06, lat: 30.67 });
    await insert({ name: baselinePrefix + '_原有锦江区', code: '510104', pid: city, orderNo: 3, shortName: '锦江', zipCode: '610021', level: 3, pinYin: 'JinJiang', lng: 104.08, lat: 30.66 });
    await insert({ name: baselinePrefix + '_原有北京市', code: '110000', orderNo: 4, shortName: '京', zipCode: '100000', cityCode: '010', level: 1, pinYin: 'BeiJing', lng: 116.4, lat: 39.9 });
    report.preexistingBaselinePreparedThroughApi = true;
    report.preparedBaselineCount = 4;
    record('empty-isolated-region-store-prepared-through-real-api-as-nonempty-preexisting-hierarchy');
  }
  originalDigest = await originalSnapshot();
  report.originalRegionCount = Number(originalDigest.split('|')[0]);
  assert.ok(report.originalRegionCount > 0, 'region preservation must compare a nonempty preexisting baseline');
}
async function removePreparedBaseline() {
  const roots = (await sql("SELECT id::text FROM sysregion WHERE starts_with(name, '" + baselinePrefix + "') AND pid=0 ORDER BY id")).split(/\r?\n/).filter(Boolean);
  for (const id of roots) {
    assert.match(id, /^\d+$/);
    const tree = await api(admin, 'sysRegion/tree', undefined, 'GET');
    const owned = flatten(tree).find(item => String(item.id) === id);
    assert.ok(owned && flatten([owned]).every(item => item.name.startsWith(baselinePrefix)), 'baseline cascade owns every descendant');
    await api(admin, 'sysRegion/delete', { id });
  }
  assert.equal(await sql("SELECT count(*) FROM sysregion WHERE starts_with(name, '" + baselinePrefix + "')"), '0');
  report.preparedBaselineRecordsRemoved = true;
  if (initialRegionDigest !== undefined) {
    const final = await originalSnapshot();
    assert.equal(final, initialRegionDigest, 'all original rows are restored after removing only prepared baseline data');
    report.finalInitialRegionDigest = final.split('|')[1];
    report.initialRegionsRestored = true;
  }
}
async function fixtureSnapshot() { return sql("SELECT md5(coalesce(string_agg(row_to_json(r)::text, '|' ORDER BY id), '')) FROM sysregion r WHERE starts_with(name, '" + prefix + "')"); }
async function fixtureRowRecords() { const value = await sql("SELECT coalesce(json_agg(json_build_object('id', id::text, 'record', row_to_json(r)::text) ORDER BY id), '[]'::json) FROM sysregion r WHERE starts_with(name, '" + prefix + "')"); return JSON.parse(value); }
async function expectUnchanged(work) { const before = await fixtureSnapshot(); await work(); assert.equal(await fixtureSnapshot(), before, 'refused operation preserves every fixture field'); assert.equal(await originalSnapshot(), originalDigest); }
function flatten(nodes) { return nodes.flatMap(node => [node, ...flatten(node.children ?? [])]); }
async function cleanupFixtures() {
  const failures = [], attempt = async (label, work) => { try { return await work(); } catch (error) { failures.push(clean(label + ': ' + error.message)); } };
  const owned = await attempt('enumerate regions', () => rows());
  if (owned) { assert.ok(owned.total <= 100, 'cleanup must see every fixture'); assert.ok(owned.items.every(item => item.name.startsWith(prefix)), 'cleanup owns selected regions');
    for (const item of owned.items) await attempt('region ' + item.id, async () => { const id = String(item.id); assert.match(id, /^\d+$/); if (Number(await sql('SELECT count(*) FROM sysregion WHERE id=' + id))) await api(admin, 'sysRegion/delete', { id }); });
  }
  const ownership = await attempt('tenant ownership snapshot', async () => {
    for (const item of fixtures) if (!item.id) { const id = await sql("SELECT DISTINCT t.id FROM systenant t WHERE t.userid IN (SELECT id FROM sysuser WHERE account='" + item.account + "') OR t.id IN (SELECT tenantid FROM sysorg WHERE name='" + item.name + "')"); if (id) { assert.match(id, /^\d+$/); item.id = id; } }
    const ids = fixtures.filter(item => item.id).map(item => item.id); ids.forEach(id => assert.match(id, /^\d+$/)); const predicate = ids.length ? ids.join(',') : '-1';
    const roles = (await sql('SELECT id FROM sysrole WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean); const users = (await sql('SELECT id FROM sysuser WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean); roles.concat(users).forEach(id => assert.match(id, /^\d+$/)); return { ids: predicate, roles: roles.join(',') || '-1', users: users.join(',') || '-1' };
  });
  for (const item of [...fixtures].reverse()) if (item.id) await attempt('tenant ' + item.id, async () => { if (Number(await sql('SELECT count(*) FROM systenant WHERE id=' + item.id))) await api(admin, 'sysTenant/delete', { id: item.id }); });
  await attempt('region residue', async () => assert.equal(Number(await sql("SELECT count(*) FROM sysregion WHERE starts_with(name, '" + prefix + "')")), 0));
  await attempt('original region digest', async () => { if (originalDigest !== undefined) { const final = await originalSnapshot(); assert.equal(final, originalDigest, 'original regions stay byte-for-byte unchanged'); report.originalRegionDigest = originalDigest.split('|')[1]; report.finalOriginalRegionDigest = final.split('|')[1]; report.originalRegionsUnchanged = true; } });
  await attempt('tenant relationship residue', async () => {
    assert.ok(ownership, 'fixture tenant ownership is available'); const counts = {};
    for (const table of ['systenant', 'sysuser', 'sysorg', 'sysrole', 'syspos', 'systenantmenu']) { const column = table === 'systenant' ? 'id' : 'tenantid'; counts[table] = Number(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + column + ' IN (' + ownership.ids + ')')); assert.equal(counts[table], 0, table + ' has no fixture records'); }
    for (const [table, column, ids] of [['sysrolemenu', 'roleid', ownership.roles], ['sysuserrole', 'userid', ownership.users], ['sysuserrole', 'roleid', ownership.roles]]) { const key = table + ':' + column; counts[key] = Number(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + column + ' IN (' + ids + ')')); assert.equal(counts[key], 0, key + ' has no fixture records'); }
    assert.equal(Number(await sql("SELECT count(*) FROM sysuser WHERE starts_with(account, '" + prefix + "')")), 0); assert.equal(Number(await sql("SELECT count(*) FROM sysorg WHERE starts_with(name, '" + prefix + "')")), 0); report.fixtureResidueCounts = counts;
  });
  await attempt('prepared baseline and initial database restoration', removePreparedBaseline);
  if (failures.length) throw new Error(failures.join('; ')); fixtures.length = 0; report.fixtureRecordsRemoved = true; record('fixture-regions-tenants-users-organizations-roles-positions-and-grants-removed-original-snapshot-preserved');
}
function recoverStartupOwnership() {
  if (!runtime && existsSync(runtimeMarkerPath)) { const handoff = JSON.parse(readFileSync(runtimeMarkerPath, 'utf8').replace(/^\uFEFF/, '')); runtime = realpathSync(handoff.runtimeRoot); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/); base = new URL(handoff.baseUrl); assert.equal(base.hostname, '127.0.0.1'); evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); }
  if (runtime && existsSync(join(runtime, 'isolated-run.json'))) { marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); }
  if (runtime && existsSync(join(runtime, 'isolated-postgres.json'))) { pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(pg.runtimeRoot, runtime); }
}
async function stable() { await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 }); await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).length)).toBe(0); await page.mouse.move(300, 100); }
async function shot(name, target) { await stable(); await page.locator('.region-page').evaluate(element => { for (let item = element; item; item = item.parentElement) { if (item.scrollHeight > item.clientHeight) item.scrollTop = 0; if (item.scrollWidth > item.clientWidth) item.scrollLeft = 0; } for (const child of element.querySelectorAll('*')) if (child.scrollWidth > child.clientWidth) child.scrollLeft = 0; }); const options = { path: join(evidence, name), mask: secrets.map(value => page.getByText(value, { exact: true })) }; if (target) await target.screenshot(options); else await page.screenshot({ ...options, fullPage: true }); }
async function theme(mode) { if (((await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')) !== (mode === 'dark')) await page.locator('button.theme-toggle').click(); await expect.poll(async () => (await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')).toBe(mode === 'dark'); }
function apiPath(url) { return new URL(url).pathname.replace(/^\/prod-api(?=\/)/, ''); }
async function uiCall(action, work, refused = false) { const [response] = await Promise.all([page.waitForResponse(r => apiPath(r.url()) === '/api/sysRegion/' + action && r.request().method() === 'POST'), work()]); assert.ok(response.ok(), action + ' HTTP ' + response.status()); const envelope = await response.json(); if (refused) { assert.ok(![200, 401, 403].includes(envelope.code), action + ' must fail business validation'); assert.equal(envelope.type, 'error'); assert.ok(envelope.result == null); } else assert.equal(envelope.code, 200, clean(envelope.message ?? action)); return envelope.result; }
async function verifyDesktopPermissions(editor, reader, denied) {
  for (const [fixture, mode] of [[editor, 'editor'], [reader, 'reader'], [denied, 'denied']]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    try {
      const permissionPage = await context.newPage(), regionRequests = []; permissionPage.on('request', request => { if (apiPath(request.url()).startsWith('/api/sysRegion/')) regionRequests.push(apiPath(request.url())); });
      await permissionPage.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(fixture.session.accessToken) + '&redirect=%2Fsystem%2Fregion');
      if (mode !== 'denied') {
        const panel = permissionPage.locator('.region-page'); await expect(panel).toHaveCount(1); await expect(panel).toBeVisible(); await expect(panel.getByRole('table')).toBeVisible();
        await expect(panel.getByRole('button', { name: '新增区域', exact: true })).toHaveCount(mode === 'editor' ? 1 : 0);
        if (mode === 'editor') { await panel.getByRole('button', { name: '新增区域', exact: true }).click(); const dialog = permissionPage.getByRole('dialog', { name: '添加行政区域', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByRole('button', { name: '取消', exact: true }).click(); }
        else { await expect(panel.getByRole('button', { name: '编辑', exact: true })).toHaveCount(0); await expect(panel.getByRole('button', { name: '删除', exact: true })).toHaveCount(0); }
        assert.ok(regionRequests.includes('/api/sysRegion/page'), mode + ' renders real authorized data');
      } else {
        await expect.poll(() => new URL(permissionPage.url()).hash).not.toContain('/login'); await permissionPage.waitForTimeout(500);
        await expect(permissionPage.getByRole('button', { name: '新增区域', exact: true })).toHaveCount(0); assert.equal(regionRequests.filter(path => ['/api/sysRegion/page', '/api/sysRegion/add', '/api/sysRegion/update', '/api/sysRegion/delete'].includes(path)).length, 0, 'denied browser never calls protected region endpoints');
      }
    } finally { await context.close(); }
  }
  record('production-browser-real-non-superadmin-editor-readonly-and-ungranted-permission-boundaries');
}
async function runBrowser(editor, parent, reader, denied) {
  proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(clean(error.message))); page.on('request', request => { const path = apiPath(request.url()).match(/\/api\/sysRegion\/[^/]+$/)?.[0]; if (path) requestCounts.set(path, (requestCounts.get(path) ?? 0) + 1); });
  await verifyDesktopPermissions(editor, reader, denied);
  await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fplatform%2Fregion'); const panel = page.locator('.region-page'); await expect(panel).toHaveCount(1); await expect(panel).toBeVisible();
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0); assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  await panel.getByRole('textbox', { name: '筛选区域树', exact: true }).fill(parent.name); const navigation = panel.getByLabel('区域导航', { exact: true }); await navigation.getByText(parent.name, { exact: true }).click();
  await panel.getByRole('button', { name: '新增区域', exact: true }).click(); let dialog = page.getByRole('dialog', { name: '添加行政区域', exact: true }); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('textbox', { name: '上级行政', exact: true })).toHaveValue(new RegExp(parent.name));
  const name = prefix + '_browser_child', code = parent.code + '777'; await dialog.getByRole('textbox', { name: '行政名称', exact: true }).fill(name); await dialog.getByRole('textbox', { name: '行政代码', exact: true }).fill(code); await dialog.getByRole('textbox', { name: '区号', exact: true }).fill('021'); await dialog.getByRole('spinbutton', { name: '排序', exact: true }).fill('4'); await dialog.getByRole('textbox', { name: '备注', exact: true }).fill('真实区域维护\n保留原有层级'); await shot('32-region-editor.png', dialog);
  const addsBefore = requestCounts.get('/api/sysRegion/add') ?? 0; await uiCall('add', () => dialog.getByRole('button', { name: '保存', exact: true }).click()); assert.equal(requestCounts.get('/api/sysRegion/add'), addsBefore + 1, 'browser request counter must observe the real proxy prefix'); await expect(dialog).toBeHidden(); await expect(panel.getByRole('table').getByRole('row').filter({ hasText: name })).toHaveCount(1); let current = await row(name, editor.session); createdIds.add(String(current.id)); assert.equal(String(current.pid), String(parent.id)); assert.equal(current.code, code); assert.equal(current.orderNo, 4); assert.equal(await sql('SELECT count(*) FROM sysregion WHERE id=' + current.id + " AND citycode='021' AND pid=" + parent.id), '1'); record('production-browser-selected-parent-add-save-refresh-and-postgresql-persistence');
  await panel.getByRole('button', { name: '重置', exact: true }).click(); await panel.getByRole('textbox', { name: '查询行政名称', exact: true }).fill(prefix); await uiCall('page', () => panel.getByRole('button', { name: '查询', exact: true }).click()); await expect(panel.getByRole('table').getByRole('row').filter({ hasText: name })).toHaveCount(1); await theme('light'); await shot('32-region-light.png'); await theme('dark'); await shot('32-region-dark.png');
  let tableRow = panel.getByRole('table').getByRole('row').filter({ hasText: name }); await tableRow.getByRole('button', { name: '编辑', exact: true }).click(); dialog = page.getByRole('dialog', { name: '编辑行政区域', exact: true }); await expect(dialog).toBeVisible(); await dialog.getByRole('textbox', { name: '行政代码', exact: true }).fill('12345'); const saves = requestCounts.get('/api/sysRegion/update') ?? 0; await dialog.getByRole('button', { name: '保存', exact: true }).click(); await expect(dialog).toBeVisible(); await expect(dialog.getByText(/6.*9.*12/)).toBeVisible(); assert.equal(requestCounts.get('/api/sysRegion/update') ?? 0, saves);
  await dialog.getByRole('textbox', { name: '行政代码', exact: true }).fill(code); await dialog.getByRole('textbox', { name: '行政名称', exact: true }).fill(parent.name); await dialog.getByRole('textbox', { name: '行政代码', exact: true }).fill(parent.code); const beforeFailure = await fixtureSnapshot(); await uiCall('update', () => dialog.getByRole('button', { name: '保存', exact: true }).click(), true); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('textbox', { name: '行政名称', exact: true })).toHaveValue(parent.name); await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled(); assert.equal(await fixtureSnapshot(), beforeFailure); await shot('32-region-save-failure.png', dialog);
  await dialog.getByRole('textbox', { name: '行政名称', exact: true }).fill(name + '_updated'); await dialog.getByRole('textbox', { name: '行政代码', exact: true }).fill(code); await dialog.getByRole('textbox', { name: '备注', exact: true }).fill('修改后仍可重开\n中文内容不丢失'); await uiCall('update', () => dialog.getByRole('button', { name: '保存', exact: true }).click()); await expect(dialog).toBeHidden(); current = await row(name + '_updated'); tableRow = panel.getByRole('table').getByRole('row').filter({ hasText: name + '_updated' }); await expect(tableRow).toHaveCount(1); await tableRow.getByRole('button', { name: '编辑', exact: true }).click(); dialog = page.getByRole('dialog', { name: '编辑行政区域', exact: true }); await expect(dialog.getByRole('textbox', { name: '备注', exact: true })).toHaveValue('修改后仍可重开\n中文内容不丢失'); await dialog.getByRole('button', { name: '取消', exact: true }).click(); record('production-browser-invalid-code-and-real-duplicate-failure-retain-draft-update-reopens-losslessly');
  await stable(); const deletes = requestCounts.get('/api/sysRegion/delete') ?? 0; await tableRow.getByRole('button', { name: '删除', exact: true }).click(); let confirm = page.getByRole('dialog', { name: '删除行政区域', exact: true }); await expect(confirm).toBeVisible(); await confirm.getByRole('button', { name: '取消', exact: true }).click(); await expect(confirm).toBeHidden(); assert.equal(requestCounts.get('/api/sysRegion/delete') ?? 0, deletes); assert.equal(await sql('SELECT count(*) FROM sysregion WHERE id=' + current.id), '1'); await tableRow.getByRole('button', { name: '删除', exact: true }).click(); confirm = page.getByRole('dialog', { name: '删除行政区域', exact: true }); await uiCall('delete', () => confirm.getByRole('button', { name: '确认删除', exact: true }).click()); await expect(confirm).toBeHidden(); assert.equal(requestCounts.get('/api/sysRegion/delete'), deletes + 1); assert.equal(await sql('SELECT count(*) FROM sysregion WHERE id=' + current.id), '0'); createdIds.delete(String(current.id)); record('production-browser-delete-cancel-sends-zero-requests-confirm-removes-real-record');
  const documentMarker = randomBytes(8).toString('hex');
  await page.evaluate(value => document.documentElement.setAttribute('data-region-baseline-document', value), documentMarker);
  await page.evaluate(() => { location.hash = '#/system/region'; });
  await expect(panel).toHaveCount(1); await expect(panel).toBeVisible();
  const readsBeforeDeparture = requestCounts.get('/api/sysRegion/page') ?? 0;
  await page.evaluate(() => { location.hash = '#/platform/cache'; });
  await expect(page.getByRole('textbox', { name: '筛选缓存键', exact: true })).toBeVisible();
  await expect(panel).toBeHidden();
  const inactiveCount = [...requestCounts.values()].reduce((a,b) => a+b,0);
  await page.waitForTimeout(700);
  assert.equal([...requestCounts.values()].reduce((a,b) => a+b,0), inactiveCount);
  await page.evaluate(() => { location.hash = '#/system/region'; });
  await expect(panel).toHaveCount(1); await expect(panel).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('data-region-baseline-document', documentMarker);
  await expect.poll(() => requestCounts.get('/api/sysRegion/page') ?? 0).toBeGreaterThan(readsBeforeDeparture);
  await expect(page.getByRole('dialog', { name: /行政区域/ })).toHaveCount(0);
  record('production-browser-canonical-alias-and-same-document-leave-reenter-release-observation');
  await panel.getByRole('button', { name: '根节点', exact: true }).click(); await panel.getByRole('button', { name: '新增区域', exact: true }).click(); dialog = page.getByRole('dialog', { name: '添加行政区域', exact: true }); await dialog.getByRole('textbox', { name: '行政名称', exact: true }).fill(prefix + '_stopped'); await dialog.getByRole('textbox', { name: '行政代码', exact: true }).fill('987654'); await cleanupFixtures(); await stop(); const [response] = await Promise.all([page.waitForResponse(r => apiPath(r.url()) === '/api/sysRegion/add'), dialog.getByRole('button', { name: '保存', exact: true }).click()]); assert.ok(response.status() >= 500); assert.equal(await sql("SELECT count(*) FROM sysregion WHERE name='" + prefix + "_stopped'"), '0'); assert.equal(await originalSnapshot(), initialRegionDigest); assert.equal(report.initialRegionsRestored, true); await expect(dialog).toBeVisible(); await expect(dialog.getByRole('textbox', { name: '行政名称', exact: true })).toHaveValue(prefix + '_stopped'); await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled(); await expect(dialog.getByRole('alert')).toBeVisible(); await shot('32-region-stopped-api.png', dialog); assert.deepEqual(errors, []); record('production-browser-real-api-stop-failure-keeps-editable-draft-no-false-success');
}

try {
  const port = Number(process.argv[2] ?? 5032); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-RegionFixture', '-RuntimeMarkerPath', runtimeMarkerPath], { windowsHide: true, timeout: 330000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET'); const config = JSON.parse(readFileSync(join(runtime, 'appsettings.json'), 'utf8').replace(/^\uFEFF/, '')); assert.ok(config.DbConnection.ConnectionConfigs.every(item => item.DbType === 'PostgreSQL')); const info = await api(admin, 'sysServer/runtimeInfo', undefined, 'GET'); assert.equal(info.runtimeInfo.databaseType, 'PostgreSQL'); assert.equal(info.runtimeInfo.processId, marker.processId); await prepareOriginalBaseline(); record('isolated-runtime-marker-process-id-three-postgresql-connections-and-original-region-snapshot');
  const editor = await createTenant('editor'); const reader = await createTenant('reader'); await grant(reader, ['sysRegion:page']); const denied = await createTenant('denied'); await grant(denied, []);
  for (const path of ['sysRegion/list?id=0', 'sysRegion/tree']) { await api(undefined, path, undefined, 'GET', 'auth'); assert.ok(Array.isArray(await api(denied.session, path, undefined, 'GET')), 'authenticated shared metadata remains available'); }
  let code; do { code = String(randomInt(930000, 979999)); } while (Number(await sql("SELECT count(*) FROM sysregion WHERE code='" + code + "'"))); let parent = await add({ name: prefix + '_root', code: ' ' + code + ' ', orderNo: 70, level: 1, remark: '原始中文备注' }, editor.session); assert.equal(parent.code, code); const childA = await add({ name: prefix + '_child_a', code: code + '001', pid: code, orderNo: 20, shortName: '简称A', mergerName: '上级,下级', zipCode: '123456', cityCode: '010', level: 2, pinYin: 'FixtureChildA', lng: 121.5, lat: 31.2, remark: '保留隐藏字段' }, editor.session); const childB = await add({ name: prefix + '_child_b', code: code + '002', pid: parent.id, orderNo: 10, level: 2 }, editor.session); const grandchild = await add({ name: prefix + '_grandchild', code: code + '001001', pid: childA.id, orderNo: 30, level: 3 }, editor.session); const alpha = await add({ name: prefix + '_alpha', code: 'ABCDEF', orderNo: 45 }, editor.session); await add({ name: prefix + '_alpha_other', code: 'ABCDEF', orderNo: 46 }, editor.session);
  for (const session of [undefined, denied.session]) { await api(session, 'sysRegion/page', { page: 1, pageSize: 50 }, 'POST', 'auth'); await api(session, 'sysRegion/add', { name: prefix + '_unauthorized', code: '123456', pid: 0 }, 'POST', 'auth'); await api(session, 'sysRegion/update', { ...childA, remark: 'unauthorized' }, 'POST', 'auth'); await api(session, 'sysRegion/delete', { id: childA.id }, 'POST', 'auth'); }
  for (const [action, input] of [['add', { name: prefix + '_readonly', code: '654321', pid: 0 }], ['update', { ...childA, remark: 'readonly' }], ['delete', { id: childA.id }]]) await api(reader.session, 'sysRegion/' + action, input, 'POST', 'auth'); assert.ok((await rows(reader.session)).items.length >= 6); record('anonymous-no-grant-and-readonly-mutations-refused-explicitly-authorized-non-superadmin-crud');
  assert.equal(String(childA.pid), String(parent.id)); const list = await api(editor.session, 'sysRegion/list?id=' + parent.id, undefined, 'GET'); assert.deepEqual(list.map(item => String(item.id)), [String(childB.id), String(childA.id)]); const selected = await rows(editor.session, { pid: parent.id }); assert.deepEqual(selected.items.map(item => String(item.id)), [String(childB.id), String(childA.id), String(parent.id)]); assert.ok(!selected.items.some(item => String(item.id) === String(grandchild.id))); const page2 = await rows(editor.session, { pid: parent.id, page: 2, pageSize: 1 }); assert.equal(String(page2.items[0].id), String(childA.id)); assert.equal((await rows(editor.session, { name: childA.name, code: '001' })).total, 1); const tree = await api(editor.session, 'sysRegion/tree', undefined, 'GET'); const treeParent = flatten(tree).find(item => String(item.id) === String(parent.id)); assert.deepEqual(treeParent.children.map(item => String(item.id)), [String(childB.id), String(childA.id)]); assert.equal(String(treeParent.children[1].children[0].id), String(grandchild.id)); record('parent-id-or-code-resolution-6-9-12-and-legacy-nondigit-codes-contains-direct-child-query-and-stable-order');
  for (const input of [{ name: prefix + '_badcode', code: '12345', pid: 0 }, { name: parent.name, code: parent.code, pid: 0 }, { name: prefix + '_badparent', code: '987654', pid: '-1' }, { name: prefix + '_missingparent', code: '987654', pid: '888888888888' }]) await expectUnchanged(() => api(editor.session, 'sysRegion/add', input, 'POST', true));
  for (const input of [{ ...parent, pid: parent.id }, { ...parent, pid: parent.code }, { ...parent, pid: grandchild.id }, { ...parent, pid: '-1' }, { ...parent, pid: '888888888888' }, { ...childB, name: childA.name, code: childA.code }, { ...parent, id: '9223372036854775807' }]) await expectUnchanged(() => api(editor.session, 'sysRegion/update', input, 'POST', true)); await expectUnchanged(() => api(editor.session, 'sysRegion/delete', { id: '9223372036854775807' }, 'POST', true)); record('invalid-parent-self-descendant-cycle-duplicate-code-length-and-missing-record-refuse-before-write');
  await api(editor.session, 'sysRegion/update', { ...childA, name: prefix + '_child_a_updated', cityCode: '021', orderNo: 5, remark: '编辑后的中文\n第二行' }); const updated = await row(prefix + '_child_a_updated'); for (const field of ['shortName', 'mergerName', 'zipCode', 'level', 'pinYin', 'lng', 'lat']) assert.equal(updated[field], childA[field], 'unmodified ' + field + ' remains intact'); assert.equal(updated.remark, '编辑后的中文\n第二行'); assert.equal(await sql('SELECT count(*) FROM sysregion WHERE id=' + childA.id + " AND citycode='021' AND orderno=5"), '1'); assert.equal(String((await api(editor.session, 'sysRegion/list?id=' + parent.id, undefined, 'GET'))[0].id), String(childA.id)); record('real-update-persists-order-refreshes-and-preserves-all-unedited-region-fields');
  const beforeCascade = await fixtureRowRecords(); await api(editor.session, 'sysRegion/delete', { id: childA.id }); assert.deepEqual(await fixtureRowRecords(), beforeCascade.filter(item => ![String(childA.id), String(grandchild.id)].includes(item.id)), 'cascade deletes exactly the selected node and descendants and preserves every other fixture field'); assert.equal(await sql('SELECT count(*) FROM sysregion WHERE id IN (' + [childA.id, grandchild.id].join(',') + ')'), '0'); assert.equal(await sql('SELECT count(*) FROM sysregion WHERE id=' + parent.id), '1'); createdIds.delete(String(childA.id)); createdIds.delete(String(grandchild.id)); assert.equal(await originalSnapshot(), originalDigest); record('real-delete-cascades-only-own-descendants-and-keeps-parent-and-original-regions');
  stage = 'browser'; await runBrowser(editor, parent, reader, denied); report.passed = true;
} catch (error) {
  try { recoverStartupOwnership(); } catch (ownershipError) { report.cleanupErrors.push(clean('startup handoff: ' + ownershipError.message)); }
  report.failedStage = stage; report.error = clean(error.stack ?? error.message); persist();
  if (page) { try { report.failureUrl = clean(page.url()); report.dom = await page.locator('body').evaluate(element => [...element.querySelectorAll('button,input,textarea,[role="dialog"],[role="treeitem"],h1,h2,h3')].slice(0,100).map(item => ({ tag: item.tagName, role: item.getAttribute('role'), name: item.getAttribute('aria-label') || [...(item.labels || [])].map(label => label.textContent).join(' ') || (/^(BUTTON|H[123])$/.test(item.tagName) ? item.textContent : undefined), id: item.id, visible: item.getBoundingClientRect().height > 0 }))); } catch {} try { await page.screenshot({ path: join(evidence, '32-region-failure.png'), fullPage: true, mask: [page.locator('input[type="password"]')] }); } catch {} persist(); }
  console.error(clean(error.stack ?? error.message));
} finally {
  if (admin && base && !stopped) await cleanupFixtures().catch(error => report.cleanupErrors.push(clean('fixtures: ' + error.message)));
  for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime && existsSync(join(runtime, 'isolated-run.json')) ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(name + ': ' + error.message)); } }
  if (runtime) try {
    const candidates = (await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim().split(/\r?\n/).filter(Boolean);
    for (const id of candidates) { assert.match(id, /^[a-f0-9]{12,64}$/); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', id])).stdout.trim(), runtime); await native('docker', ['rm', '--force', '--volumes', id]); await assert.rejects(() => native('docker', ['inspect', id])); }
    assert.equal((await native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime])).stdout.trim(), ''); report.containerRemoved = true;
  } catch (error) { report.cleanupErrors.push(clean(error.message)); }
  if (base) { try { await fetch(new URL('/api/sysConfig/sysInfo', base), { signal: AbortSignal.timeout(2000) }); report.cleanupErrors.push('isolated API remains reachable'); } catch { report.apiStopped = true; } }
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'region-browser-baseline.json') : join(root, '.scratch/frontend-vben-migration/region-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
