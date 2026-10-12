const zipMenuIds = [], zipCodeGenIds = [], businessIds = [];
let zipMenuDigest, zipConfigDigest, zipFileDigest, generatedWorkspace, businessTableReady = false;
const fixtureEntity = 'CodeGenAcceptance';
const fixtureBusiness = prefix + '_生成CRUD';
const zipConfigDigestSql = "SELECT md5(coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY id) FROM syscodegen t), '') || '#' || coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY id) FROM syscodegenconfig t), ''))";
async function generatedRecords() { return api(admin, 'codeGenAcceptance/page', { page: 1, pageSize: 100 }); }
async function cleanupFixtures() {
 const failures = [];
 if (businessTableReady) {
  try {
   const rows = (await generatedRecords()).items.filter(row => row.name?.startsWith(prefix));
   if (rows.length) await api(admin, 'codeGenAcceptance/batchDelete', rows.map(row => ({ id: row.id })));
   assert.equal(await sql('SELECT count(*) FROM codegen_acceptance'), '0');
  } catch (error) { failures.push(error.message); }
 }
 try {
  const rows = JSON.parse(await sql("SELECT coalesce(json_agg(t), '[]'::json)::text FROM (SELECT id, filepath, suffix FROM sysfile WHERE filename LIKE '" + prefix + "%') t"));
  for (const file of rows) {
   await api(admin, 'sysFile/delete', { id: file.id });
   assert.equal(existsSync(join(runtime, 'wwwroot', file.filepath, file.id + file.suffix)), false);
  }
  assert.equal(await sql("SELECT count(*) FROM sysfile WHERE filename LIKE '" + prefix + "%'"), '0');
  if (zipFileDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysfile t"), zipFileDigest);
  report.generatedFilesRemoved = true;
 } catch (error) { failures.push(error.message); }
 for (const id of [...zipCodeGenIds]) {
  try { await api(admin, 'sysCodeGen/delete', [{ id }]); } catch (error) { failures.push(error.message); }
 }
 for (const id of [...zipMenuIds].reverse()) {
  try { await api(admin, 'sysMenu/delete', { id }); } catch (error) { failures.push(error.message); }
 }
 try {
  if (zipCodeGenIds.length) {
   const ids = zipCodeGenIds.join(',');
   assert.equal(await sql('SELECT (SELECT count(*) FROM syscodegen WHERE id IN (' + ids + ')) + (SELECT count(*) FROM syscodegenconfig WHERE codegenid IN (' + ids + '))'), '0');
  }
  if (zipMenuIds.length) {
   const ids = zipMenuIds.join(',');
   for (const table of ['sysmenu','systenantmenu','sysrolemenu','sysusermenu']) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + (table === 'sysmenu' ? 'id' : 'menuid') + ' IN (' + ids + ')'), '0');
  }
  if (zipMenuDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t"), zipMenuDigest);
  if (zipConfigDigest) assert.equal(await sql(zipConfigDigestSql), zipConfigDigest);
 } catch (error) { failures.push(error.message); }
 assert.deepEqual(failures, [], 'All owned business/config/menu records and digests are restored');
 report.fixtureRecordsRemoved = true;
}
async function runCodegenZipBrowser() {
 stage = 'codegen-zip-fixtures';
 zipMenuDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
 zipConfigDigest = await sql(zipConfigDigestSql);
 zipFileDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysfile t");
 const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
 const route = '/' + prefix + '_zip';
 const crudRoute = '/' + prefix + '_crud';
 zipMenuIds.push(String(await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: '预览 ZIP 隔离验收', name: prefix + '_zip', path: route, component: '/system/codeGen/index', status: 1 })));
 zipMenuIds.push(String(await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: fixtureBusiness, name: prefix + '_crud', path: crudRoute, component: '/codegen43/codeGenAcceptance/index', status: 1 })));
 report.menuIds = [...zipMenuIds];
 const databases = await api(admin, 'sysCodeGen/databaseList', undefined, 'GET');
 for (const item of databases) secret(item.connectionString);
 const database = databases.find(item => ['PostgreSQL','4'].includes(String(item.dbType)));
 assert.ok(database, 'A real isolated PostgreSQL connection is available');
 const tables = await api(admin, 'sysCodeGen/tableList/' + encodeURIComponent(database.configId), undefined, 'GET');
 assert.ok(tables.some(item => item.entityName === fixtureEntity), 'The representative entity is compiled into the isolated API');
 const org = tables.find(item => item.entityName === 'SysOrg'); assert.ok(org);
 const config = { configId: String(database.configId), connectionString: database.connectionString, dbNickName: database.dbNickName, tableName: fixtureEntity, busName: fixtureBusiness, nameSpace: 'Admin.NET.Application', authorName: 'Admin.NET', generateType: '100', generateMenu: false, pagePath: 'codegen43', printType: 'auto', tableUniqueList: [{ columns: ['Name'], message: '名称不可重复' }] };
 async function addConfig(value) {
  await api(admin, 'sysCodeGen/add', value);
  const rows = (await api(admin, 'sysCodeGen/page', { page: 1, pageSize: 100, busName: value.busName })).items;
  const row = rows.find(item => item.busName === value.busName); assert.ok(row);
  zipCodeGenIds.push(String(row.id)); report.codeGenIds = [...zipCodeGenIds]; return String(row.id);
 }
 const configId = await addConfig(config);
 const fields = await api(admin, 'sysCodeGenConfig/list?codeGenId=' + configId, undefined, 'GET');
 for (const field of fields) {
  const key = field.propertyName;
  if (field.whetherCommon === 'Y' || field.columnKey === 'True') continue;
  field.whetherTable = 'Y'; field.whetherAddUpdate = 'Y'; field.whetherSortable = 'Y'; field.whetherImport = key === 'Attachment' ? 'N' : 'Y';
  field.whetherRequired = ['Notes','Attachment'].includes(key) ? 'N' : 'Y';
  field.whetherQuery = key === 'Attachment' ? 'N' : 'Y'; field.whetherRetract = 'N';
  field.queryType = key === 'Name' ? 'like' : key === 'OccurredAt' ? '~' : key === 'Notes' ? 'isNotNull' : key === 'Amount' ? '>=' : '==';
  if (key === 'Enabled') field.effectType = 'Switch';
  if (key === 'Notes') field.effectType = 'InputTextArea';
  if (key === 'Attachment') field.effectType = 'Upload_SingleFile';
  if (key === 'LinkedOrgId') Object.assign(field, { effectType: 'ApiTreeSelector', fkConfigId: String(database.configId), fkTableName: org.tableName, fkEntityName: 'SysOrg', fkLinkColumnName: 'Id', fkDisplayColumnList: ['Name'], fkColumnNetType: 'long', pidColumn: 'Pid' });
 }
 await api(admin, 'sysCodeGenConfig/update', fields);
 const preview = await api(admin, 'sysCodeGen/preview', { id: configId, generateType: '121', nameSpace: 'Ignored.RequestOverride' });
 assert.deepEqual(Object.keys(preview).sort(), ['Service.cs','Input.cs','Output.cs','Dto.cs','index.vue','editDialog.vue','api.ts'].sort());
 assert.ok(preview['index.vue'].includes('GeneratedPage') && preview['api.ts'].includes('CodeGenAcceptanceApi'));
 for (const text of [preview['index.vue'],preview['editDialog.vue'],preview['api.ts']]) assert.ok(!/element-plus|\/@@\/|\bel-table\b|\bel-form\b/u.test(text));
 report.previewTemplates = Object.keys(preview);
 record('saved-config-canonical-preview-vben-antdv-next-admin-table');
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
 page.on('request', request => { const authorization = request.headers().authorization; if (authorization) secret(authorization.replace(/^Bearer /u, '')); });
 page.on('response', response => { for (const name of ['access-token','x-access-token']) secret(response.headers()[name]); });
 const isApi = (path, method = 'POST') => response => new URL(response.url()).pathname === '/prod-api/api/' + path && response.request().method() === method;
 async function responseResult(path, action, method = 'POST') {
  const [response] = await Promise.all([page.waitForResponse(isApi(path, method)), action()]);
  assert.equal(response.status(), 200); const payload = await response.json(); assert.equal(payload.code, 200, clean(payload.message)); return payload.result;
 }
 async function choose(scope, name, label) {
  const named = scope.getByLabel(name, { exact: true }); const id = await named.getAttribute('id'); assert.ok(id);
  const control = page.locator('[id="' + id + '"]'); await control.click();
  const list = await control.getAttribute('aria-controls'); assert.ok(list);
  const popup = page.locator('.ant-select-dropdown:visible').filter({ has: page.locator('[id="' + list + '"]') });
  await expect(popup).toBeVisible(); const options = popup.locator('.ant-select-item-option').filter({ hasText: new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&') + '$', 'u') });
  if (!(await options.count()) && await control.isEditable()) await control.fill(label);
  await expect(options).toHaveCount(1); await options.click(); await expect(popup).toHaveCount(0);
 }
 async function chooseTree(scope, name, label) {
  const control = scope.getByLabel(name, { exact: true }); await control.click();
  const tree = page.locator('.ant-select-dropdown:visible .ant-select-tree'); await expect(tree).toHaveCount(1);
  await tree.locator('.ant-select-tree-title').getByText(label, { exact: true }).click(); await expect(tree).toHaveCount(0);
 }
 stage = 'production-preview-download';
 proxy = await startProductionProxy(join(root, 'Web/dist'), base);
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(route));
 const configPanel = page.locator('.codegen-page'); await expect(configPanel).toBeVisible();
 const configRow = configPanel.locator('tbody tr').filter({ has: page.getByText(fixtureBusiness, { exact: true }) }); await expect(configRow).toHaveCount(1);
 await configRow.getByRole('button', { name: '预览代码', exact: true }).click();
 const previewDialog = page.getByRole('dialog', { name: '代码预览 · ' + fixtureBusiness, exact: true }); await expect(previewDialog).toBeVisible();
 for (const [file, content] of Object.entries(preview)) { await choose(previewDialog, '生成文件', file); await expect(previewDialog.getByLabel('生成文件内容')).toHaveText(content); }
 const [zipResponse, download] = await Promise.all([page.waitForResponse(isApi('sysCodeGen/runLocal')), page.waitForEvent('download'), previewDialog.getByRole('button', { name: '下载 ZIP', exact: true }).click()]);
 const zipPayload = await zipResponse.json(); assert.equal(zipPayload.code, 200, clean(zipPayload.message)); const zip = zipPayload.result;
 assert.match(zip.url, /^\/CodeGen\/CodeGenAcceptance-[a-f0-9]{32}\.zip$/u);
 const archive = join(evidence, 'generated-code.zip'); await download.saveAs(archive);
 const archiveBytes = readFileSync(archive); assert.equal(createHash('sha256').update(archiveBytes).digest('hex'), zip.sha256);
 const extracted = await unpackCodeGen(root, runtime, native, archive, zip.manifest, preview);
 report.archive = { path: archive, sha256: zip.sha256, manifest: zip.manifest }; record('production-preview-all-files-and-zip-download-byte-manifest-match');
 await previewDialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(previewDialog).toHaveCount(0);
 stage = 'generation-type-matrix';
 for (const [type, templates] of [['111',['index.vue','editDialog.vue','api.ts']], ['121',['Service.cs','Input.cs','Output.cs','Dto.cs']]]) {
  const id = await addConfig({ ...config, tableName: type === '111' ? 'SysOrg' : 'SysNotice', busName: prefix + '_' + type, generateType: type, tableUniqueList: [] });
  const result = await api(admin, 'sysCodeGen/preview', { id, generateType: '100' }); assert.deepEqual(Object.keys(result).sort(), templates.sort());
  const generated = await api(admin, 'sysCodeGen/runLocal', { id }); assert.deepEqual(generated.manifest.map(file => file.template).sort(), templates.sort());
  const bytes = Buffer.from(await (await fetch(new URL(generated.url, base), { signal: AbortSignal.timeout(30000) })).arrayBuffer()); assert.equal(createHash('sha256').update(bytes).digest('hex'), generated.sha256);
 }
 record('saved-generation-type-front-back-all-preview-download-selection');
 stage = 'compile-generated-backend';
 const generatedApi = await buildGeneratedApi(root, runtime, native, extracted, evidence); record('zip-generated-four-csharp-files-compiled-in-real-application');
 await restartGeneratedApi(root, runtime, generatedApi); marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/u, '')); admin = await login('superAdmin.NET');
 businessTableReady = true;
 const dropdown = await api(admin, 'codeGenAcceptance/dropdownData', { fromPage: false });
 assert.ok(Array.isArray(dropdown.linkedOrgId) && dropdown.linkedOrgId.length, 'Generated tree selector returns actual organization data');
 const organization = dropdown.linkedOrgId[0]; report.organizationFixture = { id: organization.value };
 stage = 'generated-sdk-and-production-build';
 const swagger = await (await fetch(new URL('/swagger/Default/swagger.json', base), { signal: AbortSignal.timeout(30000) })).json();
 for (const action of ['page','detail','add','update','delete','batchDelete','dropdownData','export','import']) assert.ok(swagger.paths['/api/codeGenAcceptance/' + action], 'Generated endpoint is in proposal 35 Default document: ' + action);
 const app = await prepareGeneratedApp(root, runtime, native, extracted, base, evidence); generatedWorkspace = app;
 report.generatedApp = { sdkSha256: app.sdkSha256, apiBuild: true, sdkGeneratedByProposal35Tool: true, typecheck: true, productionBuild: true };
 record('real-swagger-existing-sdk-tool-generated-app-typecheck-production-build');
 await page.close(); await proxy.close(); proxy = await startProductionProxy(app.dist, base);
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(20000);
 page.on('pageerror', error => errors.push(clean(error.message))); page.on('request', request => { const token = request.headers().authorization; if (token) secret(token.replace(/^Bearer /u, '')); });
 stage = 'generated-production-crud';
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(crudRoute));
 const panel = page.locator('.generated-page'); await expect(panel).toBeVisible(); assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
 const dialog = () => page.getByRole('dialog', { name: new RegExp('^(新增|编辑)' + fixtureBusiness + '$', 'u') });
 async function fillRecord(name, amount, enabled, notes) {
  await dialog().getByLabel('名称', { exact: true }).fill(name);
  await dialog().getByLabel('金额', { exact: true }).fill(String(amount));
  const toggle = dialog().getByRole('switch', { name: '是否启用', exact: true }); if ((await toggle.getAttribute('aria-checked')) !== String(enabled)) await toggle.click();
  const date = dialog().getByLabel('发生时间', { exact: true }); await date.fill('2026-10-12 09:30:00'); await date.press('Enter');
  if (notes !== undefined) await dialog().getByLabel('备注', { exact: true }).fill(notes);
  await chooseTree(dialog(), '所属机构', String(organization.label));
 }
 await panel.getByRole('button', { name: '新增', exact: true }).click(); await expect(dialog().getByRole('button', { name: /^保\s*存$/u })).toBeEnabled();
 await dialog().getByRole('button', { name: /^保\s*存$/u }).click(); await expect(dialog().getByRole('alert')).toContainText('名称');
 await fillRecord(prefix + '_alpha', 12.34, true, '真实备注');
 const firstId = await responseResult('codeGenAcceptance/add', () => dialog().getByRole('button', { name: /^保\s*存$/u }).click()); businessIds.push(String(firstId));
 await expect(dialog()).toHaveCount(0); await expect(panel.getByText(prefix + '_alpha', { exact: true })).toBeVisible();
 const row = () => panel.locator('tbody tr').filter({ has: page.getByText(prefix + '_alpha', { exact: true }) });
 assert.equal(await sql('SELECT count(*) FROM codegen_acceptance WHERE id=' + firstId + " AND amount=12.34 AND enabled=true AND notes='真实备注' AND linkedorgid=" + organization.value + " AND occurredat::date='2026-10-12'"), '1');
 const detail = await api(admin, 'codeGenAcceptance/detail?id=' + firstId, undefined, 'GET'); assert.equal(detail.name, prefix + '_alpha');
 await row().getByRole('button', { name: '编辑', exact: true }).click(); await expect(dialog().getByLabel('名称', { exact: true })).toHaveValue(prefix + '_alpha');
 await dialog().getByLabel('名称', { exact: true }).fill(prefix + '_alpha_updated'); await dialog().getByLabel('金额', { exact: true }).fill('56.78');
 await responseResult('codeGenAcceptance/update', () => dialog().getByRole('button', { name: /^保\s*存$/u }).click()); await expect(dialog()).toHaveCount(0);
 assert.equal(await sql('SELECT count(*) FROM codegen_acceptance WHERE id=' + firstId + " AND name='" + prefix + "_alpha_updated' AND amount=56.78"), '1');
 await panel.getByRole('button', { name: '新增', exact: true }).click(); await fillRecord(prefix + '_alpha_updated', 0, false, undefined);
 const [duplicate] = await Promise.all([page.waitForResponse(isApi('codeGenAcceptance/add')), dialog().getByRole('button', { name: /^保\s*存$/u }).click()]); assert.notEqual((await duplicate.json()).code, 200);
 await expect(dialog().getByRole('alert')).toBeVisible(); await expect(dialog().getByLabel('名称', { exact: true })).toHaveValue(prefix + '_alpha_updated'); await expect(dialog().getByRole('button', { name: /^保\s*存$/u })).toBeEnabled();
 assert.equal(await sql('SELECT count(*) FROM codegen_acceptance'), '1');
 await dialog().getByLabel('名称', { exact: true }).fill(prefix + '_beta');
 const secondId = await responseResult('codeGenAcceptance/add', () => dialog().getByRole('button', { name: /^保\s*存$/u }).click()); businessIds.push(String(secondId)); await expect(dialog()).toHaveCount(0);
 assert.equal(await sql('SELECT count(*) FROM codegen_acceptance WHERE id=' + secondId + ' AND enabled=false AND amount=0 AND notes IS NULL'), '1');
 report.businessIds = [...businessIds]; record('generated-production-create-detail-update-unique-failure-draft-retry-postgresql');
 stage = 'generated-queries-and-export';
 const query = panel.locator('.generated-query');
 await choose(query, '备注', '非空'); await responseResult('codeGenAcceptance/page', () => query.getByRole('button', { name: '查询', exact: true }).click()); await expect(panel.getByText(prefix + '_alpha_updated', { exact: true })).toBeVisible(); await expect(panel.getByText(prefix + '_beta', { exact: true })).toHaveCount(0);
 await choose(query, '备注', '为空'); await responseResult('codeGenAcceptance/page', () => query.getByRole('button', { name: '查询', exact: true }).click()); await expect(panel.getByText(prefix + '_beta', { exact: true })).toBeVisible(); await expect(panel.getByText(prefix + '_alpha_updated', { exact: true })).toHaveCount(0);
 await responseResult('codeGenAcceptance/page', () => query.getByRole('button', { name: '重置', exact: true }).click());
 const ranged = await api(admin, 'codeGenAcceptance/page', { page: 1, pageSize: 100, occurredAtRange: ['2026-10-12 00:00:00','2026-10-12 23:59:59'], enabled: false }); assert.deepEqual(ranged.items.map(item => String(item.id)), [String(secondId)]);
 const [exported] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: '导出文件', exact: true }).click()]); const exportPath = join(evidence, 'generated-export.xlsx'); await exported.saveAs(exportPath); const workbook = readFileSync(exportPath); assert.ok(workbook.length > 500 && workbook[0] === 0x50 && workbook[1] === 0x4b);
 record('generated-browser-null-true-false-reset-and-real-api-range-boolean-export');
 await verifyGeneratedExtras({ native, root, evidence, page, panel, query, dialog, api, admin, firstId, prefix, organization, fixtureBusiness, sql, responseResult, generatedRecords, report, record, expect, isApi, stage: value => { stage = value; } });
 stage = 'generated-desktop-light-dark';
 for (const mode of ['light','dark']) {
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click();
  await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(mode === 'dark');
  await expect.poll(() => panel.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.screenshot({ path: join(evidence, '43-generated-crud-right-' + mode + '.png'), fullPage: true, animations: 'disabled' });
   await panel.locator('.ant-table-body, .ant-table-content').evaluateAll(elements => { for (const element of elements) element.scrollLeft = 0; });
   await expect.poll(() => panel.locator('.ant-table-body, .ant-table-content').evaluateAll(elements => elements.every(element => element.scrollLeft === 0))).toBe(true);
   await page.screenshot({ path: join(evidence, '43-generated-crud-' + mode + '.png'), fullPage: true, animations: 'disabled' });
 }
 record('generated-desktop-light-dark-table-no-horizontal-page-overflow');
 stage = 'generated-cache-draft-boundary';
 await page.evaluate(() => { window.__codegenDocument = 'same-document'; }); await panel.getByRole('button', { name: '新增', exact: true }).click(); await expect(dialog().getByRole('button', { name: /^保\s*存$/u })).toBeEnabled(); await dialog().getByLabel('名称', { exact: true }).fill(prefix + '_unsaved');
 await page.evaluate(() => { location.hash = '#/home'; }); await expect(panel).toHaveCount(0); await expect(page.getByRole('dialog')).toHaveCount(0); await page.evaluate(path => { location.hash = '#' + path; }, crudRoute); await expect(panel).toBeVisible(); assert.equal(await page.evaluate(() => window.__codegenDocument), 'same-document');
 await panel.getByRole('button', { name: '新增', exact: true }).click(); await expect(dialog().getByLabel('名称', { exact: true })).toHaveValue(''); await dialog().getByRole('button', { name: /^取\s*消$/u }).click(); await expect(dialog()).toHaveCount(0);
 record('generated-same-document-cache-leave-clears-unsaved-editor');
 stage = 'generated-delete';
 const deleteRow = panel.locator('tbody tr').filter({ has: page.getByText(prefix + '_alpha_updated', { exact: true }) }); await deleteRow.getByRole('button', { name: '删除', exact: true }).click();
 await responseResult('codeGenAcceptance/delete', () => page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/u }).click()); await expect(panel.getByText(prefix + '_alpha_updated', { exact: true })).toHaveCount(0); assert.equal(await sql('SELECT count(*) FROM codegen_acceptance WHERE id=' + firstId), '0');
 const remaining = panel.locator('tbody tr').filter({ has: page.getByText(prefix + '_beta', { exact: true }) }); await remaining.getByRole('checkbox').check(); await panel.getByRole('button', { name: '删除所选记录', exact: true }).click();
 await responseResult('codeGenAcceptance/delete', () => page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/u }).click()); assert.equal(await sql('SELECT count(*) FROM codegen_acceptance'), '0');
 record('generated-ui-delete-selected-record-and-postgresql-zero');
 stage = 'generated-stopped-api-draft-retry';
 await panel.getByRole('button', { name: '新增', exact: true }).click(); await fillRecord(prefix + '_offline', 1, false, undefined); await cleanupFixtures(); await stop();
 for (let attempt = 0; attempt < 2; attempt++) {
  const [failed] = await Promise.all([page.waitForResponse(isApi('codeGenAcceptance/add')), dialog().getByRole('button', { name: /^保\s*存$/u }).click()]); assert.ok(failed.status() >= 500);
  await expect(dialog().getByRole('alert')).toBeVisible(); await expect(dialog().getByLabel('名称', { exact: true })).toHaveValue(prefix + '_offline'); await expect(dialog().getByRole('button', { name: /^保\s*存$/u })).toBeEnabled();
 }
 await page.screenshot({ path: join(evidence, '43-generated-api-stopped.png'), fullPage: true, animations: 'disabled' });
 assert.deepEqual(errors, []); report.browserErrors = errors;
 record('generated-real-api-stopped-save-error-draft-and-retry');
}
