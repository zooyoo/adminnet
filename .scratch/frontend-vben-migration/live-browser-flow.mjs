const liveMenuIds = [];
let liveMenuDigest;
async function runLiveBrowser() {
 const errorsOnly = process.argv.includes('--errors-only');
 report.scope = errorsOnly ? 'production-error-and-resource-cleanup' : 'production-complete-live-playback';
 report.realPlaybackConfirmed = false;
 stage = 'live-menu-fixture';
 liveMenuDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
 const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
 const route = '/' + prefix + '_live';
 const id = await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: '直播隔离验收', name: prefix + '_live', path: route, component: '/elive/index', status: 1 });
 assert.match(String(id), /^[1-9]\d*$/); liveMenuIds.push(String(id)); report.menuIds = [...liveMenuIds];
 assert.ok(JSON.stringify(await api(admin, 'sysMenu/vbenMenuTree', undefined, 'GET')).includes(route));
 proxy = await startProductionProxy(join(root, 'Web/dist'), base);
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
 page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
 const sdkResponses = []; page.on('response', response => { const path = new URL(response.url()).pathname; if (/\/ezuikit-[\w-]+\.js$/u.test(path)) sdkResponses.push({ path, status: response.status() }); });
 const sockets = []; page.on('websocket', socket => { const host = new URL(socket.url()).hostname; if (host !== '127.0.0.1' && host !== 'localhost') { const entry = { socket, closed: false }; socket.on('close', () => { entry.closed = true; }); sockets.push(entry); } });
 async function assertDisposed() {
  await expect(panel.locator('iframe')).toHaveCount(0);
  await expect.poll(() => page.frames().filter(frame => frame !== page.mainFrame() && /ys7\.com/u.test(frame.url())).length).toBe(0);
  await expect.poll(() => sockets.filter(entry => !entry.closed && !entry.socket.isClosed()).length, { timeout: 15000 }).toBe(0);
 }
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(route));
 const panel = page.locator('.live-page');
 await expect(panel.getByRole('heading', { name: '直播与视频', exact: true })).toBeVisible();
 record('production-real-login-dynamic-live-menu', { menuId: String(id) });
 const tokenInput = panel.locator('#live-token'), urlInput = panel.locator('#live-url');
 const open = () => panel.getByRole('button', { name: /^(?:打开视频|重试播放)$/u }).click();
 stage = 'live-invalid-input';
 await tokenInput.fill('invalid-local-input'); await urlInput.fill('https://example.invalid/video'); await open();
 await expect(panel.getByRole('alert')).toContainText('ezopen'); await assertDisposed();
 record('invalid-protocol-has-safe-error-without-player');
 let chosenUrl = 'ezopen://open.ys7.com/BC7900686/1.live';
 let demoToken;
 if (!errorsOnly) {
  stage = 'live-official-demo-token';
  const tokenResponse = await fetch('https://open.ys7.com/jssdk/ezopen/demo/token', { signal: AbortSignal.timeout(20000) });
  assert.equal(tokenResponse.status, 200);
  const tokenResult = await tokenResponse.json(); assert.equal(String(tokenResult.code), '200');
  demoToken = secret(tokenResult.data.accessToken); assert.ok(demoToken);
  stage = 'live-real-first-frame';
  const attempts = []; let opened = false;
  for (const device of ['BC7900686', 'G39444019', 'BC7799091', 'BD3957004']) {
   const url = 'ezopen://open.ys7.com/' + device + '/1.live';
   await tokenInput.fill(demoToken); await urlInput.fill(url); await open();
   await expect.poll(async () => (await panel.getByRole('status').first().innerText()).includes('正在打开'), { timeout: 55000 }).toBe(false);
   const state = await panel.getByRole('status').first().innerText(); attempts.push({ device, state });
   if (state.includes('已打开')) { chosenUrl = url; opened = true; break; }
   await panel.getByRole('button', { name: '退出并清除', exact: true }).click();
  }
  report.playbackAttempts = attempts; persist();
  assert.ok(opened, '官方公开示例必须由真实 SDK 成功打开');
  let mediaFrame, mediaState;
  await expect.poll(async () => {
   for (const frame of page.frames()) {
    const state = await frame.evaluate(() => ({ videos: [...document.querySelectorAll('video')].map(v => ({ width: v.videoWidth, height: v.videoHeight, readyState: v.readyState, time: v.currentTime })), canvases: [...document.querySelectorAll('canvas')].map(c => ({ width: c.width, height: c.height })) })).catch(() => undefined);
    if (state && (state.videos.some(v => v.width > 0 && v.height > 0 && v.readyState >= 2) || state.canvases.some(c => c.width > 0 && c.height > 0))) { mediaFrame = frame; mediaState = state; return true; }
   }
   return false;
  }, { timeout: 30000 }).toBe(true);
  assert.ok(mediaFrame); report.realMedia = mediaState;
  report.realPlaybackConfirmed = true;
  record('production-sdk-real-authorized-device-first-frame');
  await page.screenshot({ path: join(evidence, '41-live-playing.png'), fullPage: true, mask: [tokenInput, urlInput] });
  stage = 'live-stop';
  await panel.getByRole('button', { name: '停止播放', exact: true }).click(); await assertDisposed();
  await expect(tokenInput).toHaveValue(demoToken); await expect(urlInput).toHaveValue(chosenUrl);
  record('stop-removes-sdk-context-and-keeps-editable-draft');
 }
 stage = 'live-invalid-token';
 const badToken = secret('invalid-live-' + randomBytes(12).toString('hex'));
 await tokenInput.fill(badToken); await urlInput.fill(chosenUrl); await open();
 await expect(panel.getByRole('alert')).toContainText('播放失败', { timeout: 55000 });
 await assertDisposed(); await expect(tokenInput).toHaveValue(badToken); await expect(urlInput).toHaveValue(chosenUrl);
 assert.equal((await panel.innerText()).includes(badToken), false);
 assert.ok(sdkResponses.some(item => item.status === 200), '生产真实 SDK 资产必须成功加载');
 report.sdkResources = sdkResponses;
 record('invalid-token-real-sdk-safe-error-cleanup-and-retry-draft');
 stage = 'live-desktop-visual';
 const mask = [tokenInput, urlInput, ...secrets.map(value => page.getByText(value, { exact: false }))];
 for (const mode of ['light', 'dark']) {
  const dark = await page.locator('html').evaluate(el => el.classList.contains('dark'));
  if (dark !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click();
  await expect.poll(() => page.locator('html').evaluate(el => el.classList.contains('dark'))).toBe(mode === 'dark');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: join(evidence, '41-live-' + mode + '.png'), fullPage: true, mask });
 }
 record('desktop-live-light-dark-no-horizontal-overflow');
 stage = 'live-stop-during-loading';
 await open(); await expect(panel.locator('iframe')).toHaveCount(1);
 await panel.getByRole('button', { name: '停止播放', exact: true }).click(); await assertDisposed();
 await expect(tokenInput).toHaveValue(badToken); await expect(panel.getByRole('status').first()).toContainText('未播放');
 record('stop-during-loading-removes-real-sdk-context-and-retains-draft');
 stage = 'live-route-cleanup';
 await open(); await expect(panel.locator('iframe')).toHaveCount(1);
 const documentIdentity = await page.evaluate(() => window.__liveDocumentIdentity = crypto.randomUUID());
 await page.evaluate(() => { location.hash = '#/platform/cache'; });
 await expect(page.locator('.live-page')).toHaveCount(0);
 assert.equal(await page.evaluate(() => window.__liveDocumentIdentity), documentIdentity);
 await page.evaluate(route => { location.hash = '#' + route; }, route);
 await expect(panel.getByRole('heading', { name: '直播与视频', exact: true })).toBeVisible();
 await expect(tokenInput).toHaveValue(''); await expect(urlInput).toHaveValue(''); await assertDisposed();
 record('same-document-leave-clears-credentials-and-player-context');
 await tokenInput.fill(badToken); await urlInput.fill(chosenUrl);
 await panel.getByRole('button', { name: '退出并清除', exact: true }).click();
 await expect(tokenInput).toHaveValue(''); await expect(urlInput).toHaveValue(''); await assertDisposed();
 record('explicit-clear-removes-credentials-and-player-context');
 report.externalMediaSocketsClosed = sockets.every(entry => entry.closed || entry.socket.isClosed());
 report.browserErrors = errors; assert.deepEqual(errors, []);
}
async function cleanupFixtures() {
 const failures = [];
 for (const id of liveMenuIds) { try { await api(admin, 'sysMenu/delete', { id }); } catch (error) { failures.push(clean(error.message)); } }
 try {
  for (const id of liveMenuIds) for (const [table, field] of [['sysmenu','id'],['systenantmenu','menuid'],['sysrolemenu','menuid'],['sysusermenu','menuid']]) assert.equal(await sql(`SELECT count(*) FROM ${table} WHERE ${field}=${id}`), '0');
  if (liveMenuDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t"), liveMenuDigest);
 } catch (error) { failures.push(clean(error.message)); }
 report.fixtureRecordsRemoved = failures.length === 0; assert.deepEqual(failures, []);
}
