let mqttBroker;
let mqttProbe;
let secondMqttBroker;
const mqttMenuIds = [];
let mqttMenuDigest;
async function runMqttBrowser() {
 stage = 'mqtt-menu-fixture';
 mqttMenuDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
 const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
 const route = '/' + prefix + '_mqtt';
 const id = await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: 'MQTT隔离验收', name: prefix + '_mqtt', path: route, component: '/mqttx/index', status: 1 });
 assert.match(String(id), /^[1-9]\d*$/); mqttMenuIds.push(String(id)); report.menuIds = [...mqttMenuIds];
 assert.ok(JSON.stringify(await api(admin, 'sysMenu/vbenMenuTree', undefined, 'GET')).includes(route));
 mqttBroker = await createMqttBroker(runtime, native, secret);
 report.brokerImage = mqttBroker.image;
 proxy = await startProductionProxy(join(root, 'Web/dist'), base);
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' });
 page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
 await page.addInitScript(() => {
  window.__mqttSockets = [];
  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class extends NativeWebSocket {
   constructor(...args) { super(...args); window.__mqttSockets.push(this); }
  };
 });
 const sockets = []; page.on('websocket', socket => { const entry = { socket, url: socket.url(), closed: false, error: false }; sockets.push(entry); socket.on('close', () => { entry.closed = true; }); socket.on('socketerror', () => { entry.error = true; }); });
 async function assertSocketsClosed(urls) {
  const started = Date.now();
  try {
   // 原生 WebSocket.close() 先进入 CLOSING；必须等待真实关闭握手完成。
   await expect.poll(() => page.evaluate(urls => window.__mqttSockets.filter(socket => urls.includes(socket.url) && socket.readyState !== WebSocket.CLOSED).length, urls), { timeout: 35000 }).toBe(0);
   await expect.poll(() => sockets.filter(entry => urls.includes(entry.url) && !entry.socket.isClosed()).length).toBe(0);
  } finally {
   report.socketCloseWaitMs = Date.now() - started;
   report.socketStates = await page.evaluate(urls => window.__mqttSockets.filter(socket => urls.includes(socket.url)).map(socket => ({ url: socket.url, readyState: socket.readyState })), urls);
   report.socketEvents = sockets.filter(entry => urls.includes(entry.url)).map(entry => ({ url: entry.url, closedEvent: entry.closed, closed: entry.socket.isClosed(), error: entry.error }));
   persist();
  }
 }
 stage = 'mqtt-production-page';
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(route));
 const panel = page.locator('.mqtt-page'); await expect(panel).toBeVisible();
 await expect(panel.getByRole('heading', { name: 'MQTT 连接与消息', exact: true })).toBeVisible();
 assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
 record('production-real-login-dynamic-mqtt-menu');
 stage = 'mqtt-connect-subscribe-publish';
 const deviceToken = secret(randomBytes(16).toString('hex'));
 await panel.locator('#mqtt-mqttToken').fill(deviceToken);
 for (const [field, value] of Object.entries({ host: '127.0.0.1', port: String(mqttBroker.port), username: mqttBroker.username, password: mqttBroker.password, repacket: mqttBroker.registration })) await panel.locator('#mqtt-' + field).fill(value);
 const topic = mqttBroker.prefix + '/probe';
 await panel.locator('#mqtt-topics').fill(topic);
 await panel.locator('#mqtt-publish-topic').fill(topic);
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 1 个主题', { exact: true })).toBeVisible();
 await panel.getByRole('checkbox', { name: '原始消息（不封装设备指令）' }).check();
 await panel.locator('#mqtt-payload').fill('desktop-real-mqtt-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('desktop-real-mqtt-' + prefix);
 record('browser-real-broker-auth-subscribe-publish-receive');
 await page.screenshot({ path: join(evidence, '40-mqtt-connected.png'), fullPage: true, mask: [panel.locator('#mqtt-password'), panel.locator('#mqtt-mqttToken')] });
 stage = 'mqtt-device-protocol';
 mqttProbe = await createMqttProbe(mqttBroker);
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：未连接' })).toBeVisible();
 await panel.getByRole('button', { name: '按注册包生成主题', exact: true }).click();
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 3 个主题', { exact: true })).toBeVisible();
 await panel.getByRole('checkbox', { name: '原始消息（不封装设备指令）' }).uncheck();
 await panel.locator('#mqtt-payload').fill('55 AA AA AA AA 91 CF');
 const clientId = await panel.locator('#mqtt-clientId').inputValue();
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect.poll(() => mqttProbe.received).toContainEqual({ token: deviceToken, cmd: '55 AA AA AA AA 91 CF', cmdpara: '', clientid: clientId });
 await mqttProbe.publish('out', { regpacket: mqttBroker.registration, redata: '55 AA AA AA AA 82 01 01' });
 await mqttProbe.publish('out', { regpacket: mqttBroker.registration, redata: '55 AA AA AA AA 84 AC 01' });
 await mqttProbe.publish('will', { regpacket: mqttBroker.registration, redata: 'online' });
 await mqttProbe.publish('dht', { regpacket: mqttBroker.registration, temperature: 23.5, humidity: 60, runsec: 42 });
 const devicePanel = panel.getByRole('heading', { name: '设备状态', exact: true }).locator('..');
 await expect(devicePanel).toContainText(/1 路：\s*开/);
 await expect(devicePanel).toContainText('在线');
 await expect(devicePanel).toContainText('23.5');
 await expect(devicePanel).toContainText('60');
 await expect(devicePanel).toContainText('42');
 record('real-device-command-envelope-relay-ac-online-sensor-status');
 for (const mode of ['light', 'dark']) {
   if (((await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')) !== (mode === 'dark')) await page.getByRole('button', { name: mode, exact: true }).click();
   await expect.poll(async () => (await page.locator('html').getAttribute('class') ?? '').split(/\s+/).includes('dark')).toBe(mode === 'dark');
   await page.mouse.move(240, 100);
   await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
   await page.screenshot({ path: join(evidence, '40-mqtt-device-' + mode + '.png'), fullPage: true, mask: [panel.locator('#mqtt-password'), panel.locator('#mqtt-mqttToken')] });
 }
 record('desktop-device-state-light-dark-no-horizontal-overflow');
 await mqttProbe.destroy(); mqttProbe = undefined;
 await panel.getByRole('button', { name: '取消订阅', exact: true }).click();
 await panel.locator('#mqtt-topics').fill(topic);
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 1 个主题', { exact: true })).toBeVisible();
 await panel.locator('#mqtt-publish-topic').fill(topic);
 await panel.getByRole('checkbox', { name: '原始消息（不封装设备指令）' }).check();
 await panel.locator('#mqtt-payload').fill('credentials-' + deviceToken);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('[已隐藏]');
 await expect(panel.getByLabel('接收消息内容')).not.toContainText(deviceToken);
 record('real-echo-message-log-redacts-device-token');
 await panel.locator('#mqtt-payload').fill('post-redaction-probe');
 stage = 'mqtt-real-broker-reconnect';
 await mqttBroker.stop();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：重连中' })).toBeVisible();
 await mqttBroker.start();
 // 默认重连间隔为 5 秒，断言截止时间必须覆盖 broker 启动和下一次重连。
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible({ timeout: 30000 });
 await panel.locator('#mqtt-payload').fill('reconnected-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('reconnected-' + prefix);
 record('real-broker-restart-resubscribes-and-receives');
 stage = 'mqtt-unsubscribe-disconnect';
 await panel.getByRole('button', { name: '取消订阅', exact: true }).click();
 await expect(panel.getByText('已订阅 0 个主题', { exact: true })).toBeVisible();
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：未连接' })).toBeVisible();
 await expect(panel.locator('#mqtt-host')).toBeEnabled();
 await assertSocketsClosed([mqttBroker.url]);
 record('browser-unsubscribe-and-explicit-disconnect');
 stage = 'mqtt-topic-acl-delivery-isolation';
 const forbiddenPrefix = mqttBroker.prefix + '-denied';
 await panel.locator('#mqtt-topics').fill(topic + '\n' + forbiddenPrefix + '/into');
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 2 个主题', { exact: true })).toBeVisible();
 // 此 broker 对 MQTT 3.1.1 订阅返回成功，在投递时按用户 ACL 过滤。
 mqttProbe = await createMqttProbe({ ...mqttBroker, prefix: forbiddenPrefix, username: mqttBroker.probeUsername, password: mqttBroker.probePassword });
 const forbiddenPayload = { proof: 'foreign-user-message-' + prefix };
 await mqttProbe.publish('into', forbiddenPayload);
 await expect.poll(() => mqttProbe.received).toContainEqual(forbiddenPayload);
 // 等到允许主题的后续消息到达，作为真实 broker 已处理前一条消息的屏障。
 await panel.locator('#mqtt-publish-topic').fill(topic);
 await panel.locator('#mqtt-payload').fill('authorized-after-acl-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('authorized-after-acl-' + prefix);
 await expect(panel.getByLabel('接收消息内容')).not.toContainText(forbiddenPayload.proof);
 await mqttProbe.destroy(); mqttProbe = undefined;
 await panel.getByRole('button', { name: '取消订阅', exact: true }).click();
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await assertSocketsClosed([mqttBroker.url]);
 record('real-broker-acl-isolates-foreign-user-messages-with-authorized-control');
 stage = 'mqtt-invalid-authentication';
 await panel.locator('#mqtt-password').fill('invalid-' + prefix);
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('alert')).toContainText('MQTT 连接或操作失败');
 await expect(panel.locator('#mqtt-password')).toHaveValue('invalid-' + prefix);
 await panel.getByRole('button', { name: '断开连接', exact: true }).click();
 await assertSocketsClosed([mqttBroker.url]);
 record('real-broker-refuses-wrong-password-draft-remains-disconnect-stops-retry');
 stage = 'mqtt-switch-broker';
 secondMqttBroker = await createMqttBroker(runtime, native, secret);
 for (const [field, value] of Object.entries({ port: String(secondMqttBroker.port), username: secondMqttBroker.username, password: secondMqttBroker.password, repacket: secondMqttBroker.registration })) await panel.locator('#mqtt-' + field).fill(value);
 const secondTopic = secondMqttBroker.prefix + '/probe';
 await panel.locator('#mqtt-topics').fill(secondTopic);
 await panel.locator('#mqtt-publish-topic').fill(secondTopic);
 await panel.getByRole('button', { name: /^连\s*接$/ }).click();
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：已连接' })).toBeVisible();
 await panel.getByRole('button', { name: /^订\s*阅$/ }).click();
 await expect(panel.getByText('已订阅 1 个主题', { exact: true })).toBeVisible();
 await panel.locator('#mqtt-payload').fill('second-broker-' + prefix);
 await panel.getByRole('button', { name: '发布消息', exact: true }).click();
 await expect(panel.getByLabel('接收消息内容')).toContainText('second-broker-' + prefix);
 await expect(panel.getByLabel('接收消息内容')).not.toContainText('reconnected-' + prefix);
 await assertSocketsClosed([mqttBroker.url]);
 record('switch-to-second-real-broker-old-connection-closed');
 stage = 'mqtt-same-document-leave';
 await page.evaluate(() => { location.hash = '/platform/cache'; });
 await expect(page.locator('.cache-page')).toBeVisible();
 await assertSocketsClosed([mqttBroker.url, secondMqttBroker.url]);
 await page.goBack();
 await expect(panel).toBeVisible();
 for (const field of ['password', 'username', 'mqttToken']) await expect(panel.locator('#mqtt-' + field)).toHaveValue('');
 await expect(panel.getByRole('status').filter({ hasText: '连接状态：未连接' })).toBeVisible();
 await expect(panel.getByText('已订阅 0 个主题', { exact: true })).toBeVisible();
 await expect(panel.getByLabel('接收消息内容')).not.toContainText('second-broker-' + prefix);
 record('same-document-leave-closes-sockets-clears-credentials-and-messages');
 assert.deepEqual(errors, []);
}
async function cleanupFixtures() {
 const failures = [];
 for (const id of mqttMenuIds) {
  try { await api(admin, 'sysMenu/delete', { id }); } catch (error) { failures.push(clean(error.message)); }
 }
 try {
  for (const id of mqttMenuIds) for (const [table, field] of [['sysmenu','id'],['systenantmenu','menuid'],['sysrolemenu','menuid'],['sysusermenu','menuid']]) assert.equal(await sql(`SELECT count(*) FROM ${table} WHERE ${field}=${id}`), '0');
  if (mqttMenuDigest) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t"), mqttMenuDigest);
 } catch (error) { failures.push(clean(error.message)); }
 report.fixtureRecordsRemoved = failures.length === 0;
 assert.deepEqual(failures, []);
}
async function cleanupMqttBroker() {
 const results = await Promise.allSettled([mqttProbe, mqttBroker, secondMqttBroker].filter(Boolean).map(resource => resource.destroy()));
 const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
 if (errors.length) throw new AggregateError(errors, 'MQTT broker cleanup failed');
 report.brokerRemoved = true;
}
