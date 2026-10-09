import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const prefix = `job-${randomBytes(5).toString('hex')}`;
const report = { passed: false, cleanupPassed: false, boundary: 'production-desktop-real-isolated-api', steps: [], cleanupErrors: [] };
const secrets = [], jobs = new Set();
let runtime, evidence, base, db, proxy, browser, context, page, fixture, fixtureUrl, admin, password, publicKey;
let stage = 'initialize', stopped = false, cancelStarted = false;
function record(name, details = {}) { report.steps.push({ name, ...details }); console.log(`PASS ${name}`); }
function clean(value) { let text = String(value); for (const secret of secrets) if (secret) text = text.replaceAll(secret, '[redacted]'); return text.replace(/token=[^&\s"']+/gi, 'token=[redacted]'); }
function localTime(value) {
	const pad = (number) => String(number).padStart(2, '0');
	return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}T${pad(value.getHours())}:${pad(value.getMinutes())}:${pad(value.getSeconds())}`;
}
async function api(session, path, data = {}, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { 'Content-Type': 'application/json', ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(30_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token'); session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
		secrets.push(session.accessToken, session.refreshToken);
	}
	if (refusal && [401, 403].includes(response.status)) return;
	const text = await response.text(); assert.ok(text, `${path.split('?')[0]} returned empty HTTP ${response.status}`);
	const result = JSON.parse(text);
	if (refusal) { assert.notEqual(result.code, 200, `${path} should refuse`); return result; }
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code} ${clean(result.message ?? '')}`); return result.result;
}
const jobApi = (action, data = {}, method = 'POST', refusal = false) => api(admin, `sysJob/${action}`, data, method, refusal);
async function login(account) {
	const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	secrets.push(session.accessToken, session.refreshToken); return session;
}
async function list(jobId = prefix) { return (await jobApi('pageJobDetail', { jobId, page: 1, pageSize: 100 })).items; }
async function detail(jobId) { const rows = await list(jobId); assert.equal(rows.length, 1); return rows[0]; }
async function trigger(jobId, triggerId) { return (await detail(jobId)).jobTriggers.find((value) => value.triggerId === triggerId); }
async function addJob(input) {
	jobs.add(input.jobId);
	await jobApi('addJobDetail', { groupName: `${prefix}-A`, description: `${prefix}-fixture`, concurrent: false, includeAnnotation: false, ...input });
	await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobDetail WHERE JobId = ?').get(input.jobId).n).toBe(1);
}
function httpInput(name, path) {
	return { jobId: `${prefix}-${name}`, createType: 2, properties: JSON.stringify({ marker: prefix, HttpJob: JSON.stringify({ RequestUri: `${fixtureUrl}/${path}`, HttpMethod: { Method: 'GET' }, ClientName: 'HttpJob', EnsureSuccessStatusCode: true, Timeout: 5000 }) }) };
}
function scriptInput(name, delay) {
	const jobId = `${prefix}-${name}`;
	const started = name === 'cancel' ? `using (var client = new System.Net.Http.HttpClient()) { await client.GetAsync("${fixtureUrl}/cancel-started", stoppingToken); }` : '';
	return { jobId, createType: 1, properties: JSON.stringify({ marker: prefix, nested: { retain: true } }), scriptCode: `using System.Threading; using System.Threading.Tasks; using Furion.Schedule; [JobDetail("${jobId}")] public class IsolatedJob : IJob { public async Task ExecuteAsync(JobExecutingContext context, CancellationToken stoppingToken) { ${started} await Task.Delay(${delay}, stoppingToken); context.Result = "isolated-success"; } }` };
}
async function addTrigger(jobId, name, values = {}) {
	const input = { jobId, triggerId: `${prefix}-${name}`, triggerType: 'Furion.Schedule.PeriodTrigger', assemblyName: 'Furion', args: '60000', startNow: false, runOnStart: false, resetOnlyOnce: true, maxNumberOfRuns: 0, maxNumberOfErrors: 0, numRetries: 0, retryTimeout: 1000, description: `${prefix}-trigger`, ...values };
	await jobApi('addJobTrigger', input); return input;
}
async function stopApi() { await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, timeout: 30_000 }); stopped = true; }
async function cleanup() {
	if (!db || !admin || stopped) return;
	for (const jobId of jobs) {
		try { if (db.prepare('SELECT COUNT(*) AS n FROM SysJobDetail WHERE JobId = ?').get(jobId).n) await jobApi('deleteJobDetail', { jobId }); }
		catch (error) { report.cleanupErrors.push(clean(`job-cleanup: ${error.message}`)); }
	}
	try {
		await jobApi('clearJobTriggerRecord');
		await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobDetail WHERE JobId LIKE ?').get(`${prefix}%`).n).toBe(0);
		await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobTrigger WHERE JobId LIKE ?').get(`${prefix}%`).n).toBe(0);
		assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysJobTriggerRecord').get().n, 0);
	} catch (error) { report.cleanupErrors.push(clean(`database-cleanup: ${error.message}`)); }
	report.cleanupPassed = report.cleanupErrors.length === 0;
}
async function enter(session = admin) {
	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(session.accessToken)}&redirect=%2Fplatform%2Fjob`);
	await expect(page.locator('.job-page')).toBeVisible();
}
async function shot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.evaluate(() => {
		for (const element of document.querySelectorAll('.ant-table-content, .ant-table-body, .job-editor, .trigger-editor')) element.scrollLeft = element.scrollTop = 0;
	});
	await page.screenshot({ path: join(evidence, name), fullPage: true, mask: [page.locator('input[type=password]')] });
}
async function responseFrom(action, endpoint) {
	const [response] = await Promise.all([page.waitForResponse((value) => new URL(value.url()).pathname.endsWith(`/sysJob/${endpoint}`) && value.request().method() === 'POST'), action()]);
	const result = await response.json(); assert.equal(result.code, 200, `${endpoint} code=${result.code}`); return result.result;
}
async function searchJob(jobId) {
	await page.getByLabel('查询任务编号', { exact: true }).fill(jobId);
	await responseFrom(() => page.getByRole('button', { name: '查询任务', exact: true }).click(), 'pageJobDetail');
	await expect(page.locator('.job-page tbody tr[data-row-key]').filter({ hasText: jobId })).toHaveCount(1);
	return page.locator('.job-page tbody tr[data-row-key]').filter({ hasText: jobId });
}
async function selectOption(dialog, label, text) {
	await dialog.getByRole('combobox', { name: label, exact: true }).click();
	const dropdown = page.locator('.ant-select-dropdown:visible');
	await expect(dropdown).toHaveCount(1);
	await dropdown.locator('.ant-select-item-option').filter({ hasText: text }).click();
	await expect(dropdown).toHaveCount(0);
}
async function confirmAction(target, title, endpoint) {
	await target.getByRole('button', { name: title, exact: true }).click();
	const dialog = page.getByRole('dialog', { name: `确认${title}`, exact: true });
	await responseFrom(() => dialog.getByRole('button', { name: '确认执行', exact: true }).click(), endpoint);
	await expect(dialog).toBeHidden();
}
try {
	runtime = realpathSync(process.argv[2]);
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase()); assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl); assert.equal(base.hostname, '127.0.0.1'); assert.equal(base.protocol, 'http:');
	const config = JSON.parse(readFileSync(join(runtime, 'appsettings.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(config.JobSchedule.IsolatedOnly, true);
	evidence = join(runtime, 'evidence'); mkdirSync(evidence, { recursive: true });
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true }); db.exec('PRAGMA busy_timeout=5000');
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysJobDetail').get().n, 0, 'Refusing global actions with pre-existing jobs');
	password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim(); assert.ok(password && publicKey); secrets.push(password);
	fixture = createServer((request, response) => { if (request.url === '/cancel-started') cancelStarted = true; response.writeHead(request.url === '/failure' ? 503 : 200, { 'Content-Type': 'text/plain' }); response.end(request.url === '/failure' ? 'isolated-failure' : 'isolated-success'); });
	await new Promise((accept) => fixture.listen(0, '127.0.0.1', accept)); fixtureUrl = `http://127.0.0.1:${fixture.address().port}`;
	admin = await login('superAdmin.NET'); record('isolated-precondition-no-production-jobs');
	if (process.argv.includes('--cancel-only')) {
		stage = 'cancel-probe';
		const input = scriptInput('cancel', 60000);
		for (let iteration = 0; iteration < 10; iteration++) {
			cancelStarted = false;
			await addJob(input);
			const value = await addTrigger(input.jobId, 'cancel-probe', { startNow: true });
			await jobApi('runJob', { jobId: input.jobId });
			await expect.poll(() => cancelStarted, { timeout: 10_000 }).toBe(true);
			await jobApi('cancelJob', { jobId: input.jobId });
			await expect.poll(async () => (await trigger(input.jobId, value.triggerId)).status, { timeout: 10_000 }).not.toBe(2);
			await jobApi('deleteJobDetail', { jobId: input.jobId });
		}
		record('cancel-ten-started-executions-stopped');
		report.passed = true;
	} else {
	stage = '21-service';
	const success = httpInput('http', 'success'), failure = httpInput('failure', 'failure'), cancel = scriptInput('cancel', 60000), cronJob = scriptInput('cron', 30);
	for (const input of [success, failure, cancel, cronJob]) await addJob(input);
	const initial = (await detail(success.jobId)).jobDetail;
	await jobApi('updateJobDetail', { ...initial, groupName: `${prefix}-B`, description: `${prefix}-edited` });
	const saved = (await detail(success.jobId)).jobDetail;
	assert.equal(saved.createType, 2); assert.equal(saved.groupName, `${prefix}-B`); assert.equal(JSON.parse(saved.properties).marker, prefix);
	assert.ok((await jobApi('listJobGroup')).includes(`${prefix}-B`));
	assert.equal((await jobApi('pageJobDetail', { description: `${prefix}-edited`, groupName: `${prefix}-B`, page: 1, pageSize: 1 })).total, 1);
	await jobApi('updateJobDetail', { ...saved, jobId: `${prefix}-changed` }, 'POST', true); await jobApi('updateJobDetail', { ...saved, createType: 1 }, 'POST', true); await jobApi('addJobDetail', success, 'POST', true);
	for (const action of ['runJob', 'pauseJob', 'startJob', 'cancelJob', 'deleteJobDetail']) await jobApi(action, { jobId: `${prefix}-missing` }, 'POST', true);
	const period = await addTrigger(success.jobId, 'period', { maxNumberOfRuns: 8, maxNumberOfErrors: 3, numRetries: 1, retryTimeout: 1200 });
	const periodStored = db.prepare('SELECT * FROM SysJobTrigger WHERE TriggerId = ?').get(period.triggerId); assert.equal(periodStored.Args, '[60000]');
	await jobApi('updateJobTrigger', { ...period, id: periodStored.Id, args: '90000', description: `${prefix}-period-edited` });
	assert.equal(db.prepare('SELECT Args FROM SysJobTrigger WHERE TriggerId = ?').get(period.triggerId).Args, '[90000]');
	await jobApi('startTrigger', period); await expect.poll(async () => (await trigger(period.jobId, period.triggerId)).status).toBe(1);
	await jobApi('pauseTrigger', period); await expect.poll(async () => (await trigger(period.jobId, period.triggerId)).status).toBe(3);
	await jobApi('startJob', { jobId: success.jobId }); await expect.poll(async () => (await trigger(period.jobId, period.triggerId)).status).toBe(1);
	await jobApi('runJob', { jobId: success.jobId });
	await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobTriggerRecord WHERE JobId = ? AND Result LIKE ?').get(success.jobId, '%isolated-success%').n, { timeout: 20_000 }).toBeGreaterThan(0);
	await expect.poll(async () => (await trigger(period.jobId, period.triggerId)).status, { timeout: 15_000 }).not.toBe(2);
	await jobApi('pauseJob', { jobId: success.jobId }); await expect.poll(async () => (await trigger(period.jobId, period.triggerId)).status).toBe(3);
	await addTrigger(failure.jobId, 'failure-period', { startNow: true }); await jobApi('runJob', { jobId: failure.jobId });
	await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobTriggerRecord WHERE JobId = ?').get(failure.jobId).n, { timeout: 20_000 }).toBeGreaterThan(0);
	const cancellable = await addTrigger(cancel.jobId, 'cancel-period', { startNow: true }); await jobApi('runJob', { jobId: cancel.jobId });
	await expect.poll(async () => (await trigger(cancel.jobId, cancellable.triggerId)).status).toBe(2);
	await expect.poll(() => cancelStarted, { timeout: 10_000 }).toBe(true);
	await jobApi('cancelJob', { jobId: cancel.jobId }); await expect.poll(async () => (await trigger(cancel.jobId, cancellable.triggerId)).status, { timeout: 15_000 }).not.toBe(2);
	await jobApi('pauseAllJob'); for (const job of await list()) for (const value of job.jobTriggers) assert.equal(value.status, 3);
	await jobApi('startAllJob'); for (const job of await list()) for (const value of job.jobTriggers) assert.equal(value.status, 1);
	await jobApi('pauseAllJob'); await jobApi('cancelSleep'); await jobApi('persistAll'); record('21-api-crud-controls-global-engine-semantics');
	stage = '22-service';
	for (const [expression, format] of [['*/5 * * * *', 0], ['*/5 * * * * 2026', 1], ['*/5 * * * * *', 2], ['*/5 * * * * * 2026', 3], ['@daily', 0]]) {
		const result = await jobApi('cronPreview', { expression, format, fromTime: '2026-10-09T12:00:00' });
		assert.equal(result.occurrences.length, 5); assert.ok(result.timeZoneId); assert.ok(result.occurrences.every((value, index, values) => !index || value > values[index - 1]));
	}
	for (const input of [{ expression: 'invalid', format: 2 }, { expression: '* * * * *', format: 2 }, { expression: '* * * * *', format: 4 }, { expression: '@daily', format: 0, timeZoneId: 'wrong-zone' }, { expression: '@daily', format: 0, fromTime: '2100-01-01' }, { expression: '0 0 0 * * *', format: 2, fromTime: '2026-10-09T12:00:00', endTime: '2026-10-09T13:00:00' }, { expression: '@daily', format: 0, startTime: '2026-10-10', endTime: '2026-10-09' }]) await jobApi('cronPreview', input, 'POST', true);
	const from = localTime(new Date()), startTime = localTime(new Date(Date.now() + 10000)), endTime = localTime(new Date(Date.now() + 26000));
	const preview = await jobApi('cronPreview', { expression: '*/2 * * * * *', format: 2, fromTime: from, startTime, endTime });
	const cron = await addTrigger(cronJob.jobId, 'cron-trigger', { triggerType: 'Furion.Schedule.CronTrigger', args: '"*/2 * * * * *",2', startTime, endTime, startNow: true, maxNumberOfRuns: 5 });
	await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobTriggerRecord WHERE JobId = ?').get(cronJob.jobId).n, { timeout: 35_000 }).toBe(5);
	const actualTimes = db.prepare('SELECT LastRunTime FROM SysJobTriggerRecord WHERE JobId = ? ORDER BY Id').all(cronJob.jobId).map((value) => value.LastRunTime.replace('T', ' ').slice(0, 19));
	assert.deepEqual(actualTimes, preview.occurrences); record('22-cron-formats-boundaries-real-five-occurrences', { timeZoneId: preview.timeZoneId, preview: preview.occurrences, actualTimes });
	stage = '23-service';
	const successRecords = await jobApi('pageJobTriggerRecord', { jobId: success.jobId, page: 1, pageSize: 1 }), failureRecords = await jobApi('pageJobTriggerRecord', { jobId: failure.jobId, page: 1, pageSize: 1 });
	assert.ok(successRecords.total > 0 && failureRecords.total > 0); assert.ok(successRecords.items[0].elapsedTime >= 0);
	assert.match(String(successRecords.items[0].result), /isolated-success/); assert.notEqual(failureRecords.items[0].status, successRecords.items[0].status);
	const first = await jobApi('pageJobTriggerRecord', { jobId: cronJob.jobId, triggerId: cron.triggerId, page: 1, pageSize: 2 }), second = await jobApi('pageJobTriggerRecord', { jobId: cronJob.jobId, triggerId: cron.triggerId, page: 2, pageSize: 2 });
	assert.equal(first.total, 5); assert.equal(second.items.length, 2); assert.notEqual(first.items[0].id, second.items[0].id);
	const clusters = await jobApi('jobClusterList', {}, 'GET'); assert.ok(clusters.some((value) => value.clusterId === 'isolated-job-cluster'));
	const ordinary = await login('TestUser3');
	for (const action of ['pageJobDetail', 'cronPreview', 'runJob', 'persistAll', 'clearJobTriggerRecord']) await api(ordinary, `sysJob/${action}`, { jobId: success.jobId, expression: '@daily', format: 0, page: 1, pageSize: 10 }, 'POST', true);
	await api(undefined, 'sysJob/cronPreview', { expression: '@daily', format: 0 }, 'POST', true);
	record('23-real-records-filter-pagination-cluster-and-permissions', { successStatus: successRecords.items[0].status, failureStatus: failureRecords.items[0].status });
	proxy = await startProductionProxy(join(root, 'Web/dist'), base); browser = await chromium.launch({ headless: true });
	context = await browser.newContext({ viewport: { width: 1680, height: 1100 } }); page = await context.newPage(); page.setDefaultTimeout(15_000);
	stage = '21-production-browser'; await enter(); await expect(page.getByRole('button', { name: '新增任务', exact: true })).toBeVisible();
	if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) {
		await page.getByRole('button', { name: 'light', exact: true }).click();
		await expect(page.locator('html')).not.toHaveClass(/dark/);
	}
	const browserHttp = httpInput('browser-http', 'success'); jobs.add(browserHttp.jobId);
	await page.getByRole('button', { name: '新增任务', exact: true }).click();
	let editor = page.getByRole('dialog', { name: '新增任务', exact: true });
	await editor.getByRole('button', { name: '保存任务', exact: true }).click();
	await expect(editor.getByRole('alert')).toContainText('任务编号');
	await editor.getByLabel('任务编号', { exact: true }).fill(browserHttp.jobId);
	await editor.getByLabel('任务分组', { exact: true }).fill(`${prefix}-browser`);
	await editor.getByLabel('HTTP 地址', { exact: true }).fill(`${fixtureUrl}/success`);
	await editor.getByLabel('任务参数 JSON', { exact: true }).fill(JSON.stringify({ nested: { retained: true } }));
	await responseFrom(() => editor.getByRole('button', { name: '保存任务', exact: true }).click(), 'addJobDetail');
	await expect(editor).toBeHidden();
	let row = await searchJob(browserHttp.jobId);
	await row.getByRole('button', { name: '编辑任务', exact: true }).click();
	editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
	await expect(editor.getByLabel('任务编号', { exact: true })).toBeDisabled();
	await editor.getByLabel('任务描述', { exact: true }).fill(`${prefix}-browser-edited`);
	await responseFrom(() => editor.getByRole('button', { name: '保存任务', exact: true }).click(), 'updateJobDetail');
	await expect(editor).toBeHidden();
	assert.equal(JSON.parse(db.prepare('SELECT Properties FROM SysJobDetail WHERE JobId = ?').get(browserHttp.jobId).Properties).nested.retained, true);
	row = await searchJob(browserHttp.jobId);
	await row.getByRole('button', { name: '编辑任务', exact: true }).click();
	await expect(editor.getByLabel('任务描述', { exact: true })).toHaveValue(`${prefix}-browser-edited`);
	await shot('21-job-editor.png');
	await editor.getByRole('button', { name: /^取\s*消$/ }).click();
	const browserScript = scriptInput('browser-script', 30); jobs.add(browserScript.jobId);
	await page.getByRole('button', { name: '新增任务', exact: true }).click();
	editor = page.getByRole('dialog', { name: '新增任务', exact: true });
	await selectOption(editor, '创建类型', '脚本');
	await editor.getByLabel('任务编号', { exact: true }).fill(browserScript.jobId);
	await editor.getByLabel('C# 脚本', { exact: true }).fill(browserScript.scriptCode);
	await responseFrom(() => editor.getByRole('button', { name: '保存任务', exact: true }).click(), 'addJobDetail');
	await expect(editor).toBeHidden();
	row = await searchJob(browserScript.jobId);
	await row.getByRole('button', { name: '编辑任务', exact: true }).click();
	editor = page.getByRole('dialog', { name: '编辑任务', exact: true });
	await editor.getByLabel('C# 脚本', { exact: true }).fill(browserScript.scriptCode.replace('isolated-success', 'browser-script-success'));
	await responseFrom(() => editor.getByRole('button', { name: '保存任务', exact: true }).click(), 'updateJobDetail');
	await expect(editor).toBeHidden();
	assert.match(db.prepare('SELECT ScriptCode FROM SysJobDetail WHERE JobId = ?').get(browserScript.jobId).ScriptCode, /browser-script-success/);
	record('21-browser-http-script-create-edit-reopen-validation');
	stage = '22-production-browser';
	row = await searchJob(browserHttp.jobId);
	await row.getByRole('button', { name: '触发器', exact: true }).click();
	await page.getByRole('button', { name: '新增触发器', exact: true }).click();
	let triggerEditor = page.getByRole('dialog', { name: '新增触发器', exact: true });
	await triggerEditor.getByLabel('触发器编号', { exact: true }).fill(`${prefix}-browser-cron`);
	await triggerEditor.getByRole('button', { name: '每天 9 点', exact: true }).click();
	await triggerEditor.getByLabel('Cron 分钟', { exact: true }).fill('15');
	await expect(triggerEditor.getByLabel('Cron 表达式', { exact: true })).toHaveValue('0 15 9 * * *');
	await triggerEditor.getByLabel('Cron 表达式', { exact: true }).fill('invalid');
	await triggerEditor.getByRole('button', { name: '预览后续 5 次', exact: true }).click();
	await expect(triggerEditor.getByRole('alert')).toBeVisible();
	await expect(triggerEditor.getByLabel('Cron 表达式', { exact: true })).toHaveValue('invalid');
	await triggerEditor.getByLabel('Cron 表达式', { exact: true }).fill('0 15 9 * * *');
	await triggerEditor.getByLabel('预览起点', { exact: true }).fill('2026-10-09T12:00');
	await responseFrom(() => triggerEditor.getByRole('button', { name: '预览后续 5 次', exact: true }).click(), 'cronPreview');
	await expect(triggerEditor.locator('.cron-preview li')).toHaveCount(5);
	await triggerEditor.getByLabel('立即启动', { exact: true }).click();
	await shot('22-cron-preview.png');
	await triggerEditor.locator('.cron-preview').scrollIntoViewIfNeeded();
	await page.screenshot({ path: join(evidence, '22-cron-preview-times.png'), fullPage: true });
	await responseFrom(() => triggerEditor.getByRole('button', { name: '保存触发器', exact: true }).click(), 'addJobTrigger');
	await expect(triggerEditor).toBeHidden();
	let triggerRow = page.locator('.job-triggers tbody tr[data-row-key]').filter({ hasText: `${prefix}-browser-cron` });
	await triggerRow.getByRole('button', { name: '编辑触发器', exact: true }).click();
	triggerEditor = page.getByRole('dialog', { name: '编辑触发器', exact: true });
	await expect(triggerEditor.getByLabel('Cron 表达式', { exact: true })).toHaveValue('0 15 9 * * *');
	await triggerEditor.getByLabel('触发器描述', { exact: true }).fill(`${prefix}-cron-edited`);
	await responseFrom(() => triggerEditor.getByRole('button', { name: '保存触发器', exact: true }).click(), 'updateJobTrigger');
	await expect(triggerEditor).toBeHidden();
	await page.getByRole('button', { name: '新增触发器', exact: true }).click();
	triggerEditor = page.getByRole('dialog', { name: '新增触发器', exact: true });
	await selectOption(triggerEditor, '触发器类型', '周期（毫秒）');
	await triggerEditor.getByLabel('触发器编号', { exact: true }).fill(`${prefix}-browser-period`);
	await triggerEditor.getByLabel('触发器参数', { exact: true }).fill('60000');
	await triggerEditor.getByLabel('最大运行次数', { exact: true }).fill('6');
	await triggerEditor.getByLabel('重试次数', { exact: true }).fill('1');
	await triggerEditor.getByLabel('立即启动', { exact: true }).click();
	await responseFrom(() => triggerEditor.getByRole('button', { name: '保存触发器', exact: true }).click(), 'addJobTrigger');
	await expect(triggerEditor).toBeHidden();
	const persistedPeriod = db.prepare('SELECT * FROM SysJobTrigger WHERE TriggerId = ?').get(`${prefix}-browser-period`);
	assert.equal(persistedPeriod.Args, '[60000]'); assert.equal(persistedPeriod.MaxNumberOfRuns, 6); assert.equal(persistedPeriod.NumRetries, 1);
	triggerRow = page.locator('.job-triggers tbody tr[data-row-key]').filter({ hasText: `${prefix}-browser-period` });
	await confirmAction(triggerRow, '启动触发器', 'startTrigger');
	await expect(triggerRow).toContainText('就绪');
	await confirmAction(triggerRow, '暂停触发器', 'pauseTrigger');
	await expect(triggerRow).toContainText('暂停');
	await confirmAction(triggerRow, '删除触发器', 'deleteJobTrigger');
	await expect(triggerRow).toHaveCount(0);
	await page.getByRole('button', { name: '收起触发器', exact: true }).click();
	row = await searchJob(success.jobId);
	await confirmAction(row, '启动任务', 'startJob');
	await confirmAction(row, '立即运行', 'runJob');
	await confirmAction(row, '暂停任务', 'pauseJob');
	await shot('21-job-list-light.png');
	await page.getByRole('button', { name: 'dark', exact: true }).click();
	await expect(page.locator('html')).toHaveClass(/dark/);
	await shot('21-job-list-dark.png');
	await page.getByRole('button', { name: 'light', exact: true }).click();
	await expect(page.locator('html')).not.toHaveClass(/dark/);
	record('22-browser-visual-cron-invalid-preview-save-edit-period-controls');
	stage = '23-production-browser';
	await row.getByRole('button', { name: '运行记录', exact: true }).click();
	let recordsDialog = page.getByRole('dialog', { name: `运行记录 · ${success.jobId}`, exact: true });
	await expect(recordsDialog).toContainText('isolated-success');
	await shot('23-job-records.png');
	await recordsDialog.getByRole('button', { name: '关闭', exact: true }).click();
	row = await searchJob(failure.jobId);
	await row.getByRole('button', { name: '运行记录', exact: true }).click();
	recordsDialog = page.getByRole('dialog', { name: `运行记录 · ${failure.jobId}`, exact: true });
	await expect(recordsDialog.locator('tbody tr[data-row-key]')).not.toHaveCount(0);
	await expect(recordsDialog).toContainText(statusText(failureRecords.items[0].status));
	await recordsDialog.getByRole('button', { name: '关闭', exact: true }).click();
	await page.getByRole('button', { name: '查看集群', exact: true }).click();
	const clusterDialog = page.getByRole('dialog', { name: '任务集群', exact: true });
	await expect(clusterDialog).toContainText('isolated-job-cluster');
	await shot('23-job-cluster.png');
	await clusterDialog.getByRole('button', { name: '关闭', exact: true }).click();
	const dashboardDataRequests = new Set();
	report.dashboardRequests = [];
	page.on('response', (response) => {
		const url = new URL(response.url());
		if (url.pathname.includes('/schedule')) {
			report.dashboardRequests.push({ path: url.pathname, type: response.request().resourceType(), status: response.status(), contentType: response.headers()['content-type'] });
			if (url.pathname.endsWith('/api/get-jobs') || url.pathname.endsWith('/api/timelines-log')) dashboardDataRequests.add(url.pathname + url.search);
		}
	});
	await page.getByRole('button', { name: '打开独立调度看板', exact: true }).click();
	const iframe = page.locator('iframe[title="独立调度看板"]');
	await expect(iframe).toHaveAttribute('src', '/schedule/');
	const frame = page.frameLocator('iframe[title="独立调度看板"]');
	await expect(frame.locator('input[type=password]')).toBeVisible();
	await expect(frame.locator('input:not([type=password])')).toHaveCount(1);
	await shot('23-dashboard-login.png');
	await frame.locator('input:not([type=password])').fill('superAdmin.NET');
	await frame.locator('input[type=password]').fill(password);
	await Promise.all([
		page.waitForResponse((value) => new URL(value.url()).pathname.includes('schedule') && value.request().method() === 'POST'),
		frame.getByRole('button', { name: '登录', exact: true }).click(),
	]);
	await expect(frame.locator('input[type=password]')).toHaveCount(0);
	await expect(frame.getByRole('tabpanel', { name: /作业列表/ }).locator('u').filter({ hasText: success.jobId })).toHaveCount(1);
	await expect(frame.getByText('登录成功', { exact: true })).toBeHidden({ timeout: 20_000 });
	await shot('23-dashboard-authenticated.png');
	assert.ok(dashboardDataRequests.size > 0, 'Dashboard data request must be observed');
	for (const path of dashboardDataRequests) {
		const response = await fetch(new URL(path, proxy.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}', signal: AbortSignal.timeout(15_000) });
		const content = await response.text();
		assert.ok([401, 403].includes(response.status) || /login|登录|401|403/i.test(content), 'Unauthenticated dashboard data request must be refused');
		assert.ok(!content.includes(prefix), 'Unauthenticated dashboard must not expose jobs');
	}
	record('23-browser-success-failure-records-cluster-original-dashboard-login');
	await page.goto(`${proxy.baseUrl}/#/platform/job`);
	await expect(page.locator('.job-page')).toBeVisible();
	await confirmAction(page.locator('.job-page'), '暂停所有任务', 'pauseAllJob');
	await confirmAction(page.locator('.job-page'), '持久化所有任务', 'persistAll');
	await confirmAction(page.locator('.job-page'), '清空全部运行记录', 'clearJobTriggerRecord');
	await expect.poll(() => db.prepare('SELECT COUNT(*) AS n FROM SysJobTriggerRecord').get().n).toBe(0);
	row = await searchJob(browserScript.jobId);
	await confirmAction(row, '删除任务', 'deleteJobDetail');
	await expect(row).toHaveCount(0);
	await cleanup(); assert.equal(report.cleanupPassed, true);
	stage = 'real-api-stopped';
	await page.getByRole('button', { name: '新增任务', exact: true }).click();
	editor = page.getByRole('dialog', { name: '新增任务', exact: true });
	await editor.getByLabel('任务编号', { exact: true }).fill(`${prefix}-stopped`);
	await editor.getByLabel('HTTP 地址', { exact: true }).fill(`${fixtureUrl}/success`);
	await stopApi();
	const stoppedResponse = page.waitForResponse((value) => new URL(value.url()).pathname.endsWith('/sysJob/addJobDetail'));
	await editor.getByRole('button', { name: '保存任务', exact: true }).click();
	assert.equal((await stoppedResponse).status(), 502);
	await expect(editor.getByRole('alert')).toBeVisible();
	await expect(editor.getByLabel('任务编号', { exact: true })).toHaveValue(`${prefix}-stopped`);
	await expect(editor.getByRole('button', { name: '保存任务', exact: true })).toBeEnabled();
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysJobDetail').get().n, 0);
	await expect(page.locator('.ant-message-success')).toHaveCount(0);
	await page.screenshot({ path: join(evidence, '21-api-stopped-draft.png'), fullPage: true });
	record('real-api-stop-no-false-success-draft-retained-no-write');
	report.passed = true;
	}
} catch (error) {
	report.failedStage = stage; report.error = clean(error.stack ?? error.message);
	if (evidence) writeFileSync(join(evidence, 'job-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	if (page && evidence) { try { await page.screenshot({ path: join(evidence, 'job-failure.png'), fullPage: true, mask: [page.locator('input[type=password]')] }); } catch {} }
	console.error(clean(`${stage}: ${error.message}`)); process.exitCode = 1;
} finally {
	await cleanup();
	if (context) await context.close(); if (browser) await browser.close(); if (proxy) await proxy.close(); if (db) db.close();
	if (fixture) await new Promise((accept) => { fixture.close(accept); fixture.closeAllConnections(); });
	if (runtime && !stopped) { try { await stopApi(); } catch (error) { report.cleanupErrors.push(clean(`api-stop: ${error.message}`)); report.cleanupPassed = false; } }
	if (evidence) writeFileSync(join(evidence, 'job-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ passed: report.passed, cleanupPassed: report.cleanupPassed, failedStage: report.failedStage, evidence }));
}
function statusText(status) { return ['积压', '就绪', '正在运行', '暂停', '阻塞', '失败后就绪', '归档', '崩溃', '超限', '无触发时间', '未启动', '未知触发器', '未知任务'][status]; }
