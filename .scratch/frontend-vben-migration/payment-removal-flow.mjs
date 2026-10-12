// 支付移除验收只连接启动器校验的一次性 API，不访问微信支付服务。
async function verifyPaymentRemoval() {
  stage = 'payment-removed-swagger-and-endpoints';
  const response = await fetch(new URL('/swagger/Default/swagger.json', base), { signal: AbortSignal.timeout(30000) });
  assert.equal(response.status, 200);
  const document = await response.json();
  assert.ok(Object.keys(document.paths).length > 0);
  assert.ok(Object.keys(document.paths).every(path => !/sysWechatPay/i.test(path)));
  assert.ok(Object.keys(document.components.schemas).every(name => !/WechatPay|WechatRefund/i.test(name)));
  const paths = ['generateParametersForJsapiPay', 'listRefund', 'page', 'payCallBack', 'payInfoFromWechat/1', 'payInfo/1', 'payPartnerCallBack', 'payPartnerTransaction', 'payTransactionNative', 'payTransaction', 'refundDomestic', 'refundInfoFromWechat/1'];
  let count = 0;
  for (const path of paths) {
    for (const method of ['GET', 'POST']) {
      const removed = await fetch(new URL('/api/sysWechatPay/' + path, base), {
        method, headers: { Authorization: 'Bearer ' + admin.accessToken, 'Content-Type': 'application/json' },
        ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(30000),
      });
      assert.equal(removed.status, 404, method + ' ' + path); count++;
    }
  }
  record('payment-swagger-schemas-removed-and-twelve-paths-return-404', { requests: count });
  stage = 'payment-menu-seed-removal';
  for (const route of ['sysMenu/loginMenuTree', 'sysMenu/vbenMenuTree']) {
    const tree = await api(admin, route, undefined, 'GET');
    assert.ok(!/sysWechatPay|system\/weChatPay|platform\/wechatpay/i.test(JSON.stringify(tree)));
  }
  assert.equal(await sql('SELECT count(*) FROM sysmenu WHERE id IN (1300300150101,1300300150201,1300300150301,1300300150401,1300300150501,1300300150601)'), '0');
  record('fresh-database-has-no-payment-menu-or-buttons');
  await verifyLegacyPaymentMenus();
}

async function verifyLegacyPaymentMenus() {
  stage = 'legacy-payment-menu-filter';
  const ids = [];
  const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
  const digest = () => sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
  const before = await digest();
  async function add(suffix, overrides = {}) {
    const id = await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: prefix + suffix, name: prefix + suffix, path: '/' + prefix + suffix, component: '/system/weChatUser/index', status: 1, ...overrides });
    assert.match(String(id), /^[1-9]\d*$/); ids.push(String(id)); return id;
  }
  let primaryError;
  try {
    const retired = await add('_retired', { name: 'sysWechatPay', path: '/platform/wechatpay', component: '/system/weChatPay/index' });
    await add('_child', { pid: retired });
    await add('_path', { path: '/platform/wechatpay/' });
    await add('_component', { component: '/system/weChatPay/index' });
    const retained = await add('_retained');
    const fixtureDigest = await digest();
    for (const route of ['sysMenu/loginMenuTree', 'sysMenu/vbenMenuTree']) {
      const text = JSON.stringify(await api(admin, route, undefined, 'GET'));
      for (const suffix of ['_retired', '_child', '_path', '_component']) assert.ok(!text.includes(prefix + suffix), route + suffix);
      assert.ok(text.includes(prefix + '_retained'), '未下线菜单仍在树中');
    }
    assert.equal(await digest(), fixtureDigest, '读取登录树不得删除或修改旧菜单');
    assert.equal(await sql('SELECT count(*) FROM sysmenu WHERE id IN (' + ids.join(',') + ')'), '5');
    assert.ok(ids.includes(String(retained)));
    record('legacy-payment-menu-and-descendants-filtered-without-deleting-history');
  } catch (error) { primaryError = error; }
  const failures = [];
  for (const id of ids.reverse()) {
    try { await api(admin, 'sysMenu/delete', { id }); } catch (error) { failures.push(clean(error.message)); }
  }
  try {
    if (ids.length) {
      const values = ids.join(',');
      for (const [table, field] of [['sysmenu', 'id'], ['systenantmenu', 'menuid'], ['sysrolemenu', 'menuid'], ['sysusermenu', 'menuid']])
        assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + field + ' IN (' + values + ')'), '0');
    }
    assert.equal(await digest(), before);
  } catch (error) { failures.push(clean(error.message)); }
  report.paymentMenuFixturesRemoved = failures.length === 0;
  report.paymentMenuCleanupErrors = failures;
  persist();
  if (primaryError) throw primaryError;
  assert.deepEqual(failures, []);
}
