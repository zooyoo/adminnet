import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { unpackCodeGen } from './codegen-zip-fixture.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function authorizedRoot(runtime) {
 const target = join(realpathSync(runtime), 'authorized-project');
 assert.equal(dirname(target), realpathSync(runtime));
 assert.equal(readFileSync(join(target, '.adminnet-authorized-project'), 'utf8').replace(/^\uFEFF/u, ''), runtime);
 assert.equal(realpathSync(target), target);
 return target;
}
function noStage(root) {
 for (const entry of readdirSync(root, { withFileTypes: true })) {
  assert.ok(!entry.name.startsWith('.adminnet-codegen-'), 'No publication stage remains after success or full recovery');
  if (entry.isDirectory() && !entry.isSymbolicLink()) noStage(join(root, entry.name));
 }
}
export function cleanupDirectProject(runtime) {
 const target = join(realpathSync(runtime), 'authorized-project');
 if (!existsSync(target)) return;
 const owned = authorizedRoot(runtime);
 rmSync(owned, { recursive: true, force: false }); assert.equal(existsSync(owned), false);
 const outside = join(realpathSync(runtime), 'direct-outside');
 if (existsSync(outside)) {
  assert.equal(dirname(realpathSync(outside)), realpathSync(runtime));
  assert.deepEqual(readdirSync(outside), ['protected.txt']); rmSync(outside, { recursive: true, force: false });
 }
}
export async function verifyDirectGeneration(context) {
 const { root, runtime, native, evidence, base, page, previewDialog, api, admin, configId, preview, report, record, expect, responseResult, menuIds, prefix, sql } = context;
 const authorized = authorizedRoot(runtime);
 const outside = join(runtime, 'direct-outside'); mkdirSync(outside);
 const outsideSentinel = join(outside, 'protected.txt');
 const protectedBytes = Buffer.from('授权清单之外的原始字节\r\n' + prefix, 'utf8'); writeFileSync(outsideSentinel, protectedBytes);
 const insideSentinel = join(authorized, 'protected.txt'); writeFileSync(insideSentinel, protectedBytes);
 const menuDigestSql = ['sysmenu','sysrolemenu','systenantmenu','sysusermenu'].map(table => "coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY id) FROM " + table + " t), '')").join(" || '#' || ");
 const digest = () => sql('SELECT md5(' + menuDigestSql + ')'); const baselineDigest = await digest();
 async function rejected(path, body) {
  const response = await fetch(new URL('/api/' + path, base), { method: 'POST', headers: { Authorization: 'Bearer ' + admin.accessToken, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const payload = await response.json(); assert.notEqual(payload.code, 200, 'Unsafe or stale operation must be rejected: ' + path);
  assert.equal(await digest(), baselineDigest, 'Rejected operation preserves menu and grant rows'); return payload;
 }
 // 同一份已保存配置比较 ZIP 与直接生成，临时切换后恢复菜单开关。
 await sql("UPDATE syscodegen SET generatetype='100', generatemenu=false WHERE id=" + configId);
 let zip;
 try {
  const zipPreview = await api(admin, 'sysCodeGen/preview', { id: configId }); assert.deepEqual(zipPreview, preview);
  zip = await api(admin, 'sysCodeGen/runLocal', { id: configId });
  const response = await fetch(new URL(zip.url, base), { signal: AbortSignal.timeout(30000) }); assert.equal(response.status, 200);
  const bytes = Buffer.from(await response.arrayBuffer()); assert.equal(sha(bytes), zip.sha256);
  const archive = join(evidence, 'direct-reference.zip'); writeFileSync(archive, bytes);
  await unpackCodeGen(root, runtime, native, archive, zip.manifest, preview);
  report.referenceZip = { sha256: zip.sha256, manifest: zip.manifest };
 } finally { await sql("UPDATE syscodegen SET generatetype='200', generatemenu=true WHERE id=" + configId); }
 assert.equal(await digest(), baselineDigest); record('same-saved-config-direct-preview-and-zip-byte-manifest-match');
 await rejected('sysCodeGen/runLocal', { id: configId });
 await sql("UPDATE syscodegen SET pagepath='../direct-outside' WHERE id=" + configId);
 try { await rejected('sysCodeGen/directPlan', { id: configId }); } finally { await sql("UPDATE syscodegen SET pagepath='codegen44' WHERE id=" + configId); }
 // 联接只创建在自有副本内；拒绝后只移除联接本身。
 const linkedPath = join(authorized, 'Web'); symlinkSync(outside, linkedPath, 'junction');
 try { await rejected('sysCodeGen/directPlan', { id: configId }); }
 finally { assert.equal(realpathSync(linkedPath), realpathSync(outside)); unlinkSync(linkedPath); }
 const danglingTarget = join(runtime, 'direct-missing-target');
 symlinkSync(danglingTarget, linkedPath, 'junction');
 try { await rejected('sysCodeGen/directPlan', { id: configId }); }
 finally { unlinkSync(linkedPath); }
 assert.equal(existsSync(danglingTarget), false);
 assert.deepEqual(readFileSync(outsideSentinel), protectedBytes); noStage(authorized);
 record('direct-traversal-junction-and-legacy-unreviewed-write-rejected');
 const initial = await api(admin, 'sysCodeGen/directPlan', { id: configId }); assert.equal(initial.files.length, 7);
 for (const file of initial.files) {
  assert.ok(resolve(file.path).startsWith(authorized + sep)); assert.equal(file.sha256, sha(Buffer.from(preview[file.template], 'utf8')));
  const relative = file.path.slice((file.template.endsWith('.cs') ? join(authorized, 'Admin.NET') : authorized).length + 1).replaceAll('\\', '/');
  assert.equal(zip.manifest.find(item => item.template === file.template).path, relative);
 }
 const existing = initial.files.find(file => file.template === 'Service.cs'); mkdirSync(dirname(existing.path), { recursive: true });
 const originalBytes = Buffer.from([0xff, 0xfe, 0x00, 0x61, 0x0d, 0x0a, 0x00, 0x42]); writeFileSync(existing.path, originalBytes);
 await rejected('sysCodeGen/runDirect', { id: configId, fingerprint: initial.fingerprint, overwrite: true });
 const reviewed = await api(admin, 'sysCodeGen/directPlan', { id: configId });
 await rejected('sysCodeGen/runDirect', { id: configId, fingerprint: reviewed.fingerprint, overwrite: false });
 await sql("UPDATE syscodegen SET menuicon='changed-after-review' WHERE id=" + configId);
 try { await rejected('sysCodeGen/runDirect', { id: configId, fingerprint: reviewed.fingerprint, overwrite: true }); }
 finally { await sql("UPDATE syscodegen SET menuicon='ele-Menu' WHERE id=" + configId); }
 assert.deepEqual(readFileSync(existing.path), originalBytes); assert.deepEqual(readFileSync(insideSentinel), protectedBytes);
 record('direct-existing-file-unauthorized-overwrite-and-changed-menu-config-rejected');
 const reviewButton = previewDialog.getByRole('button', { name: '核对生成清单', exact: true });
 await responseResult('sysCodeGen/directPlan', () => reviewButton.click());
 const manifestList = previewDialog.getByRole('region', { name: '直接生成清单', exact: true }).locator('li'); await expect(manifestList).toHaveCount(7);
 const generateButton = previewDialog.getByRole('button', { name: '直接生成', exact: true });
 const checkbox = previewDialog.getByRole('checkbox', { name: '允许覆盖清单中已核对的现有文件', exact: true });
 await expect(generateButton).toBeDisabled(); await checkbox.check(); await expect(generateButton).toBeEnabled();
 for (const mode of ['light','dark']) {
  await previewDialog.getByRole('button', { name: '关闭', exact: true }).click(); await expect(previewDialog).toHaveCount(0);
  if (await page.locator('html').evaluate(element => element.classList.contains('dark')) !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click();
  await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(mode === 'dark');
  await context.openPreview(); await responseResult('sysCodeGen/directPlan', () => reviewButton.click());
  await expect(checkbox).not.toBeChecked(); await checkbox.check();
  await expect.poll(() => previewDialog.evaluate(element => element.getAnimations({ subtree: true }).filter(animation => animation.playState === 'running').length)).toBe(0);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));
  await page.screenshot({ path: join(evidence, '44-direct-plan-' + mode + '.png'), fullPage: true, animations: 'disabled' });
 }
 record('production-direct-manifest-exact-overwrite-checkbox-and-stable-light-dark');
 const trigger = prefix + '_direct_fail';
 await sql("CREATE FUNCTION " + trigger + "() RETURNS trigger AS $$ BEGIN IF NEW.permission='codeGenAcceptance:export' THEN RAISE EXCEPTION 'isolated direct menu rollback'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql; CREATE TRIGGER " + trigger + " BEFORE INSERT OR UPDATE ON sysmenu FOR EACH ROW EXECUTE FUNCTION " + trigger + "();");
 try {
  const [failed] = await Promise.all([page.waitForResponse(context.isApi('sysCodeGen/runDirect')), generateButton.click()]); const failure = await failed.json(); assert.notEqual(failure.code, 200); assert.ok(failure.message.includes('isolated direct menu rollback'), 'The real PostgreSQL trigger is reached after file publication');
  await expect(previewDialog.getByRole('alert')).toBeVisible(); await expect(generateButton).toBeEnabled();
  assert.deepEqual(readFileSync(existing.path), originalBytes); assert.equal(existsSync(join(authorized, 'Web')), false, 'New frontend directories are removed after menu transaction failure');
  assert.equal(await digest(), baselineDigest); noStage(authorized);
 } finally { await sql('DROP TRIGGER IF EXISTS ' + trigger + ' ON sysmenu; DROP FUNCTION IF EXISTS ' + trigger + '();'); }
 record('real-postgresql-menu-trigger-failure-rolls-back-files-new-directories-and-grants');
 const applied = await responseResult('sysCodeGen/runDirect', () => generateButton.click());
 for (const file of applied.files) assert.deepEqual(readFileSync(file.path), Buffer.from(preview[file.template], 'utf8'));
 assert.deepEqual(readFileSync(insideSentinel), protectedBytes); assert.deepEqual(readFileSync(outsideSentinel), protectedBytes); noStage(authorized);
 const menus = JSON.parse(await sql("SELECT coalesce(json_agg(t), '[]'::json)::text FROM (WITH RECURSIVE tree AS (SELECT * FROM sysmenu WHERE title LIKE '" + prefix + "%' UNION ALL SELECT m.* FROM sysmenu m JOIN tree p ON m.pid=p.id) SELECT DISTINCT id,pid,type,permission,title,component,path FROM tree) t"));
 for (const menu of menus) if (!menuIds.includes(String(menu.id))) menuIds.push(String(menu.id));
 const directory = menus.find(menu => menu.type === 1 && menu.title === context.fixtureBusiness); assert.ok(directory);
 const generatedPage = menus.find(menu => String(menu.pid) === String(directory.id) && menu.type === 2); assert.ok(generatedPage);
 assert.equal(generatedPage.component, '/codegen44/codeGenAcceptance/index');
 const buttons = menus.filter(menu => String(menu.pid) === String(generatedPage.id) && menu.type === 3); assert.ok(buttons.some(menu => menu.permission === 'codeGenAcceptance:page'));
 const customId = String(await api(admin, 'sysMenu/add', { pid: generatedPage.id, type: 3, title: prefix + '_自定义权限', permission: 'codeGenAcceptance:custom44', status: 1 })); menuIds.push(customId);
 const keyIds = [String(generatedPage.id), String(buttons.find(menu => menu.permission === 'codeGenAcceptance:page').id), customId];
 for (const [table, key, source] of [['sysrolemenu','roleid','sysrole'],['sysusermenu','userid','sysuser'],['systenantmenu','tenantid','systenant']]) {
  for (const id of keyIds) await sql('INSERT INTO ' + table + '(id,' + key + ',menuid) SELECT (SELECT coalesce(max(id),0)+1 FROM ' + table + '), (SELECT id FROM ' + source + ' ORDER BY id LIMIT 1), ' + id + ' WHERE NOT EXISTS (SELECT 1 FROM ' + table + ' WHERE menuid=' + id + ' AND ' + key + '=(SELECT id FROM ' + source + ' ORDER BY id LIMIT 1))');
 }
 const grantsSql = "SELECT md5(" + ['sysrolemenu','systenantmenu','sysusermenu'].map(table => "coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY id) FROM " + table + ' t WHERE menuid IN (' + keyIds.join(',') + ")), '')").join(" || '#' || ") + ')';
 const identitySql = "SELECT md5(string_agg(id::text||'#'||pid::text||'#'||coalesce(permission,''), '|' ORDER BY id)) FROM sysmenu WHERE id IN (" + [...buttons.map(menu => menu.id), generatedPage.id, directory.id, customId].join(',') + ')';
 const grantDigest = await sql(grantsSql); const identities = await sql(identitySql);
 // 已存在菜单的更新分支同样必须与文件发布一起回滚。
 const repeatDigest = await digest();
 writeFileSync(existing.path, originalBytes);
 await responseResult('sysCodeGen/directPlan', () => reviewButton.click()); await checkbox.check();
 await sql("CREATE FUNCTION " + trigger + "() RETURNS trigger AS $$ BEGIN IF NEW.permission='codeGenAcceptance:export' THEN RAISE EXCEPTION 'isolated direct menu rollback'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql; CREATE TRIGGER " + trigger + " BEFORE INSERT OR UPDATE ON sysmenu FOR EACH ROW EXECUTE FUNCTION " + trigger + "();");
 try {
  const [failedRepeat] = await Promise.all([page.waitForResponse(context.isApi('sysCodeGen/runDirect')), generateButton.click()]);
  const payload = await failedRepeat.json(); assert.notEqual(payload.code, 200, 'An existing button update failure must reject publication');
  assert.ok(payload.message.includes('isolated direct menu rollback'));
  assert.deepEqual(readFileSync(existing.path), originalBytes); assert.equal(await digest(), repeatDigest); noStage(authorized);
  await expect(previewDialog.getByRole('alert')).toBeVisible(); await expect(generateButton).toBeEnabled();
 } finally { await sql('DROP TRIGGER IF EXISTS ' + trigger + ' ON sysmenu; DROP FUNCTION IF EXISTS ' + trigger + '();'); }
 record('existing-menu-update-failure-restores-file-bytes-all-menu-rows-and-grants');

 await responseResult('sysCodeGen/directPlan', () => reviewButton.click()); await expect(generateButton).toBeDisabled(); await checkbox.check();
 await responseResult('sysCodeGen/runDirect', () => generateButton.click());
 assert.equal(await sql(identitySql), identities); assert.equal(await sql(grantsSql), grantDigest); assert.equal(await sql('SELECT count(*) FROM sysmenu WHERE id=' + customId), '1'); noStage(authorized);
 report.directPublication = { fingerprint: applied.fingerprint, files: applied.files, menuIds: [...menus.map(menu => String(menu.id)), customId], originalBytesRestoredAfterFailure: true, unrelatedBytesPreserved: true, repeatedIdsPermissionsAndGrantsPreserved: true, noStagingResidue: true };
 record('direct-preview-bytes-repeated-menu-button-ids-custom-permissions-and-all-grants-preserved');
 await responseResult('sysCodeGen/directPlan', () => reviewButton.click()); await checkbox.check();
 await page.evaluate(() => { window.__directDocument = 'same-document'; location.hash = '#/home'; }); await expect(previewDialog).toHaveCount(0);
 await page.evaluate(route => { location.hash = '#' + route; }, context.route); await context.openPreview(); assert.equal(await page.evaluate(() => window.__directDocument), 'same-document');
 await expect(manifestList).toHaveCount(0); await expect(checkbox).toHaveCount(0); await expect(generateButton).toBeDisabled(); await previewDialog.getByRole('button', { name: '关闭', exact: true }).click();
 record('direct-same-document-cache-leave-clears-reviewed-plan-and-overwrite-consent');
 report.directBoundary = { traversalRejected: true, junctionRejected: true, legacyUnreviewedWriteRejected: true, staleFileRejected: true, staleMenuConfigurationRejected: true, explicitOverwriteRequired: true };
 return authorized;
}
