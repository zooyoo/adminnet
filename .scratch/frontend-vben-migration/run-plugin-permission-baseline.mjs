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
const report = { passed: false, cleanupPassed: false, boundary: 'real-postgresql-plugin-permission-no-browser', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'plugin-permission-baseline.json') : join(root, '.scratch/frontend-vben-migration/plugin-permission-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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
const route = 'plugin34' + randomBytes(5).toString('hex');
function code(value) { return 'using Microsoft.AspNetCore.Mvc;\r\nusing Microsoft.AspNetCore.Authorization;\r\n[ApiController] [AllowAnonymous] [Route("api/' + route + '")] public class Plugin34Controller : ControllerBase { [HttpGet] public string Get() => "' + value + '"; }\r\n'; }
async function rows() { return api(admin, 'sysPlugin/page', { page: 1, pageSize: 100, name: prefix }); }
async function lookup(name) { const result = (await rows()).items.find(row => row.name === name); assert.ok(result); assert.match(String(result.id), /^\d+$/); return result; }
async function callPlugin(expected) {
  const deadline = Date.now() + 10000;
  while (true) {
    const response = await fetch(new URL('/api/' + route, base), { signal: AbortSignal.timeout(3000) });
    const body = await response.text();
    if (expected === null ? response.status === 404 : response.ok && (body === expected || body === JSON.stringify(expected) || (() => { try { const data = JSON.parse(body); return data.code === 200 && data.result === expected; } catch { return false; } })())) return;
    if (Date.now() >= deadline) throw Error('动态路由状态不符 HTTP ' + response.status);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function runService() {
  const name = prefix + '_service';
  const draft = { name, assemblyName: prefix + '_assembly', csharpCode: code('initial34'), orderNo: 100, status: 1, remark: '隔离真实动态插件' };
  await api(admin, 'sysPlugin/add', draft);
  let item = await lookup(name);
  createdIds.add(String(item.id));
  assert.equal(await sql('SELECT encode(convert_to(csharpcode, \'UTF8\'), \'hex\') FROM sysplugin WHERE id=' + item.id), Buffer.from(draft.csharpCode).toString('hex'));
  await callPlugin('initial34'); record('real-add-persist-original-code-and-execute');
  const before = await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + item.id);
  await api(admin, 'sysPlugin/update', { ...item, csharpCode: 'invalid C# source' }, 'POST', true);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + item.id), before);
  await callPlugin('initial34'); record('compile-error-preserves-database-and-running-route');
  await api(admin, 'sysPlugin/update', { ...item, csharpCode: code('updated34') });
  item = await lookup(name); await callPlugin('updated34'); record('real-update-replaces-runtime');
  await api(admin, 'sysPlugin/update', { ...item, status: 2 });
  item = await lookup(name); assert.equal(item.status, 2); await callPlugin(null); record('disabled-plugin-removes-route');
  await api(admin, 'sysPlugin/update', { ...item, status: 1 });
  await callPlugin('updated34'); record('enable-republishes-route');
  await api(admin, 'sysPlugin/delete', { id: item.id });
  assert.equal(await sql('SELECT count(*) FROM sysplugin WHERE id=' + item.id), '0');
  await callPlugin(null); record('delete-removes-row-and-route');
}
async function cleanupFixtures() {
  const failures = [], attempt = async (label, work) => { try { return await work(); } catch (error) { failures.push(clean(label + ': ' + error.message)); } };
  const owned = await attempt('enumerate plugins', () => rows());
  if (owned) await attempt('validate owned plugins and remove each', async () => { assert.ok(owned.total <= 100, 'cleanup must see every fixture'); assert.ok(owned.items.every(item => item.name.startsWith(prefix)), 'cleanup owns selected plugins');
    for (const item of owned.items) await attempt('plugin ' + item.id, async () => { const id = String(item.id); assert.match(id, /^\d+$/); if (Number(await sql('SELECT count(*) FROM sysplugin WHERE id=' + id))) await api(admin, 'sysPlugin/delete', { id }); });
  });
  const ownership = await attempt('tenant ownership snapshot', async () => {
    for (const item of fixtures) if (!item.id) { const id = await sql("SELECT DISTINCT t.id FROM systenant t WHERE t.userid IN (SELECT id FROM sysuser WHERE account='" + item.account + "') OR t.id IN (SELECT tenantid FROM sysorg WHERE name='" + item.name + "')"); if (id) { assert.match(id, /^\d+$/); item.id = id; } }
    const ids = fixtures.filter(item => item.id).map(item => item.id); ids.forEach(id => assert.match(id, /^\d+$/)); const predicate = ids.length ? ids.join(',') : '-1';
    const roles = (await sql('SELECT id FROM sysrole WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean); const users = (await sql('SELECT id FROM sysuser WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean); roles.concat(users).forEach(id => assert.match(id, /^\d+$/)); return { ids: predicate, roles: roles.join(',') || '-1', users: users.join(',') || '-1' };
  });
  for (const item of [...fixtures].reverse()) if (item.id) await attempt('tenant ' + item.id, async () => { if (Number(await sql('SELECT count(*) FROM systenant WHERE id=' + item.id))) await api(admin, 'sysTenant/delete', { id: item.id }); });
  await attempt('plugin residue', async () => assert.equal(Number(await sql("SELECT count(*) FROM sysplugin WHERE starts_with(name, '" + prefix + "')")), 0));
  await attempt('tenant relationship residue', async () => {
    assert.ok(ownership, 'fixture tenant ownership is available'); const counts = {};
    for (const table of ['systenant', 'sysuser', 'sysorg', 'sysrole', 'syspos', 'systenantmenu', 'systenantconfigdata']) { const column = table === 'systenant' ? 'id' : 'tenantid'; counts[table] = Number(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + column + ' IN (' + ownership.ids + ')')); assert.equal(counts[table], 0, table + ' has no fixture records'); }
    for (const [table, column, ids] of [['sysrolemenu', 'roleid', ownership.roles], ['sysuserrole', 'userid', ownership.users], ['sysuserrole', 'roleid', ownership.roles], ['sysuserextorg', 'userid', ownership.users], ['sysusermenu', 'userid', ownership.users], ['sysuserconfigdata', 'userid', ownership.users], ['sysroleorg', 'roleid', ownership.roles]]) { const key = table + ':' + column; counts[key] = Number(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + column + ' IN (' + ids + ')')); assert.equal(counts[key], 0, key + ' has no fixture records'); }
    assert.equal(Number(await sql("SELECT count(*) FROM sysuser WHERE starts_with(account, '" + prefix + "')")), 0); assert.equal(Number(await sql("SELECT count(*) FROM sysorg WHERE starts_with(name, '" + prefix + "')")), 0); report.fixtureResidueCounts = counts;
  });
  await attempt('direct permission menu cleanup', async () => {
    const ids = (await sql('SELECT id FROM sysmenu WHERE starts_with(title, ' + quote(prefix + '_direct_') + ')')).split(/\r?\n/).filter(Boolean);
    for (const id of ids) { assert.match(id, /^\d+$/); await api(admin, 'sysMenu/delete', { id }); }
    assert.equal(await sql('SELECT count(*) FROM sysmenu WHERE starts_with(title, ' + quote(prefix + '_direct_') + ')'), '0');
    for (const table of ['systenantmenu', 'sysrolemenu', 'sysusermenu']) if (ids.length) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE menuid IN (' + ids.join(',') + ')'), '0');
    report.directPermissionMenusRemoved = true;
  });
  if (failures.length) throw new Error(failures.join('; ')); fixtures.length = 0; report.fixtureRecordsRemoved = true; record('fixture-plugins-tenants-users-organizations-roles-positions-and-grants-removed');
}
async function grant(fixture, permissions) {
  permissions = permissions.map(value => { const permission = value.startsWith('sysPlugin:') ? value : 'sysPlugin:' + value; assert.match(permission, /^sysPlugin:(page|add|update|delete|compileAssembly|removeAssembly)$/); return permission; });
  const menuIds = (await sql("SELECT id FROM sysmenu WHERE permission IN ('" + permissions.join("','") + "') ORDER BY id")).split(/\r?\n/).filter(Boolean); assert.equal(menuIds.length, permissions.length);
  await api(admin, 'sysTenant/grantMenu', { id: fixture.id, menuIdList: menuIds }); fixture.session = await api(admin, 'sysTenant/goTenant', { id: fixture.id }); secret(fixture.session.accessToken); secret(fixture.session.refreshToken);
  const info = await api(fixture.session, 'sysAuth/userInfo', undefined, 'GET'); assert.notEqual(info.accountType, 999); for (const permission of permissions) assert.ok(info.buttons.includes(permission)); return info;
}
async function createTenant(suffix) {
  const account = prefix + '_' + suffix, fixture = { account, name: account }; fixtures.push(fixture);
  await api(admin, 'sysTenant/add', { name: account, adminAccount: account, tenantType: 0, status: 1, enableReg: 2 });
  const parts = (await sql("SELECT t.id || '|' || t.userid || '|' || u.orgid FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account='" + account + "'")).split('|'); assert.equal(parts.length, 3); parts.forEach(value => assert.match(value, /^\d+$/));
  [fixture.id, fixture.userId, fixture.orgId] = parts; await grant(fixture, ['sysPlugin:page', 'sysPlugin:add', 'sysPlugin:update', 'sysPlugin:delete']); return fixture;
}
async function ownedRow(session, name) {
  const data = await api(session, 'sysPlugin/page', { page: 1, pageSize: 100, name });
  const found = data.items.find(item => item.name === name); assert.ok(found); return found;
}
async function runPermission() {
  const editor = await createTenant('editor'), other = await createTenant('other'), reader = await createTenant('reader'), denied = await createTenant('denied');
  await grant(reader, ['page']); await grant(denied, []);
  const draft = { name: prefix + '_tenant', csharpCode: code('tenant34'), orderNo: 100, status: 2 };
  await api(editor.session, 'sysPlugin/add', draft);
  const own = await ownedRow(editor.session, draft.name);
  assert.equal(String(own.tenantId), editor.id);
  const before = await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id);
  const foreign = await api(other.session, 'sysPlugin/page', { page: 1, pageSize: 100, name: draft.name, tenantId: editor.id });
  assert.equal(foreign.items.length, 0);
  for (const [action, body] of [['update', { ...own, name: prefix + '_stolen' }], ['delete', { id: own.id }], ['add', { ...draft, name: prefix + '_cross', tenantId: editor.id }]]) await api(other.session, 'sysPlugin/' + action, body, 'POST', true);
  await api(editor.session, 'sysPlugin/update', { ...own, tenantId: other.id }, 'POST', true);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id), before);
  record('granted-cross-tenant-page-update-delete-add-and-reparent-denied');
  const endpoints = [['page', { page: 1, pageSize: 20 }], ['add', draft], ['update', own], ['delete', { id: own.id }], ['compileAssembly?assemblyName=' + prefix + '_denied', code('denied')], ['removeAssembly/' + encodeURIComponent(own.assemblyName), {}]];
  for (const session of [undefined, denied.session]) for (const [action, body] of endpoints) await api(session, 'sysPlugin/' + action, body, 'POST', 'auth');
  for (const [action, body] of endpoints.filter(([action]) => action !== 'page')) await api(reader.session, 'sysPlugin/' + action, body, 'POST', 'auth');
  const readerPage = await api(reader.session, 'sysPlugin/page', { page: 1, pageSize: 20 }); assert.equal(readerPage.total, 0);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id), before);
  record('anonymous-ungranted-readonly-crud-and-direct-endpoint-denials');
  const assemblyName = prefix + '_temporary';
  const compiled = await api(admin, 'sysPlugin/compileAssembly?assemblyName=' + assemblyName, code('temporary34'));
  assert.equal(compiled, assemblyName); await callPlugin('temporary34');
  await api(admin, 'sysPlugin/compileAssembly?assemblyName=' + assemblyName, code('conflict'), 'POST', true);
  await callPlugin('temporary34');
  await api(admin, 'sysPlugin/removeAssembly/Admin.NET.Core', {}, 'POST', true);
  await callPlugin('temporary34');
  await api(admin, 'sysPlugin/removeAssembly/' + assemblyName, {}); await callPlugin(null);
  await api(admin, 'sysPlugin/removeAssembly/' + assemblyName, {}, 'POST', true);
  await api(admin, 'sysPlugin/compileAssembly?assemblyName=' + encodeURIComponent(own.assemblyName), code('reserved'), 'POST', true);
  record('direct-compile-execute-conflict-host-protection-remove-and-disabled-name-reservation');
  for (const action of ['compileAssembly', 'removeAssembly']) {
    const permission = 'sysPlugin:' + action;
    if (await sql('SELECT count(*) FROM sysmenu WHERE permission=' + quote(permission)) === '0') {
      await api(admin, 'sysMenu/add', { title: prefix + '_direct_' + action, type: 3, pid: 0, permission, status: 1, tenantId: 0 });
    }
  }
  for (const tenant of [editor, other]) await grant(tenant, ['page', 'add', 'update', 'delete', 'compileAssembly', 'removeAssembly']);
  const tenantAssembly = prefix + '_owned_temporary';
  assert.equal(await api(editor.session, 'sysPlugin/compileAssembly?assemblyName=' + tenantAssembly, code('owned34')), tenantAssembly);
  await callPlugin('owned34');
  await api(other.session, 'sysPlugin/removeAssembly/' + tenantAssembly, {}, 'POST', true);
  await callPlugin('owned34');
  await api(other.session, 'sysPlugin/removeAssembly/' + encodeURIComponent(own.assemblyName), {}, 'POST', true);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id), before);
  await api(editor.session, 'sysPlugin/removeAssembly/' + tenantAssembly, {}); await callPlugin(null);
  record('explicitly-granted-direct-tenant-compile-foreign-removal-denied-owner-removal-succeeds');
}


try {
  const port = Number(process.argv[2] ?? 5034); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/plugin-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], { windowsHide: true, timeout: 330000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runPermission(); report.passed = true;
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
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'plugin-permission-baseline.json') : join(root, '.scratch/frontend-vben-migration/plugin-permission-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
