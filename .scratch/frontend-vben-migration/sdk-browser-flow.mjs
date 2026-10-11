// 生产桌面页面直接调用再生成 SDK；不拦截或模拟请求。
async function runSdkBrowser() {
  stage = 'production-sdk-authenticated-cache';
  proxy = await startProductionProxy(join(root, 'Web/dist'), base);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  const errors = [];
  const sharedTokens = new Set(['Bearer ' + admin.accessToken]);
  page.on('request', request => {
    const authorization = request.headers().authorization;
    if (authorization) secret(authorization.replace(/^Bearer /, ''));
    if (authorization && new URL(request.url()).pathname.startsWith('/prod-api/api/') && !new URL(request.url()).pathname.startsWith('/prod-api/api/sysCache/')) sharedTokens.add(authorization);
  });
  page.on('response', response => {
    for (const name of ['access-token', 'x-access-token']) {
      const token = response.headers()[name];
      if (token) { secret(token); if (name === 'access-token') sharedTokens.add('Bearer ' + token); }
    }
  });
  page.on('pageerror', error => errors.push(clean(error.message)));
  const isKeys = response => new URL(response.url()).pathname === '/prod-api/api/sysCache/keyList' && response.request().method() === 'GET';
  const [first] = await Promise.all([
    page.waitForResponse(isKeys),
    page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fplatform%2Fcache'),
  ]);
  assert.equal(first.status(), 200);
  const sdkAuthorization = (await first.request().allHeaders()).authorization;
  assert.ok(Boolean(sdkAuthorization) && sharedTokens.has(sdkAuthorization), 'SDK 使用普通请求或真实刷新响应中的共享令牌');
  const payload = await first.json();
  assert.equal(payload.code, 200);
  assert.ok(Array.isArray(payload.result));
  assert.ok(payload.result.length > 0, '实际登录已产生缓存键');
  const panel = page.locator('.cache-page');
  await expect(panel).toBeVisible();
  await expect(panel.getByRole('heading', { name: '缓存列表', exact: true })).toBeVisible();
  await expect.poll(() => panel.locator('[role="treeitem"]').count()).toBeGreaterThan(0);
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
  assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  record('production-sdk-shared-bearer-single-prefix-raw-response', { keyCount: payload.result.length });
  const [refresh] = await Promise.all([page.waitForResponse(isKeys), panel.getByRole('button', { name: '刷新缓存列表', exact: true }).click()]);
  assert.equal(refresh.status(), 200);
  assert.equal((await refresh.json()).code, 200);
  await expect(panel.getByRole('button', { name: '刷新缓存列表', exact: true })).toBeEnabled();
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
  await page.screenshot({ path: join(evidence, '35-sdk-cache.png'), fullPage: true });
  record('production-sdk-refresh-success');
  report.fixtureRecordsRemoved = true; // 此流程不创建业务实体，缓存仅属于一次性隔离进程。
  stage = 'production-sdk-stopped-api';
  await stop();
  for (let attempt = 0; attempt < 2; attempt++) {
    const [failed] = await Promise.all([page.waitForResponse(isKeys), panel.getByRole('button', { name: '刷新缓存列表', exact: true }).click()]);
    assert.ok(failed.status() >= 500);
    await expect(panel.getByRole('alert')).toBeVisible();
    await expect(panel.getByRole('button', { name: '刷新缓存列表', exact: true })).toBeEnabled();
  }
  await page.screenshot({ path: join(evidence, '35-sdk-stopped-api.png'), fullPage: true });
  assert.deepEqual(errors, []);
  record('production-sdk-stopped-api-error-and-retry');
}
async function cleanupFixtures() { report.fixtureRecordsRemoved = true; }
