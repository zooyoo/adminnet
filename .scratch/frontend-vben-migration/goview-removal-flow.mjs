// 仅连接已校验的一次性 PostgreSQL/API；不模拟请求、不调用外部消息服务。
async function runRemoval() {
  stage = 'removed-swagger-and-routes';
  assert.ok(!existsSync(join(root, '.scratch/frontend-vben-migration/goview-removal-api-build/Admin.NET.Plugin.GoView.dll')));
  const documents = {};
  for (const group of ['Default']) {
    const response = await fetch(new URL('/swagger/' + group + '/swagger.json', base), { signal: AbortSignal.timeout(30000) });
    assert.equal(response.status, 200);
    documents[group] = await response.json();
    assert.ok(Object.keys(documents[group].paths).length > 0);
    assert.ok(Object.keys(documents[group].paths).every(path => !/goview/i.test(path)));
  }
  const removed = await fetch(new URL('/swagger/GoView/swagger.json', base), { signal: AbortSignal.timeout(30000) });
  assert.equal(removed.status, 404);
  assert.deepEqual(documents.Default.components.schemas.TemplateTypeEnum.enum, [1, 2, 3, 4, 7]);
  // 使用第 35 项真实生成快照逐项验证旧路由，不调用未知的外部地址。
  const oldSwagger = JSON.parse(readFileSync(join(tmpdir(), 'adminnet-vben-0ded3c4486e24fd498e15e123b1733a3/evidence/swagger-GoView.json'), 'utf8'));
  let routeCount = 0;
  for (const [path, operations] of Object.entries(oldSwagger.paths)) {
    assert.match(path, /^\/api\/goview\//i);
    for (const method of Object.keys(operations).filter(value => ['get', 'post', 'put', 'delete', 'patch'].includes(value))) {
      const response = await fetch(new URL(path.replace(/\{[^}]+\}/g, '1'), base), { method: method.toUpperCase(), headers: { Authorization: 'Bearer ' + admin.accessToken, 'Content-Type': 'application/json' }, ...(method === 'get' ? {} : { body: '{}' }), signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 404, method + ' ' + path);
      routeCount++;
    }
  }
  assert.equal(routeCount, 14);
  record('removed-goview-document-and-all-previous-routes', { routeCount, retainedDefaultPaths: Object.keys(documents.Default.paths).length });
  stage = 'retained-template-type-and-persistence';
  initialTemplateDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM systemplate t");
  const fixtureTenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
  assert.match(fixtureTenantId, /^[1-9]\d*$/);
  const draft = { name: prefix + '_wechatwork', code: prefix + '_code', groupName: prefix, type: 7, content: '保留企业微信 @(name)', orderNo: 1, tenantId: fixtureTenantId };
  await api(admin, 'sysTemplate/add', { ...draft, type: 5 }, 'POST', true);
  await api(admin, 'sysTemplate/page', { page: 1, pageSize: 20, type: 5 }, 'POST', true);
  assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM systemplate t"), initialTemplateDigest);
  await api(admin, 'sysTemplate/add', draft);
  const result = await api(admin, 'sysTemplate/page', { page: 1, pageSize: 20, name: draft.name, type: 7 });
  assert.equal(result.items.length, 1);
  const saved = result.items[0];
  createdIds.add(String(saved.id));
  assert.equal(saved.type, 7);
  assert.equal(await sql('SELECT type FROM systemplate WHERE id=' + String(saved.id)), '7');
  assert.equal(await api(admin, 'sysTemplate/proView', { id: saved.id, data: { name: '测试' } }), '保留企业微信 测试');
  record('removed-type-five-refused-unchanged-and-type-seven-persisted');
  stage = 'production-real-account-login';
  proxy = await startProductionProxy(join(root, 'Web/dist'), base);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  const errors = [], removedCalls = [];
  page.on('pageerror', error => errors.push(clean(error.message)));
  page.on('request', request => {
    const token = request.headers().authorization;
    if (token) secret(token.replace(/^Bearer /, ''));
    if (/\/api\/goview\//i.test(new URL(request.url()).pathname)) removedCalls.push(new URL(request.url()).pathname);
  });
  page.on('response', response => { for (const name of ['access-token', 'x-access-token']) secret(response.headers()[name]); });
  await page.goto(proxy.baseUrl + '/#/login?tenantId=' + encodeURIComponent(fixtureTenantId) + '&redirect=%2Fsystem%2Ftemplate');
  const loginPanel = page.locator('.login-form');
  await expect(loginPanel).toBeVisible();
  const submit = loginPanel.getByRole('button', { name: /^登\s*录$/ });
  await expect(submit).toBeEnabled();
  await expect(page.locator('#__app-loading__')).toBeHidden({ timeout: 20000 });
  await expect(page.getByText(/GoView|大屏可视化/i)).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '37-login-no-goview.png'), fullPage: true, animations: 'disabled' });
  const password = secret(readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]);
  await loginPanel.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
  await loginPanel.getByLabel('密码', { exact: true }).fill(password);
  const [loginResponse] = await Promise.all([page.waitForResponse(response => new URL(response.url()).pathname === '/prod-api/api/sysAuth/login' && response.request().method() === 'POST'), submit.click()]);
  assert.equal(loginResponse.status(), 200);
  const loginResult = await loginResponse.json();
  secret(loginResult.result?.accessToken); secret(loginResult.result?.refreshToken);
  assert.equal(loginResult.code, 200);
  const panel = page.locator('.template-page');
  await expect(panel).toBeVisible();
  await panel.getByRole('textbox', { name: '查询模板名称', exact: true }).fill(draft.name);
  const [listed] = await Promise.all([
    page.waitForResponse(response => new URL(response.url()).pathname === '/prod-api/api/sysTemplate/page' && response.request().method() === 'POST'),
    panel.getByRole('button', { name: '查询模板', exact: true }).click(),
  ]);
  assert.equal(listed.status(), 200);
  const listedBody = await listed.json();
  assert.equal(listedBody.code, 200);
  report.templateQuery = listed.request().postDataJSON();
  assert.equal(String(report.templateQuery.tenantId), fixtureTenantId, '真实登录及数据所属租户一致');
  report.templateResultCount = listedBody.result?.items?.length;
  persist();
  assert.equal(listedBody.result.items.length, 1, '浏览器真实查询返回本次模板');
  await expect(panel.getByRole('row').filter({ hasText: draft.name })).toBeVisible();
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
  assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 15000 });
  await panel.getByRole('button', { name: '新增模板', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '添加模板', exact: true });
  await dialog.getByRole('combobox', { name: '模板类型', exact: true }).click();
  const options = page.locator('.ant-select-dropdown:visible .ant-select-item-option-content');
  await expect(options).toHaveText(['通知', '短信', '邮件', '微信', '企业微信']);
  const dropdown = page.locator('.ant-select-dropdown:visible');
  await expect(dropdown).toHaveCount(1);
  await expect.poll(() => dropdown.evaluate(element => getComputedStyle(element).opacity)).toBe('1');
  await page.waitForFunction(() => document.getAnimations().every(animation => animation.playState !== 'running' || animation.effect?.getComputedTiming().iterations === Infinity));
  await expect(options.filter({ hasText: /^企业微信$/ })).toBeVisible();
  await page.screenshot({ path: join(evidence, '37-template-types.png'), fullPage: true });
  await options.filter({ hasText: /^企业微信$/ }).click();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toBeHidden();
  record('production-account-login-and-template-options-without-goview');
  await cleanupFixtures();
  stage = 'production-retained-cache';
  const isKeys = response => new URL(response.url()).pathname === '/prod-api/api/sysCache/keyList' && response.request().method() === 'GET';
  const [keys] = await Promise.all([page.waitForResponse(isKeys), page.evaluate(() => { location.hash = '/platform/cache'; })]);
  assert.equal(keys.status(), 200); assert.equal((await keys.json()).code, 200);
  const cachePanel = page.locator('.cache-page');
  await expect(cachePanel).toBeVisible();
  const refresh = cachePanel.getByRole('button', { name: '刷新缓存列表', exact: true });
  const [response] = await Promise.all([page.waitForResponse(isKeys), refresh.click()]);
  assert.equal(response.status(), 200); assert.equal((await response.json()).code, 200);
  await expect(refresh).toBeEnabled();
  await page.mouse.move(0, 0);
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '37-retained-cache.png'), fullPage: true, animations: 'disabled' });
  record('production-retained-cache-real-api-success');
  stage = 'production-real-api-stop';
  await stop();
  const [failed] = await Promise.all([page.waitForResponse(isKeys), refresh.click()]);
  assert.ok(failed.status() >= 500);
  await expect(cachePanel.getByRole('alert')).toBeVisible();
  await expect(refresh).toBeEnabled();
  assert.deepEqual(errors, []); assert.deepEqual(removedCalls, []);
  record('production-stopped-api-recoverable-error-no-goview-requests');
}
async function cleanupFixtures() {
  const owned = await api(admin, 'sysTemplate/page', { page: 1, pageSize: 100, name: prefix });
  assert.ok(owned.total <= 100 && owned.items.every(row => row.name.startsWith(prefix)));
  const failures = [];
  for (const row of owned.items) try { await api(admin, 'sysTemplate/delete', { id: row.id }); } catch (error) { failures.push(error.message); }
  assert.deepEqual(failures, []);
  assert.equal(await sql("SELECT count(*) FROM systemplate WHERE starts_with(name, '" + prefix + "')"), '0');
  if (initialTemplateDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM systemplate t"), initialTemplateDigest);
  report.fixtureRecordsRemoved = true;
}
