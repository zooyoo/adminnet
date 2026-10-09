import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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
const prefix = `acceptance_${randomBytes(5).toString('hex')}`;
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql-generation', steps: [], cleanupErrors: [] };
let runtime, pg, evidence, base, browser, page, proxy, admin, stopped = false, stage = 'initialize';
const secrets = [];
function clean(value) { let text = String(value); for (const secret of secrets) text = text.replaceAll(secret, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function record(name) { report.steps.push({ name }); console.log(`PASS ${name}`); }
async function api(session, action, input, method = 'POST', refused = false) {
	const response = await fetch(new URL(`/api/${action}`, base), { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) }, body: method === 'POST' ? JSON.stringify(input) : undefined, signal: AbortSignal.timeout(30000) });
	if (refused && [401, 403].includes(response.status)) return;
	const body = await response.text(); assert.ok(body, `${action} empty HTTP ${response.status}`);
	const value = JSON.parse(body); if (refused) { assert.notEqual(value.code, 200); return; }
	assert.equal(value.code, 200, clean(value.message ?? action)); return value.result;
}
async function sql(statement) {
	const { stdout } = await execute('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', statement], { windowsHide: true, timeout: 30000 }); return stdout.trim();
}
async function login(account) {
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim();
	secrets.push(password); const value = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secrets.push(value.accessToken, value.refreshToken); return value;
}
async function select(label, text) {
	const input = page.getByRole('combobox', { name: label, exact: true }); await input.click(); await input.fill(text);
	const dropdown = page.locator('.ant-select-dropdown:visible'); await expect(dropdown).toHaveCount(1); const option = dropdown.locator('.ant-select-item-option').filter({ hasText: text }); await expect(option).toHaveCount(1); await option.click(); await expect(dropdown).toHaveCount(0);
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), fullPage: true });
}
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
try {
	runtime = realpathSync(process.argv[2]); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^﻿/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^﻿/, '')); assert.equal(pg.runtimeRoot, runtime);
	base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1');
	const { stdout: label } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true }); assert.equal(label.trim(), runtime);
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	admin = await login('superAdmin.NET');
	stage = 'entity-service';
	await sql(`CREATE TABLE "${prefix}" ("Id" bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY, "Title" varchar(64) NOT NULL DEFAULT '中文', "Amount" numeric(12,3), "Enabled" boolean NOT NULL, "Occurred" timestamp, "Key" uuid, "Payload" bytea); COMMENT ON TABLE "${prefix}" IS '中文"注释'; COMMENT ON COLUMN "${prefix}"."Title" IS '引号"换行';`);
	const entity = { configId: pg.configId, tableName: prefix, entityName: 'AcceptanceGenerated', position: 'Admin.NET.Application', baseClassName: '' };
	const preview = await api(admin, 'sysDatabase/previewEntity', entity);
	assert.ok(preview.content.includes('public virtual byte[]? Payload')); assert.ok(preview.content.includes('decimal? Amount')); assert.match(preview.content, /IsIdentity = true/);
	const output = join(runtime, 'generated', preview.relativePath); assert.equal(existsSync(output), false);
	await api(admin, 'sysDatabase/createEntity', { ...entity, expectedHash: preview.hash }); assert.equal(readFileSync(output, 'utf8'), preview.content);
	await api(admin, 'sysDatabase/createEntity', entity, 'POST', true);
	const before = readFileSync(output, 'utf8'); await api(admin, 'sysDatabase/createEntity', { ...entity, expectedHash: 'stale', overwriteExisting: true, expectedTargetHash: preview.targetHash }, 'POST', true); assert.equal(readFileSync(output, 'utf8'), before);
	await api(admin, 'sysDatabase/previewEntity', { ...entity, position: '../unrelated' }, 'POST', true);
	await api(admin, 'sysDatabase/previewEntity', { ...entity, baseClassName: 'Missing' }, 'POST', true);
	await api(admin, 'sysDatabase/previewSeedData', { configId: pg.configId, tableName: prefix, position: 'Admin.NET.Application' }, 'POST', true);
	record('real-entity-preview-write-parity-types-and-target-refusals');
	stage = 'seed-service';
	await sql(`CREATE TABLE "SysPos" ("Id" bigint PRIMARY KEY, "Name" varchar(64), "Code" varchar(64), "OrderNo" integer, "Remark" varchar(128), "Status" integer, "CreateTime" timestamp, "UpdateTime" timestamp, "CreateUserId" bigint, "CreateUserName" varchar(64), "UpdateUserId" bigint, "UpdateUserName" varchar(64), "TenantId" bigint); INSERT INTO "SysPos" ("Id","Name","Code","OrderNo","Remark","Status","CreateTime","TenantId") VALUES (919191, '中文"职位', 'acceptance', 3, E'第一行\n第二行\\路径', 1, '2026-10-10 00:00:00', 1300000000001);`);
	await sql('ALTER TABLE "SysPos" RENAME TO syspos');
	for (const column of ['Id', 'Name', 'Code', 'OrderNo', 'Remark', 'Status', 'CreateTime', 'UpdateTime', 'CreateUserId', 'CreateUserName', 'UpdateUserId', 'UpdateUserName', 'TenantId']) await sql(`ALTER TABLE syspos RENAME COLUMN "${column}" TO ${column.toLowerCase()}`);
	const seed = { configId: pg.configId, tableName: 'syspos', position: 'Admin.NET.Application', suffix: 'Acceptance', filterExistingData: false };
	const seedPreview = await api(admin, 'sysDatabase/previewSeedData', seed);
	assert.ok(seedPreview.content.includes('中文\\"职位')); assert.match(seedPreview.content, /DateTime.Parse/);
	await api(admin, 'sysDatabase/createSeedData', { ...seed, expectedHash: seedPreview.hash }); const seedPath = join(runtime, 'generated', seedPreview.relativePath); assert.equal(readFileSync(seedPath, 'utf8'), seedPreview.content);
	const filtered = await api(admin, 'sysDatabase/previewSeedData', { ...seed, filterExistingData: true }); assert.match(filtered.content, /919191L/);
	await sql("INSERT INTO syspos (id, name, code, status, orderno, createtime, tenantid) VALUES (1300000000101, '已有种子记录', 'known', 1, 1, '2026-10-10', 1300000000001)");
	const allRows = await api(admin, 'sysDatabase/previewSeedData', seed);
	const excludingKnown = await api(admin, 'sysDatabase/previewSeedData', { ...seed, filterExistingData: true });
	assert.ok(allRows.content.includes('Id=1300000000101L')); assert.equal(excludingKnown.content.includes('Id=1300000000101L'), false); assert.ok(excludingKnown.content.includes('Id=919191L'));
	await sql('DELETE FROM syspos WHERE id=1300000000101');
	const existing = await api(admin, 'sysDatabase/previewEntity', entity);
	writeFileSync(output, 'external edit', 'utf8');
	await api(admin, 'sysDatabase/createEntity', { ...entity, expectedHash: existing.hash, expectedTargetHash: existing.targetHash, overwriteExisting: true }, 'POST', true);
	assert.equal(readFileSync(output, 'utf8'), 'external edit');
	const currentPreview = await api(admin, 'sysDatabase/previewEntity', entity);
	await api(admin, 'sysDatabase/createEntity', { ...entity, expectedHash: currentPreview.hash, expectedTargetHash: currentPreview.targetHash, overwriteExisting: true }); assert.equal(readFileSync(output, 'utf8'), currentPreview.content);
	await api(admin, 'sysDatabase/previewEntity', { ...entity, baseClassName: 'EntityBaseId' }, 'POST', true);
	record('real-loaded-entity-seed-preview-write-parity-and-escaping');
	const ordinary = await login('TestUser3');
	for (const action of ['previewEntity', 'createEntity', 'previewSeedData', 'createSeedData']) { await api(ordinary, `sysDatabase/${action}`, entity, 'POST', true); await api(undefined, `sysDatabase/${action}`, entity, 'POST', true); }
	record('anonymous-and-ungranted-generation-refusals');
	stage = 'compile-and-postgresql-replay';
	const probe = join(runtime, 'probe'); mkdirSync(probe, { recursive: true });
	writeFileSync(join(probe, 'Generated.cs'), preview.content, 'utf8'); writeFileSync(join(probe, 'Seed.cs'), seedPreview.content, 'utf8');
	const projectPath = join(root, 'Admin.NET/Admin.NET.Core/Admin.NET.Core.csproj').replaceAll('\\', '/');
	writeFileSync(join(probe, 'Probe.csproj'), `<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net10.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><ProjectReference Include="${projectPath}" /></ItemGroup></Project>`, 'utf8');
	writeFileSync(join(probe, 'Program.cs'), String.raw`using Admin.NET.Core;
using Admin.NET.Application.SeedData;
using SqlSugar;
using System.Text.Json;
var cfg = JsonDocument.Parse(File.ReadAllText(args[0]));
var conn = cfg.RootElement.GetProperty("DbConnection").GetProperty("ConnectionConfigs").EnumerateArray().Single(c => c.GetProperty("DbType").GetString() == "PostgreSQL").GetProperty("ConnectionString").GetString();
using var db = new SqlSugarClient(new ConnectionConfig { ConnectionString = conn, DbType = DbType.PostgreSQL, IsAutoCloseConnection = true });
var rows = new SysPosSeedDataAcceptance().HasData().ToList();
if (rows.Count != 1 || rows[0].Name != "中文\"职位" || !rows[0].Remark!.Contains('\n')) throw new Exception("Seed values mismatch");
db.Ado.ExecuteCommand("CREATE TABLE \"seed_replay\" (LIKE syspos INCLUDING ALL)");
db.Insertable(rows).AS("seed_replay").ExecuteCommand();
if (db.Queryable<SysPos>().AS("seed_replay").Count() != 1) throw new Exception("Replay failed");
Console.WriteLine("Generated code compiled and real PostgreSQL seed replay passed");`, 'utf8');
	const compiled = await execute('dotnet', ['build', join(probe, 'Probe.csproj'), '-o', join(probe, 'bin')], { windowsHide: true, timeout: 120000, maxBuffer: 2 * 1024 * 1024 }); writeFileSync(join(evidence, 'generated-build.log'), compiled.stdout + compiled.stderr, 'utf8');
	const replay = await execute('dotnet', [join(probe, 'bin/Probe.dll'), join(runtime, 'appsettings.json')], { windowsHide: true, timeout: 30000, maxBuffer: 1024 * 1024 }); writeFileSync(join(evidence, 'seed-replay.log'), clean(replay.stdout), 'utf8');
	assert.equal(await sql('SELECT count(*) FROM "seed_replay"'), '1'); record('generated-entity-and-seed-compile-and-real-postgresql-replay');
	if (!process.argv.includes('--service-only')) {
		stage = 'production-browser'; proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1100 } }); page.setDefaultTimeout(20000);
		await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(admin.accessToken)}&redirect=%2Fdevelop%2Fdatabase`); await expect(page.locator('.database-page')).toBeVisible();
		await select('数据库', '隔离 PostgreSQL'); await select('数据表', prefix); await page.getByRole('button', { name: '生成实体', exact: true }).click();
		const editor = page.getByRole('dialog', { name: '生成实体', exact: true }); await editor.getByLabel('实体名称', { exact: true }).fill('AcceptanceDesktop');
		await editor.getByRole('button', { name: '预览代码', exact: true }).click(); await expect(editor.locator('.code-preview')).toContainText('AcceptanceDesktop'); await shot('26-entity-preview-light.png');
		await editor.getByRole('button', { name: '生成文件', exact: true }).click(); const confirm = page.getByRole('dialog', { name: '确认生成文件', exact: true }); await expect(confirm).toContainText(prefix);
		const [saved] = await Promise.all([page.waitForResponse(response => response.url().endsWith('/sysDatabase/createEntity')), confirm.getByRole('button', { name: '确认生成', exact: true }).click()]); assert.equal((await saved.json()).code, 200); await expect(editor).toBeHidden();
		assert.ok(existsSync(join(runtime, 'generated/Admin.NET.Application/Entity/AcceptanceDesktop.cs')));
		await select('数据表', 'syspos'); await page.getByRole('button', { name: '生成种子', exact: true }).click(); const seedEditor = page.getByRole('dialog', { name: '生成种子数据', exact: true }); await seedEditor.getByLabel('后缀', { exact: true }).fill('Desktop'); await seedEditor.getByRole('button', { name: '预览代码', exact: true }).click(); await expect(seedEditor.locator('.code-preview')).toContainText('SysPosSeedDataDesktop');
		const dark = page.getByRole('button', { name: 'dark', exact: true }); await seedEditor.getByRole('button', { name: /^取\s*消$/ }).click(); if (await dark.count()) await dark.click(); await expect(page.locator('html')).toHaveClass(/dark/);
		await page.getByRole('button', { name: '生成种子', exact: true }).click(); await seedEditor.getByRole('button', { name: '预览代码', exact: true }).click(); await expect(seedEditor.locator('.code-preview')).toContainText('SysPosSeedData'); await shot('26-seed-preview-dark.png');
		record('production-desktop-entry-preview-confirm-output-and-themes');
		await sql(`DROP TABLE IF EXISTS "seed_replay", syspos, "${prefix}" CASCADE`); await stop();
		await seedEditor.getByRole('button', { name: '预览代码', exact: true }).click(); await expect(seedEditor.locator('.ant-alert')).toContainText(/失败|服务/); await expect(seedEditor.getByRole('button', { name: '预览代码', exact: true })).toBeEnabled(); record('real-stopped-api-feedback-retains-generation-dialog');
	}
	report.passed = true;
} catch (error) {
	report.failure = { stage, error: clean(error.stack ?? error) }; console.error(clean(`${stage}: ${error.message}`));
	if (error.stdout && evidence) writeFileSync(join(evidence, 'failed-build.log'), clean(error.stdout + (error.stderr ?? '')), 'utf8');
	if (page && evidence) await page.screenshot({ path: join(evidence, '26-failure.png'), fullPage: true }).catch(() => {});
} finally {
	if (pg) await sql(`DROP TABLE IF EXISTS "seed_replay", syspos, "${prefix}" CASCADE`).catch(error => report.cleanupErrors.push(clean(error.message)));
	for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(`${name}: ${error.message}`)); } }
	if (pg) try { const { stdout: label } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true }); assert.equal(label.trim(), runtime); await execute('docker', ['rm', '--force', '--volumes', pg.containerName], { windowsHide: true }); report.containerRemoved = true; } catch (error) { report.cleanupErrors.push(clean(error.message)); }
	report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true;
	if (evidence) { const path = join(evidence, 'database-generation-browser-baseline.json'); writeFileSync(path, JSON.stringify(report, null, 2), 'utf8'); console.log(`Report: ${path}`); }
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
