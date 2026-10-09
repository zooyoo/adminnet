import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const apiUrl = new URL(marker.baseUrl);
assert.equal(apiUrl.hostname, '127.0.0.1');
assert.equal(apiUrl.protocol, 'http:');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'desktop-production-real-api-readonly-sqlite', steps: [], cleanupErrors: [] };
const name = `browser08-${Date.now()}`;
let proxy, browser, context, page, db, session;
let stage = 'initialize';
let stopped = false;
const fixtures = [];
const errors = [];
const record = (table, code) => db.prepare(`SELECT * FROM ${table} WHERE Code = ?`).get(code);
function writeReport() { writeFileSync(join(evidence, 'dictionary-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8'); }
async function api(path, data) {
	const response = await fetch(new URL(`/api/${path}`, apiUrl), {
		method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` },
		body: JSON.stringify(data), signal: AbortSignal.timeout(20_000),
	});
	if (response.headers.get('access-token')) {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	assert.equal((await response.json()).code, 200, path);
}
async function save(dialog, endpoint, success = true) {
	const [response] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith(`/api/${endpoint}`) && item.request().method() === 'POST'),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	const json = await response.json();
	if (success) { assert.equal(json.code, 200, endpoint); await expect(dialog).toBeHidden(); }
	else { assert.notEqual(json.code, 200); await expect(dialog).toBeVisible(); }
}
async function shot(file, target = page) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.locator('.ant-table-content, .ant-table-body, .ant-modal-body').evaluateAll((elements) => elements.forEach((element) => { element.scrollLeft = 0; element.scrollTop = 0; }));
	await target.screenshot({ path: join(evidence, file), animations: 'disabled' });
}
async function cleanupFixtures() {
	for (const fixture of fixtures) {
		if (fixture.cleaned) continue;
		await api(`${fixture.prefix}/delete`, { id: fixture.id });
		assert.equal(db.prepare(`SELECT Id FROM ${fixture.table} WHERE Id = ?`).get(fixture.id), undefined);
		fixture.cleaned = true;
	}
}
try {
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	proxy = await startProductionProxy(join(root, 'Web/dist'), apiUrl);
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
	page.on('pageerror', (error) => errors.push(`${error.name}: ${error.message}`));
	report.consoleErrors = [];
	page.on('console', (message) => {
		if (message.type() === 'error' && /TypeError|Error:|Cannot|style/i.test(message.text()))
			report.consoleErrors.push(message.text().slice(0, 500));
	});
	report.dictionaryRequests = [];
	page.on('response', async (response) => {
		if (!response.url().endsWith('/sysDictData/page')) return;
		const json = await response.json().catch(() => ({}));
		report.dictionaryRequests.push({ status: response.status(), code: json.code, count: json.result?.items?.length, ids: json.result?.items?.map((row) => row.id) });
	});
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	stage = 'login-dictionary-production';
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fplatform%2Fdict`);
	await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
	await page.getByLabel('密码', { exact: true }).fill(password);
	const [response] = await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysAuth/login')), page.locator('button[type=submit]').click()]);
	const login = await response.json();
	assert.equal(login.code, 200);
	session = login.result;
	await expect(page.getByRole('button', { name: '新增字典', exact: true })).toBeVisible();
	report.steps.push(stage);
	stage = 'dictionary-create-validation-and-persistence';
	await page.getByRole('button', { name: '新增字典', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '添加字典', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByText('请输入字典名称', { exact: true })).toBeVisible();
	await dialog.getByLabel('字典名称', { exact: true }).fill(name);
	await dialog.getByLabel('字典编码', { exact: true }).fill(name);
	await save(dialog, 'sysDictType/add');
	const type = record('SysDictType', name);
	assert.ok(type);
	fixtures.push({ prefix: 'sysDictType', table: 'SysDictType', id: type.Id });
	await page.locator('form[name="dict-type-query"]').getByLabel('名称', { exact: true }).fill(name);
	await page.locator('form[name="dict-type-query"]').getByRole('button', { name: /^查\s*询$/ }).click();
	await page.getByRole('button', { name, exact: true }).click();
	await page.getByRole('button', { name: '新增字典值', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '添加字典值', exact: true });
	await dialog.getByLabel('显示文本', { exact: true }).fill('真实桌面字典值');
	await dialog.getByLabel('字典值', { exact: true }).fill('01');
	await dialog.getByLabel('样式 Style', { exact: true }).fill('color: red');
	await dialog.getByLabel('样式 Class', { exact: true }).fill('accept08');
	await dialog.getByLabel('扩展数据', { exact: true }).fill('{"verified":true}');
	await shot('dictionary-desktop-editor.png');
	await save(dialog, 'sysDictData/add');
	const item = db.prepare('SELECT * FROM SysDictData WHERE DictTypeId = ?').get(type.Id);
	assert.equal(item.ExtData, '{"verified":true}');
	assert.equal(item.StyleSetting, 'color: red');
	report.steps.push(stage);
	stage = 'dictionary-edit-duplicate-preserves-draft-and-refresh';
	await page.locator(`tr[data-row-key="${item.Id}"]`).getByRole('button', { name: '编辑字典值', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑字典值', exact: true });
	await expect(dialog.getByLabel('扩展数据', { exact: true })).toHaveValue('{"verified":true}');
	await dialog.getByLabel('显示文本', { exact: true }).fill('真实修改后');
	await save(dialog, 'sysDictData/update');
	assert.equal(db.prepare('SELECT Label FROM SysDictData WHERE Id = ?').get(item.Id).Label, '真实修改后');
	await page.getByRole('button', { name: '新增字典值', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '添加字典值', exact: true });
	await dialog.getByLabel('显示文本', { exact: true }).fill('重复草稿');
	await dialog.getByLabel('字典值', { exact: true }).fill('01');
	await save(dialog, 'sysDictData/add', false);
	await expect(dialog.getByLabel('显示文本', { exact: true })).toHaveValue('重复草稿');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.reload();
	await expect(page.getByRole('button', { name: '新增字典', exact: true })).toBeVisible();
	await page.locator('form[name="dict-type-query"]').getByLabel('名称', { exact: true }).fill(name);
	await page.locator('form[name="dict-type-query"]').getByRole('button', { name: /^查\s*询$/ }).click();
	await page.getByRole('button', { name, exact: true }).click();
	await expect(page.locator(`tr[data-row-key="${item.Id}"] .accept08`)).toHaveText('真实修改后');
	await expect(page.locator(`tr[data-row-key="${item.Id}"] .accept08`)).toHaveCSS('color', 'rgb(255, 0, 0)');
	await shot('dictionary-desktop-list.png');
	report.steps.push(stage);
	for (const [module, prefix, table] of [['config', 'sysConfig', 'SysConfig'], ['tenantConfig', 'sysTenantConfig', 'SysTenantConfig']]) {
		stage = `${module}-create-edit-reopen`;
		await page.goto(`${proxy.baseUrl}/#/${module === 'config' ? 'platform' : 'system'}/${module}`);
		await page.getByRole('button', { name: '新增配置', exact: true }).click();
		dialog = page.getByRole('dialog', { name: '添加配置', exact: true });
		await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
		await expect(dialog.getByText('请输入配置名称', { exact: true })).toBeVisible();
		await dialog.getByLabel('配置名称', { exact: true }).fill(name);
		await dialog.getByLabel('配置编码', { exact: true }).fill(name);
		await dialog.getByLabel('值', { exact: true }).fill(`${module}-value`);
		await save(dialog, `${prefix}/add`);
		const config = record(table, name);
		assert.ok(config);
		fixtures.push({ prefix, table, id: config.Id });
		await page.locator('form[name="config-query"]').getByLabel('配置名称', { exact: true }).fill(name);
		await page.getByRole('button', { name: /^查\s*询$/ }).click();
		await page.locator(`tr[data-row-key="${config.Id}"]`).getByRole('button', { name: '编辑配置', exact: true }).click();
		dialog = page.getByRole('dialog', { name: '编辑配置', exact: true });
		await dialog.getByLabel('值', { exact: true }).fill(`${module}-edited`);
		await shot(`${module}-desktop-editor.png`);
		await save(dialog, `${prefix}/update`);
		const persisted = table === 'SysConfig' ? record(table, name).Value : db.prepare('SELECT Value FROM SysTenantConfigData WHERE ConfigId = ?').get(config.Id).Value;
		assert.equal(persisted, `${module}-edited`);
		await page.reload();
		await page.locator('form[name="config-query"]').getByLabel('配置名称', { exact: true }).fill(name);
		await page.getByRole('button', { name: /^查\s*询$/ }).click();
		await expect(page.getByRole('cell', { name: `${module}-edited`, exact: true })).toBeVisible();
		await shot(`${module}-desktop-list.png`);
		report.steps.push(stage);
	}
	stage = 'cleanup-before-outage';
	await cleanupFixtures();
	report.steps.push(stage);
	if (process.argv.includes('--outage')) {
		stage = 'real-service-outage-preserves-config-draft';
		await page.getByRole('button', { name: '新增配置', exact: true }).click();
		dialog = page.getByRole('dialog', { name: '添加配置', exact: true });
		await dialog.getByLabel('配置名称', { exact: true }).fill(`${name}-outage`);
		await dialog.getByLabel('配置编码', { exact: true }).fill(`${name}-outage`);
		await dialog.getByLabel('值', { exact: true }).fill('草稿保留');
		execFileSync('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
		stopped = true;
		const [failed] = await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysTenantConfig/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
		assert.equal(failed.status(), 502);
		await expect(dialog.getByRole('alert')).toBeVisible();
		await expect(dialog.getByLabel('值', { exact: true })).toHaveValue('草稿保留');
		await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
		assert.equal(record('SysTenantConfig', `${name}-outage`), undefined);
		await shot('config-desktop-outage.png');
		report.steps.push(stage);
	}
	assert.deepEqual(errors, []);
	assert.deepEqual(report.consoleErrors, []);
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.pageErrors = errors;
	report.error = { name: error.name, message: String(error.message).split('\n').slice(0, 10).join('\n') };
	process.exitCode = 1;
	writeReport();
	if (page && stage !== 'login-dictionary-production') {
		report.dialogs = await page.getByRole('dialog').evaluateAll((elements) => elements.map((element) => ({
			buttons: [...element.querySelectorAll('button')].map((button) => ({ text: button.textContent, label: button.getAttribute('aria-label') })),
		}))).catch(() => []);
		await page.screenshot({ path: join(evidence, 'dictionary-failed.png') }).catch(() => undefined);
	}
} finally {
	for (const fixture of fixtures.filter((item) => !item.cleaned)) {
		try { await api(`${fixture.prefix}/delete`, { id: fixture.id }); assert.equal(db.prepare(`SELECT Id FROM ${fixture.table} WHERE Id = ?`).get(fixture.id), undefined); }
		catch { report.cleanupErrors.push(`delete-${fixture.prefix}`); }
	}
	try { if (session && !stopped) await api('sysAuth/logout'); } catch { report.cleanupErrors.push('logout'); }
	try { await context?.close(); await browser?.close(); } catch { report.cleanupErrors.push('browser'); }
	try { await proxy?.close(); } catch { report.cleanupErrors.push('proxy'); }
	try { db?.close(); } catch { report.cleanupErrors.push('database'); }
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (!report.cleanupPassed) process.exitCode = 1;
	writeReport();
	console.log(JSON.stringify({ passed: report.passed, cleanupPassed: report.cleanupPassed, failedStage: report.failedStage, report: join(evidence, 'dictionary-browser-baseline.json') }));
}
