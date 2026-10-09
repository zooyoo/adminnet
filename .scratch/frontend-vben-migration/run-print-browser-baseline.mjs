import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const execute = promisify(execFile);
const { chromium, expect } = createRequire(join(root, 'Web/package.json'))('@playwright/test');
const xlsx = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('xlsx-js-style');
const { sm2 } = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('sm-crypto-v2');
const prefix = `print-${randomBytes(4).toString('hex')}`;
const report = {
	boundary: 'production-desktop-real-isolated-api-local-print-service',
	cleanupErrors: [],
	cleanupPassed: false,
	passed: false,
	proposalComplete: false,
	steps: [],
	diagnostics: [],
};
let runtime;
let base;
let evidence;
let database;
let password;
let publicKey;
let admin;
let ordinary;
let browser;
let context;
let page;
let proxy;
let printServer;
let printServiceUrl;
let stopped = false;
let cleaned = false;
const printJobs = [];
const printIds = new Set();
const posCodes = new Set();
const python = process.env.PDF_TEST_PYTHON ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');

async function pdfText(path) {
	const result = await execute(python, ['-c', 'import sys; from pypdf import PdfReader; sys.stdout.reconfigure(encoding="utf-8"); print("\\n".join(p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages))', path], { windowsHide: true, encoding: 'utf8' });
	return result.stdout;
}

function apiHeaders(session) {
	return session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {};
}

function updateTokens(response, session) {
	if (!session) return;
	const accessToken = response.headers.get('access-token');
	if (accessToken && accessToken !== 'invalid_token') session.accessToken = accessToken;
	const refreshToken = response.headers.get('x-access-token');
	if (refreshToken) session.refreshToken = refreshToken;
}

async function api(session, path, body, method = 'POST', refusal = false) {
	const response = await fetch(new URL(`/api/${path}`, base), {
		body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
		headers: { 'Content-Type': 'application/json', ...apiHeaders(session) },
		method,
		signal: AbortSignal.timeout(30_000),
	});
	updateTokens(response, session);
	if (refusal && [401, 403].includes(response.status)) return undefined;
	const result = await response.json();
	if (refusal) {
		assert.notEqual(result.code, 200, `${path} must be refused`);
		return undefined;
	}
	assert.equal(result.code, 200, `${path} returned ${result.code}`);
	return result.result;
}

async function login(account) {
	const session = await api(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) });
	assert.ok(session.accessToken);
	return session;
}

async function launchApi() {
	return new Promise((resolveLaunch, reject) => {
		const process = spawn(
			'pwsh',
			['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/start-isolated-api.ps1'), '-CrudFixture'],
			{ stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
		);
		let output = '';
		const timeout = setTimeout(() => {
			process.kill();
			reject(new Error('隔离 API 启动超时'));
		}, 180_000);
		process.stdout.on('data', (chunk) => {
			output += chunk;
			const match = output.match(/Runtime: ([^\r\n]+)/);
			if (!match || !output.includes('Ready: real sysConfig/sysInfo returned code 200.')) return;
			clearTimeout(timeout);
			process.stdout.destroy();
			process.stderr.destroy();
			process.unref();
			resolveLaunch(realpathSync(match[1]));
		});
		process.once('error', reject);
		process.once('exit', (code) => {
			if (code) {
				clearTimeout(timeout);
				reject(new Error('隔离 API 启动失败'));
			}
		});
	});
}

async function startPrintService() {
	printServer = createServer((request, response) => {
		response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Pdfme-Copies, X-Pdfme-Title');
		response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
		response.setHeader('Access-Control-Allow-Origin', '*');
		if (request.method === 'OPTIONS') {
			response.writeHead(204).end();
			return;
		}
		if (request.method === 'POST' && request.url === '/reject') {
			request.resume();
			response.writeHead(503, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: false }));
			return;
		}
		if (request.method !== 'POST' || request.url !== '/print') {
			response.writeHead(404).end();
			return;
		}
		const chunks = [];
		request.on('data', (chunk) => chunks.push(chunk));
		request.on('end', () => {
			const body = Buffer.concat(chunks);
			printJobs.push({
				bytes: body,
				copies: request.headers['x-pdfme-copies'],
				title: decodeURIComponent(request.headers['x-pdfme-title'] ?? ''),
			});
			if (evidence) writeFileSync(join(evidence, `print-job-${printJobs.length}.pdf`), body);
			response.writeHead(202, { 'content-type': 'application/json' }).end(JSON.stringify({ accepted: true }));
		});
	});
	await new Promise((resolveListen, reject) => {
		printServer.once('error', reject);
		printServer.listen(0, '127.0.0.1', resolveListen);
	});
	printServiceUrl = `http://127.0.0.1:${printServer.address().port}/print`;
}

async function screenshot(name) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await expect.poll(() => page.evaluate(() => document.getAnimations().filter((item) => item.playState === 'running' && item.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
	await page.screenshot({ path: join(evidence, name), fullPage: true });
}

async function stopApi() {
	if (stopped) return;
	await execute('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], {
		timeout: 30_000,
		windowsHide: true,
	});
	stopped = true;
}

async function cleanup() {
	for (const id of printIds) {
		try {
			if (database.prepare('SELECT Id FROM SysPrint WHERE Id = ?').get(id)) await api(admin, 'sysPrint/delete', { id });
		} catch {
			report.cleanupErrors.push(`print-${id}`);
		}
	}
	for (const code of posCodes) {
		try {
			const item = database.prepare('SELECT Id FROM SysPos WHERE Code = ?').get(code);
			if (item) await api(admin, 'sysPos/delete', { id: item.Id });
		} catch {
			report.cleanupErrors.push(`pos-${code}`);
		}
	}
	try {
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPrint WHERE Name LIKE ?').get(`${prefix}%`).count, 0);
		assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code LIKE ?').get(`${prefix}%`).count, 0);
	} catch {
		report.cleanupErrors.push('database');
	}
	report.cleanupPassed = report.cleanupErrors.length === 0;
	cleaned = report.cleanupPassed;
}

try {
	await execute(python, ['-c', 'import pypdf'], { windowsHide: true });
	runtime = await launchApi();
	assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
	assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
	const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
	assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
	base = new URL(marker.baseUrl);
	assert.equal(base.hostname, '127.0.0.1');
	evidence = join(runtime, 'evidence');
	mkdirSync(evidence, { recursive: true });
	database = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	database.exec('PRAGMA busy_timeout = 5000');
	password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	assert.ok(password && publicKey);
	admin = await login('superAdmin.NET');
	ordinary = await login('TestUser3');
	await startPrintService();

	const template = JSON.stringify({
		basePdf: { height: 297, padding: [12, 12, 12, 12], width: 210 },
		schemas: [[
			{ content: '职位清单', readOnly: true, fontName: 'SourceHanSerifSC', height: 12, name: 'title', position: { x: 12, y: 16 }, type: 'text', width: 120 },
			{ content: '编号：{code}', readOnly: true, fontName: 'SourceHanSerifSC', height: 8, name: 'code', position: { x: 12, y: 36 }, type: 'text', width: 140 },
			{ content: '名称：{name}', readOnly: true, fontName: 'SourceHanSerifSC', height: 8, name: 'name', position: { x: 12, y: 48 }, type: 'text', width: 140 },
			{ content: '打印时间：{printedAt}', readOnly: true, fontName: 'SourceHanSerifSC', height: 8, name: 'printedAt', position: { x: 12, y: 60 }, type: 'text', width: 140 },
		]],
	});
	const printName = `${prefix}-中文模板`;
	await api(admin, 'sysPrint/add', {
		clientServiceAddress: printServiceUrl,
		name: printName,
		orderNo: 1,
		printDataDemo: JSON.stringify([{ code: `${prefix}-示例`, name: '中文测试数据', printedAt: '2026-10-09 10:00:00' }]),
		printParam: JSON.stringify({ copies: 2, title: '隔离打印任务' }),
		printType: 2,
		status: 1,
		template,
	});
	const savedTemplate = await api(admin, 'sysPrint/page', { name: printName, page: 1, pageSize: 20 });
	const templateId = savedTemplate.items[0]?.id;
	assert.ok(templateId);
	printIds.add(templateId);
	assert.equal(JSON.parse(database.prepare('SELECT Template FROM SysPrint WHERE Id = ?').get(templateId).Template).schemas[0][0].content, '职位清单');
	await api(ordinary, 'sysPrint/page', { name: printName, page: 1, pageSize: 20 }, 'POST', true);
	report.steps.push('real-api-save-and-permission');

	const positionFixtures = [['中文岗位甲', `${prefix}-A`], ['中文岗位乙', `${prefix}-B`], ['其他岗位', `${prefix}-C`], ...Array.from({ length: 22 }, (_, index) => [`分页岗位${String(index).padStart(2, '0')}`, `${prefix}-D${String(index).padStart(2, '0')}`])];
	for (const [index, [name, code]] of positionFixtures.entries()) {
		await api(admin, 'sysPos/add', { code, name, orderNo: index + 1, status: 1 });
		posCodes.add(code);
	}
	assert.equal(database.prepare('SELECT COUNT(*) AS count FROM SysPos WHERE Code LIKE ?').get(`${prefix}%`).count, 25);
	report.steps.push('real-list-fixture');

	proxy = await startProductionProxy(join(root, 'Web/dist'), base);
	browser = await chromium.launch({ channel: 'msedge', headless: true });
	context = await browser.newContext({ acceptDownloads: true, viewport: { height: 1100, width: 1440 } });
	page = await context.newPage();
	page.setDefaultTimeout(30_000);
	page.on('pageerror', (error) => report.diagnostics.push({ kind: 'pageerror', message: error.message.replace(/https?:\/\/\S+/g, '[URL]') }));
	page.on('requestfailed', (request) => {
		const path = new URL(request.url()).pathname;
		if (path.startsWith('/fonts/') || path === '/print') report.diagnostics.push({ kind: 'requestfailed', path, error: request.failure()?.errorText });
	});
	page.on('response', (response) => {
		const path = new URL(response.url()).pathname;
		if (path.startsWith('/fonts/') || path === '/print') report.diagnostics.push({ kind: 'response', path, status: response.status() });
	});

	await page.goto(`${proxy.baseUrl}/#/login?token=${encodeURIComponent(admin.accessToken)}&redirect=%2Fplatform%2Fprint`);
	await expect(page.getByRole('button', { name: '新增模板', exact: true })).toBeVisible();
	const printRow = page.getByRole('row').filter({ hasText: printName });
	await printRow.getByRole('button', { name: '编辑模板' }).click();
	const editor = page.getByRole('dialog', { name: '编辑打印模板', exact: true });
	await expect(editor.locator('.designer-host > *')).not.toHaveCount(0);
	await expect(editor.getByLabel('模板名称', { exact: true })).toHaveValue(printName);
	await expect(editor.getByLabel('预览数据', { exact: true })).toHaveValue(/中文测试数据/);
	await screenshot('print-template-designer.png');
	await editor.getByRole('button', { name: '执行打印', exact: true }).click();
	await expect.poll(async () => {
		const errors = await page.locator('.ant-message-error').allTextContents();
		assert.deepEqual(errors, [], 'PDF 生成或打印失败');
		return printJobs.length;
	}, { timeout: 60_000 }).toBe(1);
	assert.ok(printJobs[0].bytes.subarray(0, 4).equals(Buffer.from('%PDF')));
	assert.equal(printJobs[0].copies, '2');
	assert.equal(printJobs[0].title, '隔离打印任务');
	const templateText = await pdfText(join(evidence, 'print-job-1.pdf'));
	assert.match(templateText, /职位清单/);
	assert.match(templateText, /编号：/);
	assert.match(templateText, /名称：中文测试数据/);
	await expect(page.getByText('已提交到打印服务', { exact: true })).toBeVisible();
	await editor.getByLabel('打印参数', { exact: true }).fill(JSON.stringify({ copies: 3, title: '重开测试任务' }));
	const updateResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPrint/update'));
	await editor.getByRole('button', { name: /^确\s*定$/ }).click();
	assert.equal((await (await updateResponse).json()).code, 200);
	await expect(editor).toBeHidden();
	assert.equal(JSON.parse(database.prepare('SELECT PrintParam FROM SysPrint WHERE Id = ?').get(templateId).PrintParam).copies, 3);
	await printRow.getByRole('button', { name: '编辑模板' }).click();
	const reopened = page.getByRole('dialog', { name: '编辑打印模板', exact: true });
	await expect(reopened.locator('.designer-host > *')).not.toHaveCount(0);
	await expect(reopened.getByLabel('打印参数', { exact: true })).toHaveValue(/"copies":3/);
	await reopened.getByLabel('客户端服务地址', { exact: true }).fill('http://127.0.0.1:1/unavailable');
	await reopened.getByRole('button', { name: '执行打印', exact: true }).click();
	await expect(page.getByText(/打印服务不可用/)).toBeVisible();
	await expect(page.getByText('已提交到打印服务', { exact: true })).toHaveCount(0);
	await reopened.getByRole('button', { name: /^取\s*消$/ }).click();
	report.steps.push('designer-save-reopen-local-print-service-and-unavailable');

	await page.getByRole('button', { name: '新增模板', exact: true }).click();
	const newEditor = page.getByRole('dialog', { name: '新增打印模板', exact: true });
	await expect(newEditor.locator('.designer-host > *')).not.toHaveCount(0);
	await newEditor.getByRole('combobox').click();
	await page.getByTitle('商品清单', { exact: true }).click();
	await newEditor.getByRole('button', { name: '应用模板' }).click();
	await page.getByRole('dialog').filter({ hasText: '替换当前设计及预览数据？' }).getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(newEditor.getByLabel('预览数据', { exact: true })).toHaveValue(/示例商品/);
	await expect(newEditor.locator('.designer-host > *')).not.toHaveCount(0);
	const commonName = `${prefix}-商品模板`;
	await newEditor.getByLabel('模板名称', { exact: true }).fill(commonName);
	await newEditor.getByLabel('客户端服务', { exact: true }).check();
	await newEditor.getByLabel('客户端服务地址', { exact: true }).fill(printServiceUrl);
	await newEditor.getByLabel('打印份数', { exact: true }).fill('4');
	await newEditor.getByLabel('任务标题', { exact: true }).fill('商品测试任务');
	await newEditor.getByRole('button', { name: '执行打印', exact: true }).click();
	await expect.poll(() => printJobs.length).toBe(2);
	assert.equal(printJobs[1].copies, '4');
	const commonText = await pdfText(join(evidence, 'print-job-2.pdf'));
	assert.match(commonText, /商品清单/);
	assert.match(commonText, /示例商品/);
	await newEditor.getByLabel('客户端服务地址', { exact: true }).fill(printServiceUrl.replace('/print', '/reject'));
	await newEditor.getByRole('button', { name: '执行打印', exact: true }).click();
	await expect(page.getByText('打印服务不可用（HTTP 503）', { exact: true })).toBeVisible();
	await newEditor.getByLabel('客户端服务地址', { exact: true }).fill(printServiceUrl);
	await Promise.all([
		page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPrint/add')),
		newEditor.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	await expect(newEditor).toBeHidden();
	const commonPage = await api(admin, 'sysPrint/page', { name: commonName, page: 1, pageSize: 20 });
	const commonId = commonPage.items[0]?.id;
	assert.ok(commonId);
	printIds.add(commonId);
	const commonRow = page.getByRole('row').filter({ hasText: commonName });
	await commonRow.getByRole('button', { name: '编辑模板' }).click();
	const commonEditor = page.getByRole('dialog', { name: '编辑打印模板', exact: true });
	await expect(commonEditor.getByLabel('打印份数', { exact: true })).toHaveValue('4');
	assert.equal(JSON.parse(database.prepare('SELECT Template FROM SysPrint WHERE Id = ?').get(commonId).Template).schemas[0][1].type, 'table');
	await commonEditor.getByLabel('预览数据', { exact: true }).fill('[{"rows":3}]');
	await commonEditor.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByText('预览数据必须是非空 JSON 对象数组，字段值必须是字符串', { exact: true })).toBeVisible();
	await expect(commonEditor).toBeVisible();
	assert.match(database.prepare('SELECT PrintDataDemo FROM SysPrint WHERE Id = ?').get(commonId).PrintDataDemo, /示例商品/);
	await commonEditor.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(commonEditor).toBeHidden();
	report.steps.push('common-table-template-execute-save-reopen-and-rejection');

	for (let index = 0; index < 20; index += 1) {
		const name = `${prefix}-分页模板${String(index).padStart(2, '0')}`;
		await api(admin, 'sysPrint/add', { name, template, printDataDemo: '{"name":"分页"}', printParam: '{"copies":1}', printType: 1, status: 1, orderNo: index + 10 });
		const record = await api(admin, 'sysPrint/page', { name, page: 1, pageSize: 20 });
		assert.ok(record.items[0]?.id);
		printIds.add(record.items[0].id);
	}
	const printPage = page.locator('.print-page:visible');
	await printPage.locator('input:not([readonly])').first().fill(prefix);
	await printPage.getByRole('button', { name: /^查\s*询$/ }).click();
	await expect(printPage.locator('.ant-pagination-item-2')).toBeVisible();
	const pageTwo = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPrint/page') && response.request().postDataJSON()?.page === 2);
	await printPage.locator('.ant-pagination-item-2').click();
	assert.equal((await (await pageTwo).json()).result.items.length, 2);
	await expect(printPage.getByRole('row').filter({ hasText: `${prefix}-分页模板19` })).toBeVisible();
	const allTenants = await api(admin, 'sysPrint/page', { name: prefix, page: 1, pageSize: 100 });
	const otherTenant = await api(admin, 'sysPrint/page', { name: prefix, page: 1, pageSize: 100, tenantId: 999999999 });
	assert.equal(allTenants.total, 22);
	assert.equal(otherTenant.total, 0);
	report.steps.push('template-pagination-input-protection-and-tenant-filter');

	await page.goto(`${proxy.baseUrl}/#/system/pos`);
	await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
	const positionPage = page.locator('.position-page:visible');
	await positionPage.getByLabel('职位编码', { exact: true }).fill(prefix);
	await Promise.all([
		page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysPos/list')),
		positionPage.getByRole('button', { name: /^查\s*询$/ }).click(),
	]);
	await expect(page.getByRole('row').filter({ hasText: `${prefix}-A` })).toBeVisible();
	await expect(page.getByRole('row').filter({ hasText: `${prefix}-C` })).toBeVisible();
	const downloadButton = positionPage.getByRole('button', { name: '导出 PDF', exact: true });
	const currentDownload = page.waitForEvent('download');
	await downloadButton.click();
	const currentFile = join(evidence, 'positions-current.pdf');
	await (await currentDownload).saveAs(currentFile);
	assert.ok(readFileSync(currentFile).subarray(0, 4).equals(Buffer.from('%PDF')));
	const currentText = await pdfText(currentFile);
	assert.match(currentText, /中文岗位甲/);
	assert.match(currentText, /中文岗位乙/);
	const firstRow = page.getByRole('row').filter({ hasText: `${prefix}-A` });
	await firstRow.getByRole('checkbox').check();
	await positionPage.locator('.ant-pagination-item-2').click();
	const lastRow = positionPage.getByRole('row').filter({ hasText: `${prefix}-D21` });
	await expect(lastRow).toBeVisible();
	await lastRow.getByRole('checkbox').check();
	await positionPage.getByRole('button', { name: '输出范围', exact: true }).click();
	await page.getByRole('menuitem', { name: '选中项', exact: true }).click();
	const selectedDownload = page.waitForEvent('download');
	await downloadButton.click();
	const selectedFile = join(evidence, 'positions-selected.pdf');
	await (await selectedDownload).saveAs(selectedFile);
	assert.ok(readFileSync(selectedFile).subarray(0, 4).equals(Buffer.from('%PDF')));
	const selectedText = await pdfText(selectedFile);
	assert.match(selectedText, /中文岗位甲/);
	assert.match(selectedText, /分页岗位21/);
	assert.doesNotMatch(selectedText, /中文岗位乙/);
	await positionPage.getByRole('button', { name: '导出数据', exact: true }).click();
	const [selectedWorkbookDownload] = await Promise.all([
		page.waitForEvent('download'),
		page.getByRole('menuitem', { name: '导出选中数据', exact: true }).click(),
	]);
	const selectedWorkbookPath = join(evidence, 'positions-selected.xlsx');
	await selectedWorkbookDownload.saveAs(selectedWorkbookPath);
	const selectedWorkbook = xlsx.readFile(selectedWorkbookPath);
	const selectedWorkbookRows = xlsx.utils.sheet_to_json(selectedWorkbook.Sheets[selectedWorkbook.SheetNames[0]], { header: 1 });
	assert.equal(selectedWorkbookRows.length, 3);
	assert.match(JSON.stringify(selectedWorkbookRows), /中文岗位甲/);
	assert.match(JSON.stringify(selectedWorkbookRows), /分页岗位21/);
	assert.ok(readFileSync(currentFile).length > readFileSync(selectedFile).length, '当前筛选结果应包含多于选中项的内容');
	await positionPage.getByRole('button', { name: '输出范围', exact: true }).click();
	await page.getByRole('menuitem', { name: '全部匹配结果', exact: true }).click();
	const allDownload = page.waitForEvent('download');
	await downloadButton.click();
	const allFile = join(evidence, 'positions-all.pdf');
	await (await allDownload).saveAs(allFile);
	assert.ok(readFileSync(allFile).subarray(0, 4).equals(Buffer.from('%PDF')));
	const allText = await pdfText(allFile);
	for (const [name] of positionFixtures) assert.ok(allText.includes(name), `全部结果缺少 ${name}`);
	assert.ok(readFileSync(allFile).length >= readFileSync(currentFile).length, '全部结果不能少于当前筛选结果');
	await screenshot('position-pdf-output.png');
	await positionPage.getByRole('button', { name: '导出数据', exact: true }).click();
	const workbookDownload = page.waitForEvent('download');
	await page.getByRole('menuitem', { name: '导出全部数据', exact: true }).click();
	await (await workbookDownload).saveAs(join(evidence, 'positions-all.xlsx'));
	const workbook = xlsx.readFile(join(evidence, 'positions-all.xlsx'));
	const workbookText = JSON.stringify(xlsx.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1 }));
	assert.match(workbookText, /分页岗位21/);
	await positionPage.getByRole('button', { name: '列设置', exact: true }).click();
	const columnSettings = page.locator('.ant-popover:visible');
	await columnSettings.getByRole('checkbox', { name: '状态', exact: true }).uncheck();
	await columnSettings.getByRole('button', { name: '上移职位编码', exact: true }).click();
	await positionPage.getByRole('button', { name: '列设置', exact: true }).click();
	const reorderedDownload = page.waitForEvent('download');
	await downloadButton.click();
	const reorderedFile = join(evidence, 'positions-columns.pdf');
	await (await reorderedDownload).saveAs(reorderedFile);
	const reorderedText = await pdfText(reorderedFile);
	assert.doesNotMatch(reorderedText, /状态|启用/);
	assert.ok(reorderedText.indexOf('职位编码') < reorderedText.indexOf('职位名称'));
	await page.evaluate(() => {
		window.__pdfPrintCalls = 0;
		window.__pdfPrintTrace = [];
		const append = document.body.append.bind(document.body);
		document.body.append = (...nodes) => {
			for (const frame of nodes) {
				if (!(frame instanceof HTMLIFrameElement) || frame.title !== 'PDF 打印') continue;
				window.__pdfPrintTrace.push('appended');
				const onload = frame.onload;
				frame.onload = (event) => {
					window.__pdfPrintTrace.push('loaded');
					const original = frame.contentWindow.print.bind(frame.contentWindow);
					frame.contentWindow.print = () => { window.__pdfPrintCalls += 1; original(); };
					onload?.call(frame, event);
				};
			}
			append(...nodes);
		};
	});
	await positionPage.getByRole('button', { name: '打印', exact: true }).click();
	await expect.poll(() => page.evaluate(() => window.__pdfPrintCalls), { timeout: 40_000 }).toBe(1);
	report.steps.push('desktop-filter-cross-page-selected-all-pdf-output');

	await cleanup();
	assert.equal(report.cleanupPassed, true);
	await positionPage.getByLabel('职位名称', { exact: true }).fill(`${prefix}-停机草稿`);
	await stopApi();
	await positionPage.getByRole('button', { name: /^查\s*询$/ }).click();
	await expect(positionPage.locator('.ant-alert-title').filter({ hasText: /请求失败|网络错误|502/ })).toBeVisible();
	await expect(positionPage.getByLabel('职位名称', { exact: true })).toHaveValue(`${prefix}-停机草稿`);
	await screenshot('position-output-outage.png');
	report.steps.push('real-outage-draft-preserved');
	report.passed = true;
} catch (error) {
	report.error = error instanceof Error ? error.message : '未知错误';
	if (page) report.diagnostics.push({ kind: 'print-probe', trace: await page.evaluate(() => ({ trace: window.__pdfPrintTrace, frames: [...document.querySelectorAll('iframe')].map((frame) => ({ title: frame.title, source: frame.src.slice(0, 5) })) })).catch(() => null) });
	if (page) report.diagnostics.push({ kind: 'messages', messages: await page.locator('.ant-message-notice').allTextContents().catch(() => []) });
	if (page && evidence) await page.screenshot({ path: join(evidence, 'print-baseline-failure.png'), fullPage: true }).catch(() => {});
	process.exitCode = 1;
} finally {
	try {
		if (!cleaned) await cleanup();
	} catch {
		report.cleanupErrors.push('cleanup');
	}
	try {
		await context?.close();
		await browser?.close();
		await proxy?.close();
		if (printServer) await new Promise((resolveClose) => printServer.close(resolveClose));
	} catch {
		report.cleanupErrors.push('resource-close');
	}
	if (!stopped) await stopApi().catch(() => report.cleanupErrors.push('api-stop'));
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (evidence) writeFileSync(join(evidence, 'print-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify({ ...report, evidence }));
}
