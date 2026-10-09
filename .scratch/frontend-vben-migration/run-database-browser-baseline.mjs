import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
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
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql', steps: [], cleanupErrors: [] };
const tables = new Set(), secrets = [];
let runtime, evidence, marker, pg, base, admin, page, browser, proxy, stage = 'initialize', stopped = false, browserEvents = [];
function clean(value) { let text = String(value); for (const secret of secrets) text = text.replaceAll(secret, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function record(name, details = {}) { report.steps.push({ name, ...details }); console.log(`PASS ${name}`); }
async function api(session, path, data, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), { method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) }, body: method === 'POST' ? JSON.stringify(data ?? {}) : undefined, signal: AbortSignal.timeout(20000) });
	if (refusal && [401, 403].includes(response.status)) return;
	const text = await response.text(); assert.ok(text, `${path} empty HTTP ${response.status}`);
	const result = JSON.parse(text);
	if (refusal) { assert.notEqual(result.code, 200, `${path} must reject`); return result; }
	assert.equal(result.code, 200, `${path} ${clean(result.message ?? '')}`); return result.result;
}
const dbApi = (action, input, method = 'POST', refusal = false) => api(admin, `sysDatabase/${action}`, input, method, refusal);
async function sql(statement) {
	const { stdout } = await execute('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', `BEGIN READ ONLY; ${statement}; COMMIT;`], { windowsHide: true, timeout: 20000 });
	return stdout.trim().split('\n').filter((line) => !['BEGIN', 'COMMIT'].includes(line.trim())).join('\n');
}
async function structure(table) {
	return JSON.parse(await sql(`SELECT coalesce(json_agg(row_to_json(c) ORDER BY ordinal_position), '[]') FROM (SELECT column_name,data_type,column_default,is_identity,is_nullable,character_maximum_length,numeric_precision,numeric_scale,ordinal_position FROM information_schema.columns WHERE table_schema='public' AND table_name='${table}') c`));
}
async function tableExists(table) { return (await structure(table)).length > 0; }
async function select(label, text) {
	const input = page.getByRole('combobox', { name: label, exact: true });
	await input.click(); await input.fill(text);
	const dropdown = page.locator('.ant-select-dropdown:visible'); await expect(dropdown).toHaveCount(1);
	const option = dropdown.locator('.ant-select-item-option').filter({ hasText: text }); await expect(option).toHaveCount(1); await option.click(); await expect(dropdown).toHaveCount(0);
}
async function response(action, endpoint) {
	const [result] = await Promise.all([page.waitForResponse((value) => new URL(value.url()).pathname.endsWith(`/sysDatabase/${endpoint}`) && value.request().method() === 'POST'), action()]);
	const body = await result.json(); assert.equal(body.code, 200, clean(body.message ?? endpoint));
}
async function save(editor, endpoint) {
	await editor.getByRole('button', { name: '保存结构', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确认保存结构', exact: true });
	await expect(dialog).toContainText('隔离 PostgreSQL');
	await response(() => dialog.getByRole('button', { name: '确认执行', exact: true }).click(), endpoint);
	await expect(editor).toBeHidden();
	console.log(`PASS browser-${endpoint}`);
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.evaluate(() => { for (const element of document.querySelectorAll('.ant-table-content,.ant-table-body,.structure-editor')) element.scrollLeft = element.scrollTop = 0; });
	await page.screenshot({ path: join(evidence, name), fullPage: true });
}
async function stop() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 }); stopped = true; }
async function cleanupTables() {
	for (const table of tables) {
		try { if (await tableExists(table)) { assert.equal(stopped, false); await dbApi('deleteTable', { configId: pg.configId, tableName: table }); } assert.equal(await tableExists(table), false); }
		catch (error) { report.cleanupErrors.push(clean(error.message)); }
	}
}
try {
	runtime = realpathSync(process.argv[2]); assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, '')); assert.equal(pg.runtimeRoot, runtime);
	base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal(base.protocol, 'http:');
	const { stdout } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true }); assert.equal(stdout.trim(), runtime);
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]; secrets.push(password);
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim();
	async function login(account) { const value = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }); secrets.push(value.accessToken, value.refreshToken); return value; }
	admin = await login('superAdmin.NET');
	const connections = await dbApi('list', undefined, 'GET'); assert.equal(connections.find((value) => value.configId === pg.configId).dbType, 'PostgreSQL'); assert.equal(connections.find((value) => value.configId === pg.configId).canMoveColumn, false);
	assert.match(await sql('SELECT version()'), /PostgreSQL/);
	const types = await dbApi(`dbTypeList/${pg.configId}`, undefined, 'GET'); assert.ok(types.includes('varchar'));
	record('isolated-postgresql-ready', { typesCount: types.length });
	stage = 'service';
	const table = `${prefix}_service`; tables.add(table);
	const columns = [
		{ dbColumnName: 'Id', dataType: 'bigint', isPrimarykey: 1, isIdentity: 1, isNullable: 0, length: 0, decimalDigits: 0, columnDescription: '主键' },
		{ dbColumnName: 'Title', dataType: 'varchar', isPrimarykey: 0, isIdentity: 0, isNullable: 0, length: 64, decimalDigits: 0, defaultValue: "'初始'", columnDescription: '标题' },
		{ dbColumnName: 'Amount', dataType: types.includes('numeric') ? 'numeric' : 'decimal', isPrimarykey: 0, isIdentity: 0, isNullable: 1, length: 12, decimalDigits: 3, defaultValue: '1.25', columnDescription: '金额' },
	];
	await dbApi('addTable', { configId: pg.configId, tableName: table, description: '隔离验收表', dbColumnInfoList: columns });
	const created = await structure(table); assert.equal(created.length, 3); assert.equal(created[1].character_maximum_length, 64); assert.match(created[1].column_default, /初始/); assert.equal(created[2].numeric_scale, 3);
	assert.equal(await sql(`SELECT count(*) FROM information_schema.table_constraints WHERE table_name='${table}' AND constraint_type='PRIMARY KEY'`), '1'); assert.equal(created[0].is_identity, 'YES');
	await dbApi('addTable', { configId: pg.configId, tableName: table, dbColumnInfoList: columns }, 'POST', true); assert.deepEqual(await structure(table), created);
	await dbApi('updateTable', { configId: pg.configId, oldTableName: table, tableName: table, description: '更新备注' });
	assert.equal(await sql(`SELECT obj_description(to_regclass('"${table}"'))`), '更新备注');
	await dbApi('updateColumn', { configId: pg.configId, tableName: table, oldColumnName: 'Title', columnName: 'Label', description: '新标题', defaultValue: "'O''Brien'" });
	assert.match((await structure(table))[1].column_default, /O''Brien/);
	await dbApi('updateColumn', { configId: pg.configId, tableName: table, oldColumnName: 'Label', columnName: 'Label', description: '新标题', defaultValue: '' }); assert.equal((await structure(table))[1].column_default, null);
	await dbApi('addColumn', { ...columns[1], configId: pg.configId, tableName: table, dbColumnName: 'Extra', isNullable: 1, defaultValue: "'附加'" });
	assert.match((await structure(table)).find((value) => value.column_name === 'Extra').column_default, /附加/);
	await dbApi('deleteColumn', { configId: pg.configId, tableName: table, dbColumnName: 'Extra' }); assert.equal((await structure(table)).length, 3);
	const before = await structure(table); await dbApi('moveColumn', { configId: pg.configId, tableName: table, columnName: 'Amount', afterColumnName: '' }, 'POST', true); assert.deepEqual(await structure(table), before);
	const apiColumns = await dbApi(`columnList/${table}/${pg.configId}`, undefined, 'GET');
	assert.equal(apiColumns.find((value) => value.dbColumnName === 'Id').isIdentity, true); assert.equal(apiColumns.find((value) => value.dbColumnName === 'Id').isPrimarykey, true);
	await dbApi('addColumn', { ...columns[1], configId: pg.configId, tableName: table, dbColumnName: 'Bad', defaultValue: '0;DROP TABLE x' }, 'POST', true); assert.deepEqual(await structure(table), before);
	const renamed = `${prefix}_renamed`; tables.add(renamed); await dbApi('updateTable', { configId: pg.configId, oldTableName: table, tableName: renamed, description: '重命名备注' }); assert.equal(await tableExists(table), false); assert.equal((await structure(renamed)).length, 3);
	record('real-postgresql-schema-crud-constraints-defaults-and-capability-boundary');
	const ordinary = await login('TestUser3');
	for (const action of ['list', `tableList/${pg.configId}`, `columnList/${renamed}/${pg.configId}`, `dbTypeList/${pg.configId}`]) await api(ordinary, `sysDatabase/${action}`, undefined, 'GET', true);
	for (const action of ['addTable', 'updateTable', 'addColumn', 'updateColumn', 'deleteColumn', 'deleteTable', 'moveColumn']) await api(ordinary, `sysDatabase/${action}`, { configId: pg.configId, tableName: renamed }, 'POST', true);
	await api(undefined, 'sysDatabase/addTable', {}, 'POST', true); assert.equal((await structure(renamed)).length, 3); record('anonymous-and-ungranted-real-endpoint-refusals');
	if (!process.argv.includes('--service-only')) {
		stage = 'production-browser'; proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ channel: 'msedge', headless: true }); page = await browser.newPage({ viewport: { width: 1680, height: 1100 } }); page.setDefaultTimeout(15000);
		browserEvents = []; page.on('request', (request) => { if (request.url().includes('/sysDatabase/')) browserEvents.push(`request ${request.method()} ${new URL(request.url()).pathname}`); }); page.on('requestfailed', (request) => { if (request.url().includes('/sysDatabase/')) browserEvents.push(`failed ${request.method()} ${new URL(request.url()).pathname} ${request.failure()?.errorText ?? ''}`); });
		await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(admin.accessToken)}&redirect=%2Fdevelop%2Fdatabase`); await expect(page.locator('.database-page')).toBeVisible();
		await select('数据库', '隔离 PostgreSQL');
		const uiTable = `${prefix}_ui`; tables.add(uiTable);
		await page.getByRole('button', { name: '增加表', exact: true }).click(); let editor = page.getByRole('dialog', { name: '增加表', exact: true });
		await editor.getByLabel('表名称', { exact: true }).fill(uiTable); await editor.getByLabel('表描述', { exact: true }).fill('桌面真实表'); await editor.getByLabel('字段 1 描述', { exact: true }).fill('编号');
		await editor.getByRole('button', { name: '新增普通字段', exact: true }).click(); await editor.getByLabel('字段 2 字段名', { exact: true }).fill('Title'); await editor.getByLabel('字段 2 默认值', { exact: true }).fill("'桌面'");
		await shot('24-create-table.png'); await save(editor, 'addTable'); await expect(page.locator('.database-page h2')).toHaveText(uiTable); assert.equal((await structure(uiTable)).length, 2);
		await page.getByRole('button', { name: '编辑表', exact: true }).click(); editor = page.getByRole('dialog', { name: '编辑表', exact: true }); await editor.getByLabel('表描述', { exact: true }).fill('桌面改表'); await save(editor, 'updateTable'); assert.equal(await sql(`SELECT obj_description(to_regclass('"${uiTable}"'))`), '桌面改表');
		await page.getByRole('button', { name: '增加字段', exact: true }).click(); editor = page.getByRole('dialog', { name: '增加字段', exact: true }); await editor.getByLabel('字段 1 字段名', { exact: true }).fill('Extra'); await editor.getByLabel('字段 1 默认值', { exact: true }).fill("'扩展'"); await save(editor, 'addColumn'); await expect(page.locator('tr[data-row-key="Extra"]')).toBeVisible();
		await page.getByRole('button', { name: '编辑 Extra', exact: true }).click(); editor = page.getByRole('dialog', { name: '编辑字段', exact: true }); await editor.getByLabel('字段 1 字段名', { exact: true }).fill('Renamed'); await editor.getByLabel('字段 1 描述', { exact: true }).fill('桌面编辑'); await save(editor, 'updateColumn'); await expect(page.locator('tr[data-row-key="Renamed"]')).toBeVisible();
		await expect(page.getByRole('button', { name: '上移 Renamed', exact: true })).toBeDisabled(); await expect(page.getByRole('button', { name: '删除表', exact: true })).toBeDisabled();
		await shot('24-columns-light.png');
		await page.getByRole('button', { name: '删除 Renamed', exact: true }).click(); const confirm = page.getByRole('dialog', { name: '确认删除字段', exact: true }); await expect(confirm).toContainText(uiTable); await confirm.getByRole('button', { name: /取\s*消/ }).click(); assert.equal((await structure(uiTable)).length, 3);
		await page.getByRole('button', { name: '删除 Renamed', exact: true }).click(); await response(() => confirm.getByRole('button', { name: '确认执行', exact: true }).click(), 'deleteColumn'); await expect(page.locator('tr[data-row-key="Renamed"]')).toHaveCount(0);
		await page.reload(); await expect(page.locator('.database-page')).toBeVisible(); await select('数据库', '隔离 PostgreSQL'); await select('数据表', uiTable); await expect(page.locator('tr[data-row-key="Title"]')).toBeVisible();
		await select('数据库', '1300000000001'); await expect(page.locator('.database-page tbody tr[data-row-key]')).toHaveCount(0); await expect(page.getByRole('button', { name: '增加字段', exact: true })).toBeDisabled(); await select('数据库', '隔离 PostgreSQL'); await select('数据表', '桌面改表'); await expect(page.locator('.database-page h2')).toHaveText(uiTable);
		const darkButton = page.getByRole('button', { name: 'dark', exact: true }); if (await darkButton.count()) await darkButton.click(); await expect(page.locator('html')).toHaveClass(/dark/); await shot('24-columns-dark.png');
		record('production-desktop-crud-confirmations-search-switch-refresh-and-themes');
		stage = 'cleanup-before-stop'; await cleanupTables(); assert.equal(report.cleanupErrors.length, 0); record('created-tables-removed-and-postgresql-rechecked');
		await page.getByRole('button', { name: '增加表', exact: true }).click(); editor = page.getByRole('dialog', { name: '增加表', exact: true }); await editor.getByLabel('表名称', { exact: true }).fill(`${prefix}_offline`); tables.add(`${prefix}_offline`);
		stage = 'stopped-service'; await stop(); await editor.getByRole('button', { name: '保存结构', exact: true }).click(); const stoppedConfirm = page.getByRole('dialog', { name: '确认保存结构', exact: true }); const [failed] = await Promise.all([page.waitForResponse((value) => new URL(value.url()).pathname.endsWith('/sysDatabase/addTable')), stoppedConfirm.getByRole('button', { name: '确认执行', exact: true }).click()]); assert.ok(failed.status() >= 400); await expect(editor.locator('.ant-alert')).toBeVisible(); await expect(editor.getByLabel('表名称', { exact: true })).toHaveValue(`${prefix}_offline`); assert.equal(await tableExists(`${prefix}_offline`), false); await shot('24-stopped-service-draft.png'); record('real-stopped-api-failure-retains-draft-no-write');
	}
	report.passed = true;
} catch (error) {
	report.failure = { stage, error: clean(error.stack ?? error) }; console.error(clean(`${stage}: ${error.message}`));
	if (page) {
		const state = await page.locator('.ant-modal-content').evaluateAll((elements) => elements.map((element) => ({ title: element.querySelector('.ant-modal-title')?.textContent, errors: [...element.querySelectorAll('.ant-alert')].map((alert) => alert.textContent), buttons: [...element.querySelectorAll('button')].map((button) => ({ name: button.getAttribute('aria-label') || button.textContent, disabled: button.disabled })) }))).catch(() => []);
		console.error(clean(JSON.stringify(state)));
		console.error(clean(JSON.stringify(browserEvents.slice(-30))));
	}
	if (page && evidence) await page.screenshot({ path: join(evidence, '24-failure.png'), fullPage: true }).catch(() => {});
} finally {
	if (pg && admin && !stopped) await cleanupTables();
	for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime ? stop() : undefined]]) { try { await work(); } catch (error) { report.cleanupErrors.push(clean(`${name}: ${error.message}`)); } }
	if (pg) {
		try { const { stdout } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true }); assert.equal(stdout.trim(), runtime); await execute('docker', ['rm', '--force', '--volumes', pg.containerName], { windowsHide: true }); report.containerRemoved = true; }
		catch (error) { report.cleanupErrors.push(clean(`container: ${error.message}`)); }
	}
	report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true;
	if (evidence) { const path = join(evidence, 'database-browser-baseline.json'); writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(`Report: ${path}`); }
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
