
const runtimeMenuIds = [], runtimeFileIds = [], nginxResources = [];
let runtimeDigests, runtimeJobId, runtimeOnlineBaseline;
const pngFileName = prefix + '_runtime45';
async function runtimeDigest() {
  return sql("SELECT concat(md5(coalesce((SELECT string_agg(row_to_json(x)::text, '|' ORDER BY id) FROM sysmenu x), '')), ':', md5(coalesce((SELECT string_agg(row_to_json(x)::text, '|' ORDER BY id) FROM sysfile x), '')))");
}
async function cleanupFixtures() {
  if (runtimeJobId) {
    await api(admin, 'sysJob/deleteJobDetail', { jobId: runtimeJobId });
    assert.equal(await sql('SELECT count(*) FROM sysjobdetail WHERE jobid=' + quote(runtimeJobId)), '0');
    runtimeJobId = undefined;
  }
  const files = JSON.parse(await sql("SELECT coalesce(json_agg(row_to_json(x)), '[]'::json) FROM (SELECT id::text AS id, filepath, suffix FROM sysfile WHERE filename=" + quote(pngFileName) + ') x'));
  for (const file of files) {
    await api(admin, 'sysFile/delete', { id: file.id });
    const physical = resolve(runtime, 'wwwroot', file.filepath, file.id + file.suffix);
    assert.ok(physical.startsWith(resolve(runtime, 'wwwroot') + '\\'));
    assert.equal(existsSync(physical), false, 'Owned uploaded file must be removed');
  }
  for (const id of runtimeMenuIds) {
    await api(admin, 'sysMenu/delete', { id });
    for (const table of ['sysmenu', 'sysrolemenu', 'systenantmenu', 'sysusermenu']) {
      assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + (table === 'sysmenu' ? 'id' : 'menuid') + '=' + id), '0');
    }
  }
  assert.equal(await sql('SELECT count(*) FROM sysfile WHERE filename=' + quote(pngFileName)), '0');
  if (runtimeDigests) assert.equal(await runtimeDigest(), runtimeDigests, 'File and menu summaries must return to their original values');
  report.fixtureRecordsRemoved = true; report.generatedFilesRemoved = true;
}
async function cleanupRuntimeNginx() {
  const results = await Promise.allSettled(nginxResources.map(resource => resource.close()));
  const errors = results.filter(value => value.status === 'rejected').map(value => value.reason);
  if (errors.length) throw new AggregateError(errors, 'Owned Nginx cleanup failed');
  report.nginxRemoved = true;
}
async function runtimeShot(name) {
  await expect(page.getByText('登录成功', { exact: true })).toBeHidden({ timeout: 20000 });
  await expect(page.getByText(/加载菜单中/u)).toBeHidden({ timeout: 20000 });
  await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: join(evidence, name), fullPage: true, animations: 'disabled', mask: [page.locator('input[type=password]')] });
}
async function runRuntimeBrowser() {
  stage = 'owned-postgresql-nginx-preconditions';
  const config = JSON.parse(readFileSync(join(runtime, 'appsettings.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(config.JobSchedule.IsolatedOnly, true);
  runtimeDigests = await runtimeDigest();
  runtimeOnlineBaseline = await sql('SELECT count(*) FROM sysonlineuser');
  const tenantId = String(await sql("SELECT tenantid FROM sysuser WHERE account='superAdmin.NET' LIMIT 1"));
  const onlineRoute = '/' + prefix + '_online';
  runtimeMenuIds.push(String(await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: '运行时代理在线验收', name: prefix + '_online', path: onlineRoute, component: '/system/onlineUser/index', status: 1 })));
  const templates = ['Web/scripts/deploy/nginx.conf', 'docker/nginx/conf/nginx.conf'];
  browser = await chromium.launch({ channel: 'msedge', headless: true });
  const errors = [], requests = [], responses = [], ws = [], sseEvents = [];
  report.requests = requests; report.sseResponses = []; report.runtimeConfigurations = [];
  let context;
  const password = secret(readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8').match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)[1]);
  for (const [templateIndex, template] of templates.entries()) {
    stage = 'nginx-config-validation-' + templateIndex;
    const nginx = await createRuntimeNginx({ root, runtime, backend: base, native, template });
    nginxResources.push(nginx);
    const origin = nginx.tlsUrl ?? nginx.baseUrl;
    record('real-nginx-template-http-tls-syntax-' + templateIndex, { template, tls: Boolean(nginx.tlsUrl) });
    const modes = templateIndex === 0 ? ['prod-api/', origin + '/prod-api/', '/prod-api/'] : ['/prod-api/'];
    for (const [modeIndex, apiUrl] of modes.entries()) {
      stage = 'runtime-login-hub-' + templateIndex + '-' + modeIndex;
      nginx.setApiUrl(apiUrl);
      if (modeIndex === 0) {
        context = await browser.newContext({ viewport: { width: 1680, height: 1100 }, ignoreHTTPSErrors: true, acceptDownloads: true });
        page = await context.newPage(); page.setDefaultTimeout(20000);
        page.on('pageerror', error => errors.push(clean(error.message)));
        page.on('request', request => { const url = new URL(request.url()); if (url.pathname.includes('/api/') || url.pathname.includes('/hubs/')) requests.push({ path: url.pathname, method: request.method(), template: templateIndex, mode: modeIndex }); });
        page.on('websocket', socket => { const entry = { path: new URL(socket.url()).pathname, closed: false, received: 0 }; ws.push(entry); socket.on('framereceived', () => entry.received++); socket.on('close', () => { entry.closed = true; }); });
        page.on('response', response => { const contentType = response.headers()['content-type'] ?? ''; const entry = { path: new URL(response.url()).pathname, status: response.status(), contentType, cacheControl: response.headers()['cache-control'] }; responses.push(entry); if (contentType.includes('text/event-stream')) report.sseResponses.push(entry); });
        const cdp = await context.newCDPSession(page); await cdp.send('Network.enable');
        cdp.on('Network.eventSourceMessageReceived', event => sseEvents.push({ name: event.eventName, size: event.data.length, time: event.timestamp }));
      }
      const indexResponse = await context.request.get(origin + '/index.html');
      assert.equal(indexResponse.status(), 200); assert.match(indexResponse.headers()['cache-control'], /no-store/);
      const configResponse = await context.request.get(origin + '/' + nginx.configName);
      assert.equal(configResponse.status(), 200); assert.match(configResponse.headers()['cache-control'], /no-store/);
      assert.ok((await configResponse.text()).includes(JSON.stringify(apiUrl)));
      const assetResponse = await context.request.get(origin + nginx.assetPath);
      assert.equal(assetResponse.status(), 200); assert.match(assetResponse.headers()['cache-control'], /max-age=31536000.*immutable/);
      const apiResponse = await context.request.get(origin + '/prod-api/api/sysConfig/sysInfo');
      assert.equal(apiResponse.status(), 200); assert.equal((await apiResponse.json()).code, 200); assert.match(apiResponse.headers()['cache-control'], /no-store/);
      if (modeIndex === 0) {
        await page.goto(origin + '/#/auth/login?redirect=' + encodeURIComponent(onlineRoute));
        await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
        await page.getByLabel('密码', { exact: true }).fill(password);
        const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/prod-api/api/sysAuth/login' && response.request().method() === 'POST');
        await page.getByRole('button', { name: /^登\s*录$/u }).click();
        assert.equal((await (await loginResponse).json()).code, 200);
      } else {
        await page.reload();
      }
      await expect(page.locator('.online-users')).toBeVisible();
      await expect(page.getByText('已连接', { exact: true })).toBeVisible({ timeout: 30000 });
      const loadedUrl = await page.evaluate(() => window._VBEN_ADMIN_PRO_APP_CONF_.VITE_GLOB_API_URL);
      assert.equal(loadedUrl, apiUrl);
      await expect.poll(() => ws.some(entry => entry.path === '/prod-api/hubs/onlineUser' && entry.received > 0 && !entry.closed)).toBe(true);
      assert.equal(requests.some(value => /prod-api\/prod-api|\/api\/api\//.test(value.path)), false);
      report.runtimeConfigurations.push({ template, kind: apiUrl.startsWith('http') ? 'absolute' : 'relative', reloadedWithoutBuild: modeIndex > 0 });
      await runtimeShot('45-runtime-online-' + templateIndex + '-' + modeIndex + '.png');
      record('runtime-config-login-reload-sdk-hub-cache-' + templateIndex + '-' + modeIndex);
    }
    stage = 'nginx-file-upload-preview-download-' + templateIndex;
    await page.goto(origin + '/#/platform/file'); const filePanel = page.locator('.file-page'); await expect(filePanel).toBeVisible();
    await expect.poll(() => page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running' && animation.effect?.getTiming().iterations !== Infinity).length)).toBe(0);
    const sourceImage = join(evidence, '45-upload-source.png');
    if (templateIndex === 0) await native('C:/Users/zoyo/.dsh/dsh-runtimes/dsh-primary-runtime/dependencies/python/python.exe', ['-c', "from PIL import Image, ImageDraw; import sys; image=Image.new('RGB',(360,180),'#1677ff'); draw=ImageDraw.Draw(image); draw.rounded_rectangle((12,12,348,168),radius=16,fill='#e6f4ff'); draw.text((30,55),'Nginx runtime 45',fill='#0050b3',font_size=24); draw.text((30,100),'HTTP / TLS: real upload and download',fill='#0050b3',font_size=14); image.save(sys.argv[1],'PNG')", sourceImage]);
    const fileBytes = readFileSync(sourceImage);
    if (templateIndex === 0) {
      await filePanel.getByRole('button', { name: '上传文件', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: '上传文件', exact: true });
      await dialog.locator('input[type=file]').setInputFiles({ name: pngFileName + '.png', mimeType: 'image/png', buffer: fileBytes });
      await dialog.locator('.ant-form-item').filter({ hasText: '公开文件' }).getByRole('switch').click();
      const uploadResponse = page.waitForResponse(value => new URL(value.url()).pathname === '/prod-api/api/sysFile/uploadFile' && value.request().method() === 'POST');
      await dialog.getByRole('button', { name: /^确\s*定$/u }).click();
      assert.equal((await (await uploadResponse).json()).code, 200); await expect(dialog).toBeHidden();
    }
    await filePanel.getByLabel('文件名称', { exact: true }).fill(pngFileName);
    await filePanel.getByRole('button', { name: /^查\s*询$/u }).click();
    const row = filePanel.locator('.ant-table-tbody tr').filter({ hasText: pngFileName });
    await expect(row).toHaveCount(1);
    const files = JSON.parse(await sql("SELECT json_agg(row_to_json(x)) FROM (SELECT id::text AS id, url, ispublic FROM sysfile WHERE filename=" + quote(pngFileName) + ') x'));
    assert.equal(files.length, 1); assert.equal(files[0].ispublic, true); runtimeFileIds.push(files[0].id);
    await row.getByRole('button', { name: /^预\s*览$/u }).click();
    const preview = page.getByRole('dialog', { name: pngFileName + '.png', exact: true });
    await expect.poll(() => preview.locator('img').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
    await runtimeShot('45-runtime-file-preview-' + templateIndex + '.png');
    await preview.getByRole('button', { name: '关闭', exact: true }).click();
    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: /^下\s*载$/u }).click()]);
    const downloaded = join(evidence, '45-file-' + templateIndex + '.png'); await download.saveAs(downloaded);
    assert.deepEqual(readFileSync(downloaded), fileBytes);
    const resourceUrl = origin + '/prod-api/' + files[0].url.replace(/^\//, '');
    const publicFile = await context.request.get(resourceUrl);
    assert.equal(publicFile.status(), 200); assert.deepEqual(await publicFile.body(), fileBytes);
    await page.goto(origin + '/desktop-refresh#/platform/file');
    await expect(page.locator('.file-page')).toBeVisible();
    assert.match((await context.request.get(origin + '/desktop-refresh')).headers()['cache-control'], /no-store/);
    record('nginx-upload-preview-auth-download-public-url-deep-refresh-' + templateIndex);
    stage = 'existing-dashboard-sse-' + templateIndex;
    await page.goto(origin + '/#/platform/job'); await expect(page.locator('.job-page')).toBeVisible();
    await page.getByRole('button', { name: '打开独立调度看板', exact: true }).click();
    const iframe = page.locator('iframe[title="独立调度看板"]'); await expect(iframe).toHaveAttribute('src', '/schedule/');
    const frame = page.frameLocator('iframe[title="独立调度看板"]');
    await frame.locator('input:not([type=password])').fill('superAdmin.NET'); await frame.locator('input[type=password]').fill(password);
    await frame.getByRole('button', { name: /^登\s*录$/u }).click();
    await expect(frame.locator('input[type=password]')).toHaveCount(0);
    const initialEvents = sseEvents.length;
    runtimeJobId = prefix + '-nginx-event';
    await api(admin, 'sysJob/addJobDetail', { jobId: runtimeJobId, groupName: prefix, description: prefix, concurrent: false, includeAnnotation: false, createType: 1, properties: JSON.stringify({ marker: prefix }), scriptCode: 'using System.Threading; using System.Threading.Tasks; using Furion.Schedule; [JobDetail("' + runtimeJobId + '")] public class IsolatedJob : IJob { public Task ExecuteAsync(JobExecutingContext context, CancellationToken stoppingToken) { context.Result = "isolated-runtime"; return Task.CompletedTask; } }' });
    await expect.poll(() => report.sseResponses.some(value => value.path.startsWith('/schedule') && value.status === 200), { timeout: 15000 }).toBe(true);
    await expect.poll(() => sseEvents.length > initialEvents, { timeout: 15000 }).toBe(true);
    await expect(frame.getByText(runtimeJobId, { exact: true })).toBeVisible();
    assert.ok(report.sseResponses.every(value => /no-store/.test(value.cacheControl ?? '')), 'SSE response must not be cached');
    report.sseEvents = sseEvents;
    report.eventStreams = responses.filter(value => value.path === '/schedule/api/check-change');
    record('existing-authenticated-dashboard-sse-real-event-unbuffered-' + templateIndex);
    await api(admin, 'sysJob/deleteJobDetail', { jobId: runtimeJobId }); runtimeJobId = undefined;
    stage = 'browser-context-close-server-confirmed-' + templateIndex;
    assert.ok(Number(await sql('SELECT count(*) FROM sysonlineuser')) > Number(runtimeOnlineBaseline));
    await context.close();
    await expect.poll(() => sql('SELECT count(*) FROM sysonlineuser'), { timeout: 30000 }).toBe(runtimeOnlineBaseline);
    record('browser-context-close-hub-disconnect-postgresql-confirmed-' + templateIndex);
    report.webSocketClosure = { serverConfirmed: true, observed: ws.length, closeEvents: ws.filter(value => value.closed).length };
  }
  report.browserErrors = errors; assert.deepEqual(errors, []);
  report.noDuplicatedPrefix = true;
  await cleanupFixtures();
  record('postgresql-file-menu-job-owned-records-and-physical-cleanup');
}
