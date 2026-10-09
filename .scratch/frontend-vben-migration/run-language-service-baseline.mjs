import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const base = new URL(marker.baseUrl);
assert.equal(base.protocol, 'http:');
assert.equal(base.hostname, '127.0.0.1');
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const report = { passed: false, cleanupPassed: false, proposalComplete: false, boundary: 'real-api-real-excel-readonly-sqlite', steps: [], cleanupErrors: [], pending: ['AI 翻译真实测试服务待验证'] };
const sessions = [];
const suffix = `accept09-${Date.now()}`;
let db, admin, languageId;
let stage = 'initialize';
const require = createRequire(join(root, 'Web/apps/web-antdv-next/package.json'));
const xlsx = require('xlsx-js-style');
async function request(session, path, data, method = 'POST') {
	const isForm = data instanceof FormData;
	const response = await fetch(new URL(`/api/${path}`, base), {
		method, headers: { ...(!isForm ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` } : {}) },
		body: method === 'POST' && data !== undefined ? (isForm ? data : JSON.stringify(data)) : undefined, signal: AbortSignal.timeout(60_000),
	});
	if (session && response.headers.get('access-token') && response.headers.get('access-token') !== 'invalid_token') {
		session.accessToken = response.headers.get('access-token');
		session.refreshToken = response.headers.get('x-access-token') ?? session.refreshToken;
	}
	return response;
}
async function ok(session, path, data, method) {
	const result = await (await request(session, path, data, method)).json();
	assert.equal(result.code, 200, `${path.split('?')[0]} code=${result.code}`);
	return result.result;
}
async function denied(session, path, data, method) {
	const response = await request(session, path, data, method);
	if ([401, 403].includes(response.status)) return;
	assert.ok(response.headers.get('content-type')?.includes('json'), `${path} expected refusal JSON, received ${response.headers.get('content-type')}`);
	const result = await response.json();
	assert.notEqual(result.code, 200, path);
}
async function file(response, filename) {
	assert.equal(response.status, 200);
	if (response.headers.get('content-type')?.includes('json')) {
		const result = await response.json();
		throw new Error(`Expected actual Excel file; code=${result.code}; message=${JSON.stringify(result.errors ?? result.message ?? result.result)}`);
	}
	const bytes = Buffer.from(await response.arrayBuffer());
	assert.equal(bytes.subarray(0, 2).toString(), 'PK');
	writeFileSync(join(evidence, filename), bytes);
	return xlsx.read(bytes, { type: 'buffer' });
}
function rows(book) { return xlsx.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1 }); }
function save() { writeFileSync(join(evidence, 'language-service-baseline.json'), JSON.stringify(report, null, 2), 'utf8'); }
try {
	const { sm2 } = require('sm-crypto-v2');
	const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
	const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)?.[1].trim();
	db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
	db.exec('PRAGMA busy_timeout=5000');
	for (const account of ['superAdmin.NET', 'TestUser3']) sessions.push(await ok(undefined, 'sysAuth/login', { account, password: sm2.doEncrypt(password, publicKey, 1) }));
	[admin] = sessions;
	stage = 'language-crud-dropdown-and-validation';
	const language = { name: suffix, code: suffix, isoCode: 'zz', urlCode: 'zz', direction: 1, dateFormat: 'YYYY-MM-DD', timeFormat: 'HH:mm:ss', grouping: '3', decimalPoint: '.', thousandsSep: ',', weekStart: 1, active: true };
	languageId = await ok(admin, 'sysLang/add', language);
	assert.ok(languageId);
	await ok(admin, 'sysLang/update', { ...language, id: languageId, name: `${suffix}-中文`, weekStart: 7 });
	assert.equal(db.prepare('SELECT Name FROM SysLang WHERE Id = ?').get(languageId).Name, `${suffix}-中文`);
	assert.ok((await ok(undefined, 'sysLang/dropdownData')).some((item) => item.code === suffix));
	await ok(admin, 'sysLang/update', { ...language, id: languageId, active: false });
	assert.ok(!(await ok(undefined, 'sysLang/dropdownData')).some((item) => item.code === suffix));
	await denied(admin, 'sysLang/add', { ...language, name: '' });
	await denied(sessions[1], 'sysLang/delete', { id: languageId });
	report.steps.push(stage);
	stage = 'translation-crud-duplicates-and-empty-delete';
	const input = { entityName: suffix, entityId: 909, fieldName: 'Name', langCode: 'en', content: '中文内容【{0}】 € é' };
	const id = await ok(admin, 'sysLangText/add', input);
	await denied(admin, 'sysLangText/add', input);
	await ok(admin, 'sysLangText/batchDelete', []);
	assert.ok(db.prepare('SELECT Id FROM SysLangText WHERE Id = ?').get(id));
	await ok(admin, 'sysLangText/update', { ...input, id, content: '已更新中文【{0}】' });
	assert.equal(db.prepare('SELECT Content FROM SysLangText WHERE Id = ?').get(id).Content, '已更新中文【{0}】');
	await denied(admin, 'sysLangText/add', { ...input, fieldName: '' });
	await denied(sessions[1], 'sysLangText/update', { ...input, id, content: 'denied' });
	report.steps.push(stage);
	stage = 'download-real-template';
	const response = await request(admin, 'sysLangText/import', undefined, 'GET');
	report.templateDisposition = response.headers.get('content-disposition');
	const template = await file(response, 'translation-template.xlsx');
	const headers = rows(template)[0];
	assert.ok(headers.includes('*所属实体名') && headers.includes('*翻译内容'));
	report.templateHeaders = headers;
	report.steps.push(stage);
	stage = 'real-partial-import-error-workbook';
	const importRows = [
		{ '*所属实体名': suffix, '*所属实体ID': 910, '*字段名': 'Name', '*语言代码': 'en', '*翻译内容': '有效导入中文' },
		{ '*所属实体名': suffix, '*所属实体ID': 911, '*字段名': '', '*语言代码': 'en', '*翻译内容': '无效行不得保存' },
	];
	template.Sheets[template.SheetNames[0]] = xlsx.utils.aoa_to_sheet([headers, ...importRows.map((row) => headers.map((header) => row[header] ?? ''))]);
	const bytes = xlsx.write(template, { type: 'buffer', bookType: 'xlsx' });
	writeFileSync(join(evidence, 'translation-input.xlsx'), bytes);
	const form = new FormData();
	form.append('file', new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), '中文导入.xlsx');
	const imported = await request(admin, 'sysLangText/import', form);
	const errors = await file(imported, 'translation-errors.xlsx');
	assert.ok(rows(errors).flat().some((value) => String(value).includes('字段名不能为空')));
	assert.equal(db.prepare('SELECT Content FROM SysLangText WHERE EntityName = ? AND EntityId = 910').get(suffix)?.Content, '有效导入中文');
	assert.equal(db.prepare('SELECT Id FROM SysLangText WHERE EntityName = ? AND EntityId = 911').get(suffix), undefined);
	report.steps.push(stage);
	stage = 'selected-export-content-and-unicode';
	const exported = await request(admin, 'sysLangText/export', { page: 1, pageSize: 100, entityName: suffix, selectKeyList: [id] });
	report.exportDisposition = exported.headers.get('content-disposition');
	const book = await file(exported, 'translation-selected.xlsx');
	const exportedRows = rows(book);
	assert.equal(exportedRows.length, 2);
	assert.ok(exportedRows[1].includes('已更新中文【{0}】'));
	assert.ok(!exportedRows.flat().includes('有效导入中文'));
	report.steps.push(stage);
	stage = 'binary-permission-and-invalid-file-feedback';
	await denied(sessions[1], 'sysLangText/export', { page: 1, pageSize: 20 });
	await denied(sessions[1], 'sysLangText/import', undefined, 'GET');
	const malformed = new FormData();
	malformed.append('file', new Blob(['not an Excel document']), 'invalid.xlsx');
	await denied(admin, 'sysLangText/import', malformed);
	report.steps.push(stage);
	stage = 'ai-real-service-translation';
	const translated = await ok(admin, 'sysLangText/aiTranslateText', { originalText: '隔离测试文本【{0}】', targetLang: 'en' });
	assert.equal(typeof translated, 'string');
	assert.ok(translated.length > 0 && translated.includes('{0}') && /[a-z]/i.test(translated));
	await denied(sessions[1], 'sysLangText/aiTranslateText', { originalText: '无权请求', targetLang: 'en' });
	report.pending = [];
	report.steps.push(stage);
	report.passed = true;
} catch (error) {
	report.failedStage = stage;
	report.error = `${error.name}: ${error.message}`;
	process.exitCode = 1;
	save();
} finally {
	if (db && admin) {
		for (const row of db.prepare('SELECT Id FROM SysLangText WHERE EntityName = ?').all(suffix)) {
			try { await ok(admin, 'sysLangText/delete', { id: row.Id }); } catch { report.cleanupErrors.push('translation-delete'); }
		}
		try { assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysLangText WHERE EntityName = ?').get(suffix).n, 0); } catch { report.cleanupErrors.push('translation-verify'); }
		if (languageId) {
			try { await ok(admin, 'sysLang/delete', { id: languageId }); assert.equal(db.prepare('SELECT Id FROM SysLang WHERE Id = ?').get(languageId), undefined); }
			catch { report.cleanupErrors.push('language-delete'); }
		}
	}
	for (const session of sessions) { try { await ok(session, 'sysAuth/logout'); } catch { report.cleanupErrors.push('logout'); } }
	db?.close();
	report.cleanupPassed = report.cleanupErrors.length === 0;
	if (!report.cleanupPassed) process.exitCode = 1;
	save();
	console.log(JSON.stringify(report, null, 2));
}
