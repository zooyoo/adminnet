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
const xlsx = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'))('xlsx-js-style');
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'desktop-production-real-api-excel-ai', steps: [], cleanupErrors: [] };
const name = `browser09-${Date.now()}`;
let proxy, browser, context, page, db, session, languageId, dictId;
let stage = 'initialize';
let stopped = false;
function saveReport() { writeFileSync(join(evidence, 'language-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8'); }
async function api(path, data) {
	const response = await fetch(new URL(`/api/${path}`, apiUrl), {
		method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` },
		body: JSON.stringify(data), signal: AbortSignal.timeout(60_000),
	});
	if (response.headers.get('access-token')) {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	const result = await response.json();
	assert.equal(result.code, 200, path);
	return result.result;
}
async function save(dialog, endpoint) {
	const [response] = await Promise.all([page.waitForResponse((item) => item.url().endsWith(`/api/${endpoint}`) && item.request().method() === 'POST'), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	assert.equal((await response.json()).code, 200, endpoint);
	await expect(dialog).toBeHidden();
}
async function shot(file) {
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.locator('.ant-table-content, .ant-table-body, .ant-modal-body').evaluateAll((elements) => elements.forEach((element) => { element.scrollLeft = 0; element.scrollTop = 0; }));
	await page.screenshot({ path: join(evidence, file), animations: 'disabled' });
}
async function cleanupData() {
	const translations = db.prepare('SELECT Id FROM SysLangText WHERE EntityName = ? OR (EntityName = ? AND EntityId = ?)').all(name, 'SysDictType', dictId ?? 0);
	for (const item of translations) await api('sysLangText/delete', { id: item.Id });
	if (dictId) { await api('sysDictType/delete', { id: dictId }); dictId = undefined; }
	if (languageId) { await api('sysLang/delete', { id: languageId }); languageId = undefined; }
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysLangText WHERE EntityName = ?').get(name).n, 0);
}
try {
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	proxy = await startProductionProxy(join(root, 'Web/dist'), apiUrl);
	browser = await chromium.launch();
	context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
	page = await context.newPage();
	page.setDefaultTimeout(20_000);
	stage = 'production-login-language';
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Flang`);
	await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
	await page.getByLabel('密码', { exact: true }).fill(password);
	const [login] = await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysAuth/login')), page.locator('button[type=submit]').click()]);
	const loginResult = await login.json();
	assert.equal(loginResult.code, 200);
	session = loginResult.result;
	await expect(page.getByRole('button', { name: '新增语言', exact: true })).toBeVisible();
	report.steps.push(stage);
	stage = 'language-real-create-edit';
	await page.getByRole('button', { name: '新增语言', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '新增语言', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByText('请输入语言名称', { exact: true })).toBeVisible();
	for (const [label, value] of [['语言名称', name], ['语言代码', name], ['ISO 语言代码', 'zz'], ['URL 语言代码', 'zz'], ['日期格式', 'YYYY-MM-DD'], ['时间格式', 'HH:mm:ss'], ['分组符号', '3'], ['小数点符号', '.'], ['千分位分隔符', ',']]) await dialog.getByLabel(label, { exact: true }).fill(value);
	await shot('language-desktop-editor.png');
	await save(dialog, 'sysLang/add');
	languageId = db.prepare('SELECT Id FROM SysLang WHERE Code = ?').get(name).Id;
	await page.locator('form[name="language-query"]').getByLabel('关键字', { exact: true }).fill(name);
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	await page.locator(`tr[data-row-key="${languageId}"]`).getByRole('button', { name: '编辑语言', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑语言', exact: true });
	await dialog.getByLabel('语言名称', { exact: true }).fill(`${name}-中文`);
	await save(dialog, 'sysLang/update');
	assert.equal(db.prepare('SELECT Name FROM SysLang WHERE Id = ?').get(languageId).Name, `${name}-中文`);
	report.steps.push(stage);
	stage = 'translation-real-crud-export';
	await page.goto(`${proxy.baseUrl}/#/system/langText`);
	await page.getByRole('button', { name: '新增翻译', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '新增翻译', exact: true });
	for (const [label, value] of [['所属实体名', name], ['所属实体 ID', '909'], ['字段名', 'Name'], ['语言代码', 'en'], ['翻译内容', '真实浏览器中文【{0}】']]) await dialog.getByLabel(label, { exact: true }).fill(value);
	await save(dialog, 'sysLangText/add');
	const id = db.prepare('SELECT Id FROM SysLangText WHERE EntityName = ?').get(name).Id;
	await page.locator('form[name="translation-query"]').getByLabel('关键字', { exact: true }).fill(name);
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	await page.locator(`tr[data-row-key="${id}"]`).getByRole('button', { name: '编辑翻译', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑翻译', exact: true });
	await dialog.getByLabel('翻译内容', { exact: true }).fill('更新中文【{0}】');
	await save(dialog, 'sysLangText/update');
	assert.equal(db.prepare('SELECT Content FROM SysLangText WHERE Id = ?').get(id).Content, '更新中文【{0}】');
	await page.locator(`tr[data-row-key="${id}"]`).getByRole('checkbox').check();
	await page.getByRole('button', { name: '导出翻译', exact: true }).click();
	const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: '导出选中数据', exact: true }).click()]);
	assert.match(download.suggestedFilename(), /^翻译表导出记录.*\.xlsx$/);
	await download.saveAs(join(evidence, 'browser-selected.xlsx'));
	const book = xlsx.read(readFileSync(await download.path()), { type: 'buffer' });
	const exportedRows = xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 });
	assert.equal(exportedRows.length, 2);
	assert.ok(exportedRows[1].includes('更新中文【{0}】'));
	await shot('translation-desktop-list.png');
	report.steps.push(stage);
	stage = 'real-template-partial-import-download';
	await page.getByRole('button', { name: '导入翻译', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '导入翻译', exact: true });
	const [templateDownload] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '下载模板', exact: true }).click()]);
	assert.match(templateDownload.suggestedFilename(), /^翻译表导入模板.*\.xlsx$/);
	const template = xlsx.read(readFileSync(await templateDownload.path()), { type: 'buffer' });
	const headers = xlsx.utils.sheet_to_json(template.Sheets[template.SheetNames[0]], { header: 1 })[0];
	template.Sheets[template.SheetNames[0]] = xlsx.utils.aoa_to_sheet([headers, [name, 910, 'Name', 'en', '有效桌面导入'], [name, 911, '', 'en', '无效行']]);
	await dialog.locator('input[type="file"]').setInputFiles({ name: '中文测试导入.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: xlsx.write(template, { type: 'buffer', bookType: 'xlsx' }) });
	await dialog.getByRole('button', { name: '开始导入', exact: true }).click();
	await expect(dialog.getByText('导入完成，部分数据需要修正', { exact: true })).toBeVisible();
	const [errorDownload] = await Promise.all([page.waitForEvent('download'), dialog.getByRole('button', { name: '下载错误明细', exact: true }).click()]);
	await errorDownload.saveAs(join(evidence, 'browser-import-errors.xlsx'));
	const errorBook = xlsx.read(readFileSync(await errorDownload.path()), { type: 'buffer' });
	assert.ok(xlsx.utils.sheet_to_json(errorBook.Sheets[errorBook.SheetNames[0]], { header: 1 }).flat().some((value) => String(value).includes('字段名不能为空')));
	assert.equal(db.prepare('SELECT Content FROM SysLangText WHERE EntityName = ? AND EntityId = 910').get(name).Content, '有效桌面导入');
	assert.equal(db.prepare('SELECT Id FROM SysLangText WHERE EntityName = ? AND EntityId = 911').get(name), undefined);
	await shot('translation-desktop-partial-import.png');
	await dialog.getByRole('button', { name: '关闭', exact: true }).click();
	report.steps.push(stage);
	stage = 'real-ai-multilanguage-entry-and-persistence';
	await api('sysDictType/add', { name, code: name, sysFlag: 2, isTenant: 2, status: 1, orderNo: 1 });
	dictId = db.prepare('SELECT Id FROM SysDictType WHERE Code = ?').get(name).Id;
	await page.goto(`${proxy.baseUrl}/#/platform/dict`);
	await page.locator('form[name="dict-type-query"]').getByLabel('名称', { exact: true }).fill(name);
	await page.locator('form[name="dict-type-query"]').getByRole('button', { name: /^查\s*询$/ }).click();
	await page.locator(`tr[data-row-key="${dictId}"]`).getByRole('button', { name: '编辑字典', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '编辑字典', exact: true });
	await editor.getByLabel('字典名称', { exact: true }).fill('隔离测试【{0}】');
	await editor.getByRole('button', { name: '多语言设置', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '多语言设置', exact: true });
	await expect(dialog.getByRole('button', { name: 'AI 翻译', exact: true })).toBeEnabled();
	await dialog.getByRole('button', { name: 'AI 翻译', exact: true }).click();
	await expect(dialog.getByRole('button', { name: '确认修改', exact: true })).toBeEnabled({ timeout: 180_000 });
	// 根据可见输入逐项检查实际返回，不预设模型的具体译文。
	const inputs = await dialog.locator('input').evaluateAll((elements) => elements.map((element) => element.value));
	assert.ok(inputs.length > 1 && inputs.every((value) => value.trim() && value.includes('{0}')));
	await shot('translation-desktop-real-ai.png');
	const [saved] = await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysLangText/batchSave')), dialog.getByRole('button', { name: '确认修改', exact: true }).click()]);
	assert.equal((await saved.json()).code, 200);
	await expect(dialog).toBeHidden();
	assert.ok(db.prepare('SELECT COUNT(*) AS n FROM SysLangText WHERE EntityName = ? AND EntityId = ?').get('SysDictType', dictId).n > 1);
	await editor.getByRole('button', { name: /^取\s*消$/ }).click();
	report.steps.push(stage);
	await cleanupData();
	if (process.argv.includes('--outage')) {
		stage = 'real-outage-preserves-translation-draft';
		await page.goto(`${proxy.baseUrl}/#/system/langText`);
		await page.getByRole('button', { name: '新增翻译', exact: true }).click();
		dialog = page.getByRole('dialog', { name: '新增翻译', exact: true });
		for (const [label, value] of [['所属实体名', name], ['所属实体 ID', '999'], ['字段名', 'Name'], ['语言代码', 'en'], ['翻译内容', '停机草稿']]) await dialog.getByLabel(label, { exact: true }).fill(value);
		execFileSync('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
		stopped = true;
		const [failed] = await Promise.all([page.waitForResponse((item) => item.url().endsWith('/sysLangText/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
		assert.equal(failed.status(), 502);
		await expect(dialog.getByLabel('翻译内容', { exact: true })).toHaveValue('停机草稿');
		await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
		assert.equal(db.prepare('SELECT Id FROM SysLangText WHERE EntityName = ?').get(name), undefined);
		await shot('translation-desktop-outage.png');
		report.steps.push(stage);
	}
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = { name: error.name, message: String(error.message).split('\n').slice(0, 8).join('\n') };
	process.exitCode = 1;
	saveReport();
	if (page && stage !== 'production-login-language') await page.screenshot({ path: join(evidence, 'language-failed.png') }).catch(() => undefined);
} finally {
	if (db && session && !stopped) { try { await cleanupData(); } catch { report.cleanupErrors.push('fixture-cleanup'); } }
	try { if (session && !stopped) await api('sysAuth/logout'); } catch { report.cleanupErrors.push('logout'); }
	try { await context?.close(); await browser?.close(); } catch { report.cleanupErrors.push('browser'); }
	try { await proxy?.close(); } catch { report.cleanupErrors.push('proxy'); }
	try { db?.close(); } catch { report.cleanupErrors.push('database'); }
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (!report.cleanupPassed) process.exitCode = 1;
	saveReport();
	console.log(JSON.stringify({ passed: report.passed, cleanupPassed: report.cleanupPassed, failedStage: report.failedStage, report: join(evidence, 'language-browser-baseline.json') }));
}
