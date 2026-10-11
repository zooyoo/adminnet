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
const report = { passed: false, cleanupPassed: false, boundary: 'real-postgresql-swagger-sdk-generation-no-browser', steps: [], cleanupErrors: [] };
let runtime, marker, pg, evidence, base, admin, browser, page, proxy, originalDigest, initialTemplateDigest, stopped = false, stage = 'start';

function secret(value) { if (value && !secrets.includes(String(value))) secrets.push(String(value)); return value; }
function clean(value) { let text = String(value); for (const value of secrets.toSorted((a, b) => b.length - a.length)) text = text.replaceAll(value, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function persist() { const output = evidence ? join(evidence, 'sdk-generation-baseline.json') : join(root, '.scratch/frontend-vben-migration/plugin-startup-report.json'); writeFileSync(output, clean(JSON.stringify(report, null, 2)), 'utf8'); }
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

async function runGeneration() {
  const fs = await import('node:fs');
  const { createHash } = await import('node:crypto');
  const workspace = join(runtime, 'sdk-copy');
  const web = join(workspace, 'Web');
  const app = join(web, 'apps/web-antdv-next');
  fs.mkdirSync(join(web, 'api_build'), { recursive: true });
  fs.mkdirSync(join(web, 'node_modules'), { recursive: true });
  fs.mkdirSync(join(app, 'node_modules'), { recursive: true });
  fs.mkdirSync(join(app, 'src'), { recursive: true });
  for (const name of ['build.ps1', 'normalize-sdk.mjs', 'swagger-codegen-cli.jar']) fs.copyFileSync(join(root, 'Web/api_build', name), join(web, 'api_build', name));
  for (const [target, from] of [[join(web, 'node_modules/typescript'), join(root, 'Web/node_modules/typescript')], [join(app, 'node_modules/axios'), join(root, 'Web/apps/web-antdv-next/node_modules/axios')]]) fs.symlinkSync(fs.realpathSync(from), target, 'junction');
  const digest = directory => {
    const hash = createHash('sha256');
    const files = fs.readdirSync(directory, { recursive: true }).filter(file => fs.statSync(join(directory, file)).isFile()).sort();
    for (const file of files) hash.update(file).update(fs.readFileSync(join(directory, file)));
    return { sha256: hash.digest('hex'), files: files.length };
  };
  for (const [module, group, directory] of [['apiServices','Default','api-services'], ['dingTalk','DingTalk','api-plugins/dingTalk'], ['goView','GoView','api-plugins/goView']]) {
    stage = 'generate-' + module;
    const url = new URL('/swagger/' + group + '/swagger.json', base);
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200, '真实 Swagger 分组 ' + group);
    const swagger = await response.json();
    assert.ok(Object.keys(swagger.paths ?? {}).length > 0);
    if (group === 'Default') {
      assert.equal(swagger.components.schemas.StatusEnum.type, 'integer', '状态枚举保持应用数字合同');
      assert.deepEqual(swagger.components.schemas.StatusEnum.enum, [1, 2]);
    }
    if (group === 'DingTalk') {
      for (const operation of ['addWorkflowConfig', 'updateWorkflowConfig', 'deleteWorkflowConfig']) {
        assert.ok(swagger.paths['/api/dingTalk/' + operation]?.post, '审批配置操作保留独立 POST 路由：' + operation);
      }
    }
    fs.writeFileSync(join(evidence, 'swagger-' + group + '.json'), JSON.stringify(swagger), 'utf8');
    const result = await native('pwsh', ['-NoProfile', '-File', join(web, 'api_build/build.ps1'), '-JavaPath', process.env.SDK35_JAVA ?? 'java', '-Module', module, '-ApiUrl', url.href], 180000);
    fs.writeFileSync(join(evidence, 'generate-' + module + '.log'), clean(result.stdout + result.stderr), 'utf8');
    const destination = join(app, 'src', directory);
    const before = digest(destination);
    assert.ok(before.files > 0);
    for (let pass = 0; pass < 2; pass++) {
      await native('node', [join(web, 'api_build/normalize-sdk.mjs'), destination], 120000);
      assert.deepEqual(digest(destination), before, '后处理重复运行幂等');
    }
    record('generate-and-normalize-' + module, { ...before, swaggerPaths: Object.keys(swagger.paths).length });
    await assert.rejects(() => native('pwsh', ['-NoProfile', '-File', join(web, 'api_build/build.ps1'), '-JavaPath', process.env.SDK35_JAVA ?? 'java', '-Module', module, '-ApiUrl', new URL('/swagger/missing-sdk35/swagger.json', base).href], 60000));
    assert.deepEqual(digest(destination), before, '生成失败保留已有 SDK');
    assert.deepEqual(fs.readdirSync(join(web, 'node_modules/.cache/api-generation')), [], '暂存和备份目录已清理');
    record('generation-failure-preserves-' + module);
  }
  report.generatedWorkspace = workspace;
  report.fixtureRecordsRemoved = true;
}
async function cleanupFixtures() { report.fixtureRecordsRemoved = true; }
try {
  const port = Number(process.argv[2] ?? 5035); assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535);
  const { stdout } = await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-Port', String(port), '-PostgreSqlFixture', '-PluginFixture', '-SdkFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/plugin-api-build'), '-RuntimeMarkerPath', runtimeMarkerPath], { windowsHide: true, timeout: 330000 });
  const match = stdout.match(/^Runtime: (.+)$/m); assert.ok(match, 'isolated runtime marker'); runtime = realpathSync(match[1].trim()); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
  marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase()); assert.equal(pg.runtimeRoot, runtime); base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal((await native('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName])).stdout.trim(), runtime);
  evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true }); console.log('Evidence: ' + evidence); persist(); stage = 'service'; admin = await login('superAdmin.NET');
  await runGeneration(); report.passed = true;
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
  report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true && report.apiStopped === true && report.fixtureRecordsRemoved === true; persist(); console.log('Report: ' + (evidence ? join(evidence, 'sdk-generation-baseline.json') : join(root, '.scratch/frontend-vben-migration/plugin-startup-report.json')));
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
