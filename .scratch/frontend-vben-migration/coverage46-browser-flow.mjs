const coverageMenus = [], coverageTenants = [], nginxResources = [];
let coverageBaseline, coverageOnlineBaseline;
const coverageTables = ['sysmenu', 'systenant', 'sysorg', 'syspos', 'sysrole', 'sysrolemenu', 'systenantmenu', 'sysuserrole', 'sysusermenu', 'sysuserextorg'];
async function coverageDigest() {
  const parts = [];
  for (const table of coverageTables) parts.push(await sql("SELECT md5(coalesce(string_agg(row_to_json(x)::text, '|' ORDER BY id), '')) FROM " + table + ' x'));
  parts.push(await sql("SELECT md5(coalesce(string_agg(concat(id, ':', account, ':', tenantid, ':', orgid, ':', posid), '|' ORDER BY id), '')) FROM sysuser"));
  return parts.join(':');
}
async function cleanupFixtures() {
  for (const item of coverageTenants.toReversed()) {
    if (await sql('SELECT count(*) FROM systenant WHERE id=' + item.id) !== '0') await api(admin, 'sysTenant/delete', { id: item.id });
    for (const table of ['sysorg', 'syspos', 'sysrole', 'systenantmenu', 'sysuser']) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE tenantid=' + item.id), '0');
  }
  for (const id of coverageMenus.toReversed()) {
    if (await sql('SELECT count(*) FROM sysmenu WHERE id=' + id) !== '0') await api(admin, 'sysMenu/delete', { id });
    for (const table of ['sysmenu', 'sysrolemenu', 'systenantmenu', 'sysusermenu']) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + (table === 'sysmenu' ? 'id' : 'menuid') + '=' + id), '0');
  }
  if (coverageBaseline) assert.equal(await coverageDigest(), coverageBaseline, 'Owned tenants, roles, users and grants must return to the original values');
  report.fixtureRecordsRemoved = true;
}
async function cleanupRuntimeNginx() {
  const settled = await Promise.allSettled(nginxResources.map(resource => resource.close()));
  const errors = settled.filter(item => item.status === 'rejected').map(item => item.reason);
  if (errors.length) throw new AggregateError(errors, 'Owned Nginx cleanup failed');
  report.nginxRemoved = true;
}
async function refused(session, path, input) {
  const response = await fetch(new URL('/api/' + path, base), { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + session.accessToken }, body: JSON.stringify(input) });
  const body = await response.text();
  const result = body ? JSON.parse(body) : {};
  assert.ok(response.status === 403 || (response.status === 200 && [400, 403].includes(result.code)), path + ' must reject unauthorized access');
  assert.ok(result.result == null);
  return { path, status: response.status, code: result.code };
}
async function loginCoverage(account, password, tenantId) {
  if (!password) password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/u)[1];
  secret(password);
  const identity = await api(undefined, 'sysAuth/login', { account, tenantId, password: sm2.doEncrypt(password, getPublishedPublicKey(), 1) });
  secret(identity.accessToken); secret(identity.refreshToken); return identity;
}
async function runRuntimeBrowser() {
  report.scope = 'available-integrations-with-user-deferred-live-playback';
  report.proposalComplete = false; report.deferredProposals = [41];
  coverageBaseline = await coverageDigest(); coverageOnlineBaseline = await sql('SELECT count(*) FROM sysonlineuser');
  stage = 'real-role-user-tenant-fixtures';
  for (const [suffix, component, title] of [['pos', '/system/pos/index', '连续职位'], ['org', '/system/org/index', '连续机构']]) {
    const name = prefix + '_' + suffix;
    coverageMenus.push(String(await api(admin, 'sysMenu/add', { pid: 0, type: 1, title: prefix + '_' + title, name, path: '/' + name, component, visible: true, isKeepAlive: true, status: 1, orderNo: 1, icon: 'ele-Menu' })));
  }
  const buttons = JSON.parse(await sql("SELECT coalesce(json_agg(id::text), '[]'::json) FROM sysmenu WHERE permission LIKE 'sysPos:%' OR permission LIKE 'sysOrg:%'"));
  const readButton = await sql("SELECT id::text FROM sysmenu WHERE permission='sysPos:list'");
  assert.match(readButton, /^\d+$/u);
  const profileButtons = JSON.parse(await sql("SELECT coalesce(json_agg(id::text), '[]'::json) FROM sysmenu WHERE permission='sysUser:baseInfo'"));
  assert.equal(profileButtons.length, 1, 'Fixture grants only the existing own-profile permission');
  const home = JSON.parse(await sql("SELECT coalesce(json_agg(id::text), '[]'::json) FROM sysmenu WHERE name='home' OR title='工作台'"));
  for (const key of ['a', 'b']) {
    const account = prefix + '_admin_' + key, tenantName = prefix + '_租户_' + key;
    await api(admin, 'sysTenant/add', { name: tenantName, adminAccount: account, tenantType: 0, status: 1, enableReg: 2, orderNo: 100 });
    const item = JSON.parse(await sql("SELECT row_to_json(x) FROM (SELECT id::text AS id, userid::text AS userid, orgid::text AS orgid FROM systenant WHERE userid=(SELECT id FROM sysuser WHERE account=" + quote(account) + ')) x'));
    coverageTenants.push({ ...item, account, tenantName });
    await api(admin, 'sysTenant/grantMenu', { id: item.id, menuIdList: [...coverageMenus, ...buttons, ...profileButtons, ...home] });
    const identity = await loginCoverage(account, undefined, item.id), positionName = prefix + '_position_' + key;
    await api(identity, 'sysPos/add', { name: positionName, code: positionName, status: 1, orderNo: 100 });
    const posId = await sql('SELECT id::text FROM syspos WHERE tenantid=' + item.id + ' AND name=' + quote(positionName));
    Object.assign(coverageTenants.at(-1), { identity, positionName, posId });
  }
  const [a, b] = coverageTenants, normalRole = prefix + '_read_role', normalAccount = prefix + '_reader';
  await api(admin, 'sysRole/add', { tenantId: a.id, name: normalRole, code: normalRole, status: 1, dataScope: 1, menuIdList: [coverageMenus[0], readButton, ...profileButtons, ...home] });
  const roleId = await sql('SELECT id::text FROM sysrole WHERE tenantid=' + a.id + ' AND code=' + quote(normalRole)); assert.match(roleId, /^\d+$/u);
  const userId = await api(admin, 'sysUser/add', { account: normalAccount, realName: prefix + '_普通用户', tenantId: a.id, orgId: a.orgid, posId: a.posId, accountType: 777, langCode: 'zh-CN', roleIdList: [roleId], extOrgIdList: [] });
  const normalPassword = secret(await api(admin, 'sysUser/resetPwd', { id: userId }));
  const reader = await loginCoverage(normalAccount, normalPassword, a.id), readerInfo = await api(reader, 'sysAuth/userInfo', undefined, 'GET');
  assert.equal(String(readerInfo.tenantId), a.id); assert.equal(readerInfo.accountType, 777);
  assert.ok(readerInfo.buttons.includes('sysPos:list')); assert.equal(readerInfo.buttons.includes('sysPos:add'), false);
  const tenantAList = await api(a.identity, 'sysPos/list?tenantId=' + b.id, undefined, 'GET');
  assert.ok(tenantAList.some(row => String(row.id) === a.posId)); assert.equal(tenantAList.some(row => String(row.id) === b.posId), false);
  const refusals = [await refused(a.identity, 'sysPos/update', { id: b.posId, tenantId: a.id, name: 'forged', code: 'forged', status: 1, orderNo: 1 }), await refused(reader, 'sysPos/add', { tenantId: a.id, name: prefix + '_forbidden', code: prefix + '_forbidden', status: 1 }), await refused(reader, 'sysTenant/changeTenant', { id: b.id })];
  assert.equal(await sql('SELECT name FROM syspos WHERE id=' + b.posId), b.positionName);
  record('postgresql-two-tenants-read-only-user-and-rejected-cross-boundary-operations', { tenantIds: [a.id, b.id], roleId, userId: String(userId), refusals });
  const nginx = await createRuntimeNginx({ root, runtime, backend: base.href, native, template: 'Web/scripts/deploy/nginx.conf' }); nginxResources.push(nginx); await nginx.setApiUrl('/prod-api/');
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const context = await browser.newContext({ viewport: { width: 1680, height: 1100 } }); page = await context.newPage(); page.setDefaultTimeout(20000);
  const browserErrors = []; page.on('pageerror', error => browserErrors.push(clean(error.message)));
  const mainPath = '/' + prefix + '_pos';
  async function animations() { await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && Number.isFinite(Number(animation.effect?.getComputedTiming().iterations))).length)).toBe(0); }
  async function navigate(path) { await page.evaluate(value => { location.hash = value; }, path); await expect(page.getByText(/加载菜单中/u)).toBeHidden({ timeout: 30000 }); await animations(); }
  async function shot(name) { await animations(); assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true); await page.screenshot({ path: join(evidence, name), fullPage: true, animations: 'disabled', mask: [page.locator('input[type=password]')] }); }
  async function uiLogin(account, password, tenantId) {
    if (!password) password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/u)[1]; secret(password);
    await page.goto(nginx.baseUrl + '/#/login' + (tenantId ? '?tenantId=' + tenantId : ''));
    await expect(page).toHaveURL(/#\/auth\/login(?:\?|$)/u);
    const loginButton = page.getByRole('button', { name: /^登\s*录$/u }); await expect(loginButton).toBeEnabled();
    await page.getByLabel('账号', { exact: true }).fill(account); await page.getByLabel('密码', { exact: true }).fill(password);
    await expect(page.getByLabel('账号', { exact: true })).toHaveValue(account);
    const [response] = await Promise.all([page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/api/sysAuth/login') && value.request().method() === 'POST'), loginButton.click()]);
    const result = await response.json(); assert.equal(result.code, 200, clean(result.message)); secret(result.result.accessToken); secret(result.result.refreshToken);
    await expect(page).not.toHaveURL(/#\/auth\/login/u); await expect(page.getByText(/加载菜单中/u)).toBeHidden({ timeout: 30000 });
  }
  stage = 'anonymous-legacy-public-dial-route';
  const contact = { realName: prefix + '_拨号', number: '+86 (138) 0013-8000' }, legacyToken = secret('unused-' + randomBytes(12).toString('hex'));
  await page.goto(nginx.baseUrl + '/$callTel#/$callTel?code=' + encodeURIComponent(encodeURIComponent(JSON.stringify(contact))) + '&token=' + encodeURIComponent(legacyToken));
  await expect(page.getByRole('link', { name: '拨打电话', exact: true })).toHaveAttribute('href', 'tel:+8613800138000'); await expect(page.getByText(contact.realName, { exact: true })).toBeVisible(); await expect(page).not.toHaveURL(/token=/u); await shot('46-public-dial.png');
  await page.reload(); await expect(page.getByRole('link', { name: '拨打电话', exact: true })).toBeVisible();
  await page.goto(nginx.baseUrl + '/#/$callTel?code=%25malformed'); await expect(page.getByRole('alert')).toContainText('拨号信息无效'); await expect(page.getByRole('link', { name: '拨打电话', exact: true })).toHaveCount(0);
  record('anonymous-public-dial-legacy-double-encoding-deep-refresh-and-invalid-input');
  stage = 'normal-user-continuous-position-profile-workbench';
  await uiLogin(normalAccount, normalPassword, a.id); await navigate(mainPath); const panel = page.locator('.position-page');
  const positionRow = name => panel.getByRole('row').filter({ has: page.getByRole('cell', { name, exact: true }) });
  await expect(positionRow(a.positionName)).toBeVisible(); await expect(positionRow(b.positionName)).toHaveCount(0); await expect(panel.getByRole('button', { name: '新增职位', exact: true })).toHaveCount(0); await expect(page.getByRole('button', { name: '切换租户', exact: true })).toHaveCount(0); if (await page.locator('html').evaluate(element => element.classList.contains('dark'))) await page.getByRole('button', { name: 'light', exact: true }).click();
  await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(false); await shot('46-normal-position-light.png');
  await page.reload(); await expect(positionRow(a.positionName)).toBeVisible();
  await navigate('/profile'); await expect(page.getByLabel('账号', { exact: true })).toHaveValue(normalAccount);
  await navigate('/dashboard/home'); await expect(page.locator('.workbench')).toBeVisible();
  await navigate(mainPath); await expect(positionRow(a.positionName)).toBeVisible(); record('normal-user-read-only-tenant-filter-deep-refresh-profile-workbench-and-cache-return');
  stage = 'normal-user-logout-and-identity-cleanup';
  await page.getByRole('button', { name: '退出登录', exact: true }).click(); const confirm = page.getByRole('dialog').filter({ hasText: '退出' }); await confirm.getByRole('button', { name: /^确\s*(?:定|认)$/u }).click(); await expect(page).toHaveURL(/#\/auth\/login/u); await expect(page.getByText(a.positionName, { exact: true })).toHaveCount(0);
  await navigate(mainPath); await expect(page).toHaveURL(/#\/auth\/login/u); record('logout-clears-old-identity-cache-and-protects-deep-route');
  stage = 'administrator-cross-tenant-same-document-workflow';
  await uiLogin('superAdmin.NET'); const documentId = await page.evaluate(() => { window.__coverageDocument = crypto.randomUUID(); return window.__coverageDocument; });
  async function switchTenant(item) {
    await page.getByRole('button', { name: '切换租户', exact: true }).click(); const dialog = page.getByRole('dialog', { name: '切换租户', exact: true }); await dialog.getByRole('combobox', { name: '租户', exact: true }).click(); await page.getByRole('option', { name: item.tenantName, exact: true }).click();
    const changed = page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/api/sysTenant/changeTenant') && value.request().method() === 'POST'); await dialog.getByRole('button', { name: /^确\s*(?:定|认)$/u }).click(); const result = await (await changed).json(); assert.equal(result.code, 200, clean(result.message)); secret(result.result.accessToken); secret(result.result.refreshToken);
    const info = await api(result.result, 'sysAuth/userInfo', undefined, 'GET'); assert.equal(String(info.currentTenantId), item.id); await expect(dialog).toBeHidden(); assert.equal(await page.evaluate(() => window.__coverageDocument), documentId); await navigate(mainPath); await expect(positionRow(item.positionName)).toBeVisible();
  }
  await switchTenant(a); await panel.getByRole('button', { name: '新增职位', exact: true }).click(); let editor = page.getByRole('dialog', { name: '添加职位', exact: true }); await editor.getByLabel('职位名称', { exact: true }).fill(prefix + '_discarded_draft'); await editor.getByRole('button', { name: /^取\s*消$/u }).click();
  await switchTenant(b); await expect(positionRow(a.positionName)).toHaveCount(0); await panel.getByRole('button', { name: '新增职位', exact: true }).click(); editor = page.getByRole('dialog', { name: '添加职位', exact: true }); await expect(editor.getByLabel('职位名称', { exact: true })).toHaveValue('');
  const newName = prefix + '_ui_b'; await editor.getByLabel('职位名称', { exact: true }).fill(newName); await editor.getByLabel('职位编码', { exact: true }).fill(newName); const added = page.waitForResponse(value => new URL(value.url()).pathname.endsWith('/api/sysPos/add') && value.request().method() === 'POST'); await editor.getByRole('button', { name: /^确\s*(?:定|认)$/u }).click(); assert.equal((await (await added).json()).code, 200); await expect(positionRow(newName)).toBeVisible(); assert.equal(await sql('SELECT tenantid::text FROM syspos WHERE name=' + quote(newName)), b.id);
  await navigate('/' + prefix + '_org'); await expect(page.locator('.org-page').getByRole('tree').getByText(b.tenantName, { exact: true })).toBeVisible(); await navigate(mainPath); await expect(positionRow(newName)).toBeVisible(); await switchTenant(a); await expect(positionRow(newName)).toHaveCount(0); await expect(positionRow(a.positionName)).toBeVisible(); record('administrator-same-document-tenant-switch-clears-drafts-and-maintains-pg-isolation');
  stage = 'desktop-theme-continuous-workflow';
  for (const mode of ['light', 'dark']) { const dark = await page.locator('html').evaluate(element => element.classList.contains('dark')); if (dark !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click(); await expect.poll(() => page.locator('html').evaluate(element => element.classList.contains('dark'))).toBe(mode === 'dark'); await shot('46-admin-tenant-' + mode + '.png'); }
  record('desktop-themes-tenant-workflow-no-horizontal-overflow'); await context.close(); await expect.poll(() => sql('SELECT count(*) FROM sysonlineuser'), { timeout: 30000 }).toBe(coverageOnlineBaseline); assert.deepEqual(browserErrors, []); report.browserErrors = browserErrors; report.serverSessionCleanupConfirmed = true; await cleanupFixtures(); record('owned-pg-relations-and-online-sessions-restored');
}
