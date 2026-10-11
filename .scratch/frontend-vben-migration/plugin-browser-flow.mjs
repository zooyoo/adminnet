// 插入真实服务基线的生产桌面流程；共享经核验的隔离 API 与清理逻辑。
async function uiCall(action, work, refused = false) {
  const [response] = await Promise.all([page.waitForResponse(r => new URL(r.url()).pathname === '/prod-api/api/sysPlugin/' + action && r.request().method() === 'POST'), work()]);
  assert.ok(response.ok(), 'HTTP ' + response.status());
  const data = await response.json();
  if (refused) { assert.ok(![200,401,403].includes(data.code)); assert.equal(data.type, 'error'); }
  else assert.equal(data.code, 200, clean(data.message ?? action));
  return response.request().postDataJSON();
}
async function setCode(dialog, value) {
  await expect(dialog.locator('.monaco-editor')).toBeVisible();
  await dialog.getByRole('textbox', { name: 'C# 代码', exact: true }).focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(value);
}
async function stableShot(name) {
  await page.mouse.move(300, 100);
  await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0, { timeout: 20000 });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(a => a.playState === 'running' && Number.isFinite(a.effect?.getComputedTiming().endTime)).length)).toBe(0);
  await page.screenshot({ path: join(evidence, name), fullPage: true });
}
async function runBrowser() {
  proxy = await startProductionProxy(join(root, 'Web/dist'), base);
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(20000);
  const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
  await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=%2Fplatform%2Fplugin');
  const panel = page.locator('.plugin-page'); await expect(panel).toBeVisible();
  await expect(panel.getByText('全部租户', { exact: true })).toBeVisible();
  assert.ok((await panel.locator('.plugin-tenant').boundingBox())?.width >= 180, '租户筛选保持可用宽度');
  assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
  assert.equal(await page.locator('script[type="module"][src^="/jse/"]').count(), 1);
  await panel.getByRole('button', { name: '新增插件', exact: true }).click();
  let dialog = page.getByRole('dialog', { name: '添加动态插件', exact: true });
  const name = prefix + '_browser';
  await dialog.getByRole('textbox', { name: '功能名称', exact: true }).fill(name);
  await setCode(dialog, code('browser34'));
  const submitted = await uiCall('add', () => dialog.getByRole('button', { name: '保存', exact: true }).click());
  await expect(dialog).toBeHidden();
  let item = await lookup(name); createdIds.add(String(item.id));
  assert.equal(await sql("SELECT encode(convert_to(csharpcode, 'UTF8'), 'hex') FROM sysplugin WHERE id=" + item.id), Buffer.from(submitted.csharpCode).toString('hex'));
  await callPlugin('browser34');
  const selected = panel.getByRole('row').filter({ hasText: name }); await expect(selected).toBeVisible();
  record('production-monaco-save-real-postgresql-and-http-execution');
  for (const mode of ['light', 'dark']) {
    if (((await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')) !== (mode === 'dark')) await page.locator('button.theme-toggle').click();
    await expect.poll(async () => (await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')).toBe(mode === 'dark');
    await stableShot('34-plugin-' + mode + '.png');
  }
  await selected.getByRole('button', { name: '编辑', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '编辑动态插件', exact: true });
  await expect(dialog.locator('.monaco-editor')).toBeVisible();
  await stableShot('34-plugin-editor.png');
  const reopened = await uiCall('update', () => dialog.getByRole('button', { name: '保存', exact: true }).click());
  assert.equal(reopened.csharpCode, submitted.csharpCode, '重开后未编辑保存保持原文');
  await expect(dialog).toBeHidden();
  await selected.getByRole('button', { name: '编辑', exact: true }).click();
  await setCode(dialog, 'invalid C# source');
  item = await lookup(name);
  const before = await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + item.id);
  const invalid = await uiCall('update', () => dialog.getByRole('button', { name: '保存', exact: true }).click(), true);
  assert.equal(invalid.csharpCode, 'invalid C# source');
  await expect(dialog.getByRole('alert', { name: '插件保存错误' })).toContainText(/CS\d{4}/);
  await expect(dialog.getByRole('alert', { name: '插件保存错误' })).toBeFocused();
  await expect(dialog).toBeVisible();
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + item.id), before);
  await callPlugin('browser34'); await stableShot('34-plugin-compile-failure.png');
  // 再次保存同一草稿，确认错误后编辑器没有被旧列表值覆盖。
  const retained = await uiCall('update', () => dialog.getByRole('button', { name: '保存', exact: true }).click(), true);
  assert.equal(retained.csharpCode, invalid.csharpCode);
  await expect(dialog.getByRole('alert', { name: '插件保存错误' })).toBeFocused();
  await setCode(dialog, code('browserUpdated34'));
  await uiCall('update', () => dialog.getByRole('button', { name: '保存', exact: true }).click());
  await expect(dialog).toBeHidden(); await callPlugin('browserUpdated34');
  record('production-reopen-original-compile-failure-retains-draft-and-update-recovery');
  await selected.getByRole('button', { name: '删除', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '删除动态插件', exact: true });
  await confirmation.getByRole('button', { name: '取消', exact: true }).click();
  await expect(confirmation).toBeHidden(); await callPlugin('browserUpdated34');
  await selected.getByRole('button', { name: '删除', exact: true }).click();
  await uiCall('delete', () => confirmation.getByRole('button', { name: '删除', exact: true }).click());
  await expect(confirmation).toBeHidden(); await expect(selected).toHaveCount(0);
  assert.equal(await sql('SELECT count(*) FROM sysplugin WHERE id=' + item.id), '0');
  await callPlugin(null); assert.deepEqual(errors, []);
  record('production-delete-cancel-confirm-database-and-route-removal');
  await panel.getByRole('button', { name: '新增插件', exact: true }).click();
  dialog = page.getByRole('dialog', { name: '添加动态插件', exact: true });
  const stoppedName = prefix + '_stopped';
  await dialog.getByRole('textbox', { name: '功能名称', exact: true }).fill(stoppedName);
  await setCode(dialog, code('stopped34'));
  await cleanupFixtures(); await stop();
  let previous;
  for (let attempt = 0; attempt < 2; attempt++) {
    const [response] = await Promise.all([
      page.waitForResponse(r => new URL(r.url()).pathname === '/prod-api/api/sysPlugin/add' && r.request().method() === 'POST'),
      dialog.getByRole('button', { name: '保存', exact: true }).click(),
    ]);
    assert.ok(response.status() >= 500, '停止真实 API 后代理返回服务失败');
    const body = response.request().postDataJSON(); assert.equal(body.name, stoppedName);
    if (previous) assert.deepEqual(body, previous, '失败重试保持相同草稿');
    assert.ok(body.csharpCode.includes('stopped34')); previous = body;
    await expect(dialog.getByRole('alert', { name: '插件保存错误' })).toBeFocused();
    await expect(dialog.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
    await expect(dialog.getByRole('textbox', { name: '功能名称', exact: true })).toHaveValue(stoppedName);
  }
  assert.equal(await sql("SELECT count(*) FROM sysplugin WHERE starts_with(name, '" + prefix + "')"), '0');
  await stableShot('34-plugin-stopped-api.png');
  await dialog.getByRole('button', { name: '取消', exact: true }).click(); await expect(dialog).toBeHidden();
  assert.deepEqual(errors, []);
  record('real-api-stopped-save-and-retry-preserve-draft-no-write-cancel-usable');
}
