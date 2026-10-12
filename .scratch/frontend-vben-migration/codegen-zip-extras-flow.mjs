import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export async function verifyGeneratedExtras(context) {
 const { native, root, evidence, page, panel, query, dialog, api, admin, firstId, prefix, organization, fixtureBusiness, sql, responseResult, generatedRecords, report, record, expect, isApi, stage } = context;
 const python = resolve(dirname(process.execPath), '../../python/python.exe');
 async function inspectXlsx(path) { return JSON.parse((await native(python, [join(root, '.scratch/frontend-vben-migration/codegen-xlsx-fixture.py'), 'inspect', path])).stdout); }
 async function populate(template, output, rows) {
  const rowsPath = output.replace(/\.xlsx$/u, '.json'); writeFileSync(rowsPath, JSON.stringify(rows), 'utf8');
  await native(python, [join(root, '.scratch/frontend-vben-migration/codegen-xlsx-fixture.py'), 'populate', template, '--output', output, '--rows', rowsPath]);
 }
 stage('generated-export-content-status-and-attachment');
 const realExport = await inspectXlsx(join(evidence, 'generated-export.xlsx')); assert.equal(realExport.rows.length, 2);
 assert.deepEqual(realExport.rows.map(item => item['名称']).sort(), [prefix + '_alpha_updated', prefix + '_beta'].sort());
 const zeroRow = realExport.rows.find(item => item['名称'] === prefix + '_beta'); assert.equal(zeroRow['金额'], 0); assert.equal(zeroRow['是否启用'], '否'); assert.equal(zeroRow['状态'], '启用');
 const alpha = () => panel.locator('tbody tr').filter({ has: page.getByText(prefix + '_alpha_updated', { exact: true }) });
 await responseResult('codeGenAcceptance/setStatus', () => alpha().getByRole('switch', { name: '切换状态', exact: true }).click());
 await expect(alpha().getByRole('switch', { name: '切换状态', exact: true })).toHaveAttribute('aria-checked', 'false'); assert.equal(await sql('SELECT status FROM codegen_acceptance WHERE id=' + firstId), '2');
 await responseResult('codeGenAcceptance/setStatus', () => alpha().getByRole('switch', { name: '切换状态', exact: true }).click());
 await expect(alpha().getByRole('switch', { name: '切换状态', exact: true })).toHaveAttribute('aria-checked', 'true');
 const attachmentPath = join(evidence, prefix + '_attachment.txt'); const attachmentBytes = Buffer.from(prefix + ':real-generated-upload-content', 'utf8'); writeFileSync(attachmentPath, attachmentBytes);
 await alpha().getByRole('button', { name: '编辑', exact: true }).click(); await expect(dialog().getByLabel('名称', { exact: true })).toHaveValue(prefix + '_alpha_updated');
 const [chooser] = await Promise.all([page.waitForEvent('filechooser'), dialog().getByRole('button', { name: '上传文件', exact: true }).click()]);
 const uploaded = await responseResult('codeGenAcceptance/uploadAttachment', () => chooser.setFiles(attachmentPath)); report.generatedFileIds = [String(uploaded.id)];
 await expect(dialog().getByLabel('附件', { exact: true })).toHaveValue(uploaded.url);
 await responseResult('codeGenAcceptance/update', () => dialog().getByRole('button', { name: /^保\s*存$/u }).click()); await expect(dialog()).toHaveCount(0);
 assert.equal(await sql('SELECT attachment FROM codegen_acceptance WHERE id=' + firstId), uploaded.url);
 assert.equal(await sql('SELECT count(*) FROM sysfile WHERE id=' + uploaded.id + " AND filename='" + prefix + "_attachment'"), '1');
 const [attachmentDownload] = await Promise.all([page.waitForEvent('download'), alpha().getByRole('button', { name: '下载文件', exact: true }).click()]);
 const downloadedAttachment = join(evidence, 'generated-attachment-downloaded.txt'); await attachmentDownload.saveAs(downloadedAttachment); assert.deepEqual(readFileSync(downloadedAttachment), attachmentBytes);
 record('generated-export-content-zero-false-enum-status-update-and-authenticated-attachment-bytes');
 stage('generated-real-import');
 await panel.getByRole('button', { name: /^导\s*入$/u }).click();
 const importDialog = page.getByRole('dialog', { name: '导入' + fixtureBusiness, exact: true }); await expect(importDialog).toBeVisible();
 const [templateDownload] = await Promise.all([page.waitForEvent('download'), importDialog.getByRole('button', { name: '下载模板', exact: true }).click()]);
 const importTemplate = join(evidence, 'generated-import-template.xlsx'); await templateDownload.saveAs(importTemplate);
 const validRow = { '名称': prefix + '_imported', '金额': 7.25, '是否启用': '是', '发生时间': { dateTime: '2026-10-13T08:15:00' }, '备注': '真实模板导入', '状态': '启用', '所属机构': String(organization.label) };
 const importWorkbook = join(evidence, 'generated-import-input.xlsx'); await populate(importTemplate, importWorkbook, [validRow]);
 const [importChooser] = await Promise.all([page.waitForEvent('filechooser'), importDialog.getByRole('button', { name: '选择文件', exact: true }).click()]); await importChooser.setFiles(importWorkbook);
 const [importResponse] = await Promise.all([page.waitForResponse(isApi('codeGenAcceptance/import')), importDialog.getByRole('button', { name: '开始导入', exact: true }).click()]); assert.equal(importResponse.status(), 200);
 report.importContentType = importResponse.headers()['content-type']; if (!String(report.importContentType).includes('json')) writeFileSync(join(evidence, 'unexpected-import-result.xlsx'), await importResponse.body());
 await expect(importDialog).toHaveCount(0); await expect(panel.getByText(prefix + '_imported', { exact: true })).toBeVisible();
 const imported = (await generatedRecords()).items.find(item => item.name === prefix + '_imported'); assert.ok(imported); report.importedBusinessId = String(imported.id);
 assert.equal(await sql('SELECT count(*) FROM codegen_acceptance WHERE id=' + imported.id + ' AND amount=7.25 AND enabled=true AND linkedorgid=' + organization.value + " AND notes='真实模板导入' AND occurredat::date='2026-10-13'"), '1');
 await panel.getByRole('button', { name: /^导\s*入$/u }).click(); await expect(importDialog).toBeVisible();
 const invalidWorkbook = join(evidence, 'generated-invalid-import-input.xlsx'); await populate(importTemplate, invalidWorkbook, [{ ...validRow, '名称': 'x'.repeat(65) }]);
 const [invalidChooser] = await Promise.all([page.waitForEvent('filechooser'), importDialog.getByRole('button', { name: '选择文件', exact: true }).click()]); await invalidChooser.setFiles(invalidWorkbook);
 const [invalidResponse] = await Promise.all([page.waitForResponse(isApi('codeGenAcceptance/import')), importDialog.getByRole('button', { name: '开始导入', exact: true }).click()]); assert.equal(invalidResponse.status(), 200);
 await expect(importDialog.getByText('导入完成，部分数据需要修正', { exact: true })).toBeVisible();
 const [errorsDownload] = await Promise.all([page.waitForEvent('download'), importDialog.getByRole('button', { name: '下载错误明细', exact: true }).click()]);
 const importErrors = join(evidence, 'generated-import-errors.xlsx'); await errorsDownload.saveAs(importErrors); const errorsWorkbook = await inspectXlsx(importErrors);
 assert.equal(errorsWorkbook.rows.length, 1); assert.ok(JSON.stringify(errorsWorkbook.rows).includes('64')); assert.equal(await sql('SELECT count(*) FROM codegen_acceptance'), '3');
 await importDialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(importDialog).toHaveCount(0);
 await api(admin, 'codeGenAcceptance/delete', { id: imported.id }); await responseResult('codeGenAcceptance/page', () => query.getByRole('button', { name: '重置', exact: true }).click());
 record('generated-real-downloaded-template-import-postgresql-and-error-workbook-recovery');
 stage('generated-auto-pdf-and-print');
 const [pdfDownload] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: '导出 PDF', exact: true }).click()]);
 const pdfPath = join(evidence, 'generated-records.pdf'); await pdfDownload.saveAs(pdfPath); assert.equal(readFileSync(pdfPath).subarray(0, 5).toString('ascii'), '%PDF-');
 const printPython = process.env.PDF_TEST_PYTHON ?? join(homedir(), '.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
 const pdfText = (await native(printPython, ['-c', 'import sys; from pypdf import PdfReader; sys.stdout.reconfigure(encoding="utf-8"); print("\\n".join(p.extract_text() or "" for p in PdfReader(sys.argv[1]).pages))', pdfPath])).stdout;
 const compactPdfText = pdfText.replace(/\s+/gu, '');
 assert.ok(compactPdfText.includes(prefix + '_alpha_updated') && compactPdfText.includes(prefix + '_beta') && compactPdfText.includes('名称'));
 report.pdfTextVerified = true;
 await page.evaluate(() => {
  window.__generatedPrintCalls = 0;
  const append = document.body.append.bind(document.body);
  document.body.append = (...nodes) => {
   for (const frame of nodes) {
    if (!(frame instanceof HTMLIFrameElement) || frame.title !== 'PDF 打印') continue;
    const onload = frame.onload;
    frame.onload = event => { const original = frame.contentWindow.print.bind(frame.contentWindow); frame.contentWindow.print = () => { window.__generatedPrintCalls += 1; original(); }; onload?.call(frame, event); };
   }
   append(...nodes);
  };
 });
 await panel.getByRole('button', { name: '打印', exact: true }).click(); await expect.poll(() => page.evaluate(() => window.__generatedPrintCalls), { timeout: 40000 }).toBe(1);
 report.browserPrintInvocations = await page.evaluate(() => window.__generatedPrintCalls); record('generated-real-pdf-text-and-browser-native-print-invocation');
}
