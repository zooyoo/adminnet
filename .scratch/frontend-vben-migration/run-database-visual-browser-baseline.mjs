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
const parentTable = `${prefix}_users`;
const childTable = `${prefix}_orders`;
const auditTable = `${prefix}_audit`;
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-postgresql-relation-graph', steps: [], cleanupErrors: [] };
const secrets = [];
let runtime, evidence, marker, pg, base, admin, page, browser, proxy, stage = 'initialize', stopped = false;

function clean(value) {
	let text = String(value);
	for (const secret of secrets) text = text.replaceAll(secret, '[redacted]');
	return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]');
}
function record(name, details = {}) { report.steps.push({ name, ...details }); console.log(`PASS ${name}`); }
async function api(session, path, data, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method,
		headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}` } : {}) },
		body: method === 'POST' ? JSON.stringify(data ?? {}) : undefined,
		signal: AbortSignal.timeout(20000),
	});
	if (refusal && [401, 403].includes(response.status)) return;
	const text = await response.text();
	assert.ok(text, `${path} empty HTTP ${response.status}`);
	const result = JSON.parse(text);
	if (refusal) { assert.notEqual(result.code, 200, `${path} must reject`); return result; }
	assert.equal(result.code, 200, `${path} ${clean(result.message ?? '')}`);
	return result.result;
}
async function sql(statement, readOnly = true) {
	const query = readOnly ? `BEGIN READ ONLY; ${statement}; COMMIT;` : statement;
	const { stdout } = await execute('docker', ['exec', pg.containerName, 'psql', '-U', 'postgres', '-d', 'maintenance', '-At', '-v', 'ON_ERROR_STOP=1', '-c', query], { windowsHide: true, timeout: 20000 });
	return stdout.trim().split('\n').filter((line) => !['BEGIN', 'COMMIT'].includes(line.trim())).join('\n');
}
async function login(account) {
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim();
	secrets.push(password);
	const value = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(value.accessToken, value.refreshToken);
	return value;
}
async function select(label, text) {
	const input = page.getByRole('combobox', { name: label, exact: true });
	await input.click(); await input.fill(text);
	const dropdown = page.locator('.ant-select-dropdown:visible'); await expect(dropdown).toHaveCount(1);
	const option = dropdown.locator('.ant-select-item-option').filter({ hasText: text }); await expect(option).toHaveCount(1); await option.click(); await expect(dropdown).toHaveCount(0);
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), fullPage: true });
}
async function stop() {
	await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30000 });
	stopped = true;
}
try {
	runtime = realpathSync(process.argv[2]);
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	pg = JSON.parse(readFileSync(join(runtime, 'isolated-postgres.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	assert.equal(pg.runtimeRoot, runtime);
	base = new URL(marker.baseUrl);
	assert.equal(base.hostname, '127.0.0.1');
	const { stdout: label } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true });
	assert.equal(label.trim(), runtime);
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	admin = await login('superAdmin.NET');
	await sql(`CREATE TABLE "${parentTable}" ("Id" bigint PRIMARY KEY, "Name" varchar(64) NOT NULL)` , false);
	await sql(`CREATE TABLE "${childTable}" ("Id" bigint PRIMARY KEY, "UserId" bigint NOT NULL, CONSTRAINT "${childTable}_user_fk" FOREIGN KEY ("UserId") REFERENCES "${parentTable}" ("Id"))`, false);
	await sql(`CREATE TABLE "${auditTable}" ("Id" bigint PRIMARY KEY, "OrderId" bigint NOT NULL, "UserId" bigint NOT NULL, CONSTRAINT "${auditTable}_order_fk" FOREIGN KEY ("OrderId") REFERENCES "${childTable}" ("Id"), CONSTRAINT "${auditTable}_user_fk" FOREIGN KEY ("UserId") REFERENCES "${parentTable}" ("Id"))`, false);
	stage = 'service';
	const visual = await api(admin, `sysDatabase/visualDbTable?configId=${pg.configId}&tableName=${childTable}`, undefined, 'GET');
	assert.ok(visual.visualTableList.some((table) => table.tableName === parentTable));
	assert.ok(visual.visualTableList.some((table) => table.tableName === childTable));
	assert.ok(visual.visualTableList.some((table) => table.tableName === auditTable));
	assert.deepEqual(visual.columnRelationList.filter((relation) => relation.sourceTableName === childTable), [{ sourceTableName: childTable, sourceColumnName: 'UserId', type: 'ONE_TO_MANY', targetTableName: parentTable, targetColumnName: 'Id' }]);
	assert.equal(visual.columnRelationList.filter((relation) => relation.sourceTableName === auditTable).length, 2);
	await api(admin, `sysDatabase/visualDbTable?configId=${pg.configId}&tableName=${prefix}_missing`, undefined, 'GET', true);
	record('real-postgresql-tables-columns-and-foreign-key-metadata');
	const ordinary = await login('TestUser3');
	await api(ordinary, `sysDatabase/visualDbTable?configId=${pg.configId}`, undefined, 'GET', true);
	await api(undefined, `sysDatabase/visualDbTable?configId=${pg.configId}`, undefined, 'GET', true);
	record('anonymous-and-ungranted-visual-endpoint-refusals');
	if (!process.argv.includes('--service-only')) {
		stage = 'production-browser';
		proxy = await startProductionProxy(join(root, 'Web/dist'), base);
		browser = await chromium.launch({ channel: 'msedge', headless: true });
		page = await browser.newPage({ viewport: { width: 1680, height: 1100 } });
		page.setDefaultTimeout(20000);
		await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(admin.accessToken)}&redirect=${encodeURIComponent(`/develop/database?configId=${pg.configId}&tableName=${childTable}`)}`);
		await expect(page.locator('.database-page')).toBeVisible();
		await select('数据库', '隔离 PostgreSQL');
		await select('数据表', childTable);
		await page.getByRole('button', { name: '查看关系图', exact: true }).click();
		await expect(page.locator('.database-visual-page')).toBeVisible();
		await expect(page.locator('.graph-node')).toHaveCount(3);
		await expect(page.locator('.graph-node').filter({ hasText: parentTable })).toBeVisible();
		await expect(page.locator('.graph-node').filter({ hasText: childTable })).toHaveClass(/selected/);
		await page.getByRole('button', { name: '适配画布', exact: true }).click();
		await page.getByRole('button', { name: '居中画布', exact: true }).click();
		await expect.poll(async () => (await page.locator('.relation-graph').boundingBox())?.height ?? 0).toBeGreaterThan(500);
		const graphStage = await page.locator('.visual-stage').boundingBox();
		const childNode = page.locator('.rel-node-peel').filter({ has: page.locator('.graph-node').filter({ hasText: childTable }) });
		const before = await childNode.boundingBox();
		assert.ok(before && graphStage && before.y >= graphStage.y && before.y + before.height <= graphStage.y + graphStage.height, 'node must fit in visible canvas');
		await page.mouse.move(before.x + 25, before.y + 25);
		await page.mouse.down();
		await page.mouse.move(before.x + 65, before.y + 80, { steps: 10 });
		await page.mouse.up();
		await expect.poll(async () => Math.abs((await childNode.boundingBox()).x - before.x)).toBeGreaterThan(20);
		await page.locator('.graph-node').filter({ hasText: parentTable }).click();
		await expect(page.locator('.selection-panel')).toContainText(parentTable);
		const line = page.locator('.rel-linediv-el-lines .c-rg-line-bg');
		await expect(line).toHaveCount(3);
		// relation-graph 按接口数组绘制元素连线；核验对应首条真实关系，而非假设首条来自 orders。
		const firstRelation = visual.columnRelationList[0];
		const linePoint = await line.nth(0).evaluate((element) => {
			const point = element.getPointAtLength(element.getTotalLength() / 2);
			const screen = new DOMPoint(point.x, point.y).matrixTransform(element.getScreenCTM());
			return { x: screen.x, y: screen.y };
		});
		await page.mouse.click(linePoint.x, linePoint.y);
		await expect(page.locator('.selection-panel')).toContainText(`${firstRelation.sourceTableName}.${firstRelation.sourceColumnName}`);
		await expect(page.locator('.selection-panel')).toContainText(`${firstRelation.targetTableName}.${firstRelation.targetColumnName}`);
		await page.getByRole('button', { name: '适配画布', exact: true }).click();
		record('canvas-has-height-nodes-fit-and-drag-and-line-details-work');
		await shot('25-relation-graph-light.png');
		await page.reload();
		await expect(page.locator('.graph-node')).toHaveCount(3);
		const darkButton = page.getByRole('button', { name: 'dark', exact: true });
		if (await darkButton.count()) await darkButton.click();
		await expect(page.locator('html')).toHaveClass(/dark/);
		await shot('25-relation-graph-dark.png');
		record('production-desktop-entry-refresh-theme-and-graph-interactions');
		await sql(`ALTER TABLE "${childTable}" DROP CONSTRAINT "${childTable}_user_fk"`, false);
		await sql(`ALTER TABLE "${auditTable}" DROP CONSTRAINT "${auditTable}_order_fk"`, false);
		await sql(`ALTER TABLE "${auditTable}" DROP CONSTRAINT "${auditTable}_user_fk"`, false);
		await page.getByRole('button', { name: '刷新关系图', exact: true }).click();
		await expect(page.locator('.graph-node')).toHaveCount(3);
		await expect(page.locator('.rel-linediv-el-lines .c-rg-line-bg')).toHaveCount(0);
		assert.deepEqual((await api(admin, `sysDatabase/visualDbTable?configId=${pg.configId}`, undefined, 'GET')).columnRelationList, []);
		record('real-tables-without-foreign-keys-render-without-invented-lines');
		await sql(`DROP TABLE IF EXISTS "${auditTable}", "${childTable}", "${parentTable}" CASCADE`, false);
		assert.equal(await sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'"), '0');
		const empty = await api(admin, `sysDatabase/visualDbTable?configId=${pg.configId}`, undefined, 'GET');
		assert.deepEqual(empty, { visualTableList: [], visualColumnList: [], columnRelationList: [] });
		await page.goto(`${proxy.baseUrl}/#/develop/database/visual?configId=${pg.configId}`);
		await expect(page.getByText('当前数据库没有可展示的表', { exact: true })).toBeVisible();
		await expect(page.locator('.graph-node')).toHaveCount(0);
		record('real-empty-database-and-cleaned-schema-are-verified');
		record('relation-fixture-cleaned-before-outage');
		stage = 'stopped-service';
		await stop();
		await page.getByRole('button', { name: '刷新关系图', exact: true }).click();
		await expect(page.locator('.ant-alert')).toContainText(/请求失败|加载/);
		record('real-stopped-api-failure-is-visible');
	}
	report.passed = true;
} catch (error) {
	report.failure = { stage, error: clean(error.stack ?? error) };
	console.error(clean(`${stage}: ${error.message}`));
	if (page && evidence) await page.screenshot({ path: join(evidence, '25-failure.png'), fullPage: true }).catch(() => {});
} finally {
	if (!stopped && pg) await sql(`DROP TABLE IF EXISTS "${auditTable}", "${childTable}", "${parentTable}" CASCADE`, false).catch((error) => report.cleanupErrors.push(clean(error.message)));
	for (const [name, work] of [['browser', () => browser?.close()], ['proxy', () => proxy?.close()], ['api', () => !stopped && runtime ? stop() : undefined]]) {
		try { await work(); } catch (error) { report.cleanupErrors.push(clean(`${name}: ${error.message}`)); }
	}
	if (pg) {
		try {
			const { stdout: runtimeLabel } = await execute('docker', ['inspect', '--format', '{{ index .Config.Labels "adminnet.isolated-runtime" }}', pg.containerName], { windowsHide: true });
			assert.equal(runtimeLabel.trim(), runtime);
			await execute('docker', ['rm', '--force', '--volumes', pg.containerName], { windowsHide: true });
			report.containerRemoved = true;
		} catch (error) { report.cleanupErrors.push(clean(`container: ${error.message}`)); }
	}
	report.cleanupPassed = report.cleanupErrors.length === 0 && report.containerRemoved === true;
	if (evidence) { const path = join(evidence, 'database-visual-browser-baseline.json'); writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8'); console.log(`Report: ${path}`); }
}
if (!report.passed || !report.cleanupPassed) process.exitCode = 1;
