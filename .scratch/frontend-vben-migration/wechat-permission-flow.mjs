// 由验收生成器在同一隔离宿主内组合；先创建并验证真实授权，再断言数据归属。
async function grantWechat(fixture, actions) {
  actions.forEach(action => assert.ok(['page', 'add', 'update', 'delete'].includes(action)));
  const codes = actions.map(action => 'sysWechatUser:' + action);
  const menuIds = codes.length ? (await sql("SELECT id FROM sysmenu WHERE permission IN ('" + codes.join("','") + "') ORDER BY id")).split(/\r?\n/).filter(Boolean) : [];
  assert.equal(menuIds.length, codes.length, '每个微信管理动作都有实际菜单权限');
  await api(admin, 'sysTenant/grantMenu', { id: fixture.id, menuIdList: menuIds });
  fixture.session = await api(admin, 'sysTenant/goTenant', { id: fixture.id });
  secret(fixture.session.accessToken); secret(fixture.session.refreshToken);
  const info = await api(fixture.session, 'sysAuth/userInfo', undefined, 'GET');
  assert.notEqual(info.accountType, 999);
  codes.forEach(code => assert.ok(info.buttons.includes(code), '真实操作者拥有 ' + code));
}
async function createWechatTenant(suffix, actions) {
  const account = prefix + '_' + suffix;
  const fixture = { account, name: account }; fixtures.push(fixture);
  await api(admin, 'sysTenant/add', { name: account, adminAccount: account, tenantType: 0, status: 1, enableReg: 2 });
  const parts = (await sql("SELECT t.id || '|' || t.userid FROM systenant t JOIN sysuser u ON u.id=t.userid WHERE u.account='" + account + "'")).split('|');
  assert.equal(parts.length, 2); parts.forEach(value => assert.match(value, /^[1-9]\d*$/));
  [fixture.id, fixture.userId] = parts;
  await grantWechat(fixture, actions);
  return fixture;
}
async function runWechatPermissions() {
  stage = 'wechat-real-permission-and-tenant-matrix';
  const editor = await createWechatTenant('editor', ['page', 'add', 'update', 'delete']);
  const other = await createWechatTenant('other', ['page', 'add', 'update', 'delete']);
  const reader = await createWechatTenant('reader', ['page']);
  const denied = await createWechatTenant('denied', []);
  const snapshot = () => sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM syswechatuser t");
  async function refuse(session, action, input, kind = true) {
    const before = await snapshot(); await api(session, 'sysWechatUser/' + action, input, 'POST', kind);
    assert.equal(await snapshot(), before, '被拒请求不得修改任意微信资料');
  }
  const draft = { userId: editor.userId, platformType: 1, openId: prefix + '_own_open', nickName: prefix + '_own' };
  await api(editor.session, 'sysWechatUser/add', draft);
  const ownPage = await api(editor.session, 'sysWechatUser/page', { nickName: draft.nickName, page: 1, pageSize: 100 });
  assert.equal(ownPage.items.length, 1);
  const own = ownPage.items[0]; createdIds.add(String(own.id));
  assert.equal(String(own.tenantId), editor.id);
  await api(other.session, 'sysWechatUser/add', { ...draft, userId: other.userId, openId: prefix + '_foreign_open', nickName: prefix + '_foreign' });
  const foreign = (await api(other.session, 'sysWechatUser/page', { nickName: prefix + '_foreign', page: 1, pageSize: 100 })).items[0];
  assert.ok(foreign); createdIds.add(String(foreign.id));
  assert.equal((await api(editor.session, 'sysWechatUser/page', { nickName: prefix + '_foreign', page: 1, pageSize: 100 })).total, 0);
  for (const [action, input] of [['page', { page: 1, pageSize: 20, tenantId: other.id }], ['add', { ...draft, userId: other.userId }], ['add', { ...draft, userId: 0 }], ['update', { ...foreign, nickName: prefix + '_forged' }], ['update', { ...own, userId: other.userId }], ['delete', { id: foreign.id }]]) await refuse(editor.session, action, input);
  for (const session of [undefined, denied.session]) for (const [action, input] of [['page', { page: 1, pageSize: 20 }], ['add', draft], ['update', own], ['delete', { id: own.id }]]) await refuse(session, action, input, 'auth');
  for (const [action, input] of [['add', { ...draft, userId: reader.userId }], ['update', own], ['delete', { id: own.id }]]) await refuse(reader.session, action, input, 'auth');
  await api(editor.session, 'sysWechatUser/update', { ...own, city: '本租户合法更新' });
  assert.equal(await sql('SELECT city FROM syswechatuser WHERE id=' + own.id), '本租户合法更新');
  await api(editor.session, 'sysWechatUser/delete', { id: own.id });
  assert.equal(await sql('SELECT count(*) FROM syswechatuser WHERE id=' + own.id), '0');
  assert.equal((await api(reader.session, 'sysWechatUser/page', { page: 1, pageSize: 20 })).total, 0);
  record('real-authorized-own-crud-cross-tenant-anonymous-ungranted-and-readonly-refusals');
  stage = 'wechat-platform-pagination-and-validation';
  for (const platformType of [1, 2, 3, 4, 5]) {
    await api(editor.session, 'sysWechatUser/add', { ...draft, platformType, openId: prefix + '_platform_' + platformType, nickName: prefix + '_platform_' + platformType, sex: 0 });
    const filtered = await api(editor.session, 'sysWechatUser/page', { nickName: prefix + '_platform_', platformType, page: 1, pageSize: 20 });
    assert.equal(filtered.total, 1);
    assert.equal(filtered.items[0].platformType, platformType);
    createdIds.add(String(filtered.items[0].id));
  }
  const pagedIds = new Set();
  for (const pageNumber of [1, 2, 3]) {
    const result = await api(editor.session, 'sysWechatUser/page', { nickName: prefix + '_platform_', page: pageNumber, pageSize: 2 });
    assert.equal(result.total, 5);
    assert.equal(result.items.length, pageNumber === 3 ? 1 : 2);
    for (const item of result.items) { assert.ok(!pagedIds.has(String(item.id))); pagedIds.add(String(item.id)); }
  }
  assert.equal(pagedIds.size, 5);
  for (const change of [{ openId: '' }, { openId: 'x'.repeat(65) }, { platformType: 99 }, { sex: 3 }, { avatar: 'javascript:alert(1)' }, { mobile: '1'.repeat(17) }]) await refuse(editor.session, 'add', { ...draft, ...change });
  for (const input of [{ page: 0, pageSize: 20 }, { page: 1, pageSize: 201 }, { page: 1, pageSize: 20, platformType: 99 }]) await refuse(editor.session, 'page', input);
  record('real-platform-enums-filter-pagination-and-invalid-input-refusals');
  return { editor, other, reader, denied };
}

async function cleanupWechatTenants() {
  const failures = [];
  const attempt = async (label, work) => { try { return await work(); } catch (error) { failures.push(clean(label + ': ' + error.message)); } };
  // 新增接口失败也可能留下部分关联，按唯一账号恢复本次拥有的租户 ID。
  for (const fixture of fixtures) if (!fixture.id) await attempt('recover tenant', async () => {
    const value = await sql("SELECT DISTINCT t.id FROM systenant t WHERE t.userid IN (SELECT id FROM sysuser WHERE account=" + quote(fixture.account) + ") OR t.id IN (SELECT tenantid FROM sysorg WHERE name=" + quote(fixture.name) + ")");
    if (value) { assert.match(value, /^[1-9]\d*$/); fixture.id = value; }
  });
  const ids = fixtures.filter(item => item.id).map(item => item.id);
  ids.forEach(id => assert.match(id, /^[1-9]\d*$/));
  const predicate = ids.join(',') || '-1';
  const ownership = await attempt('snapshot associations', async () => {
    const roles = (await sql('SELECT id FROM sysrole WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean);
    const users = (await sql('SELECT id FROM sysuser WHERE tenantid IN (' + predicate + ')')).split(/\r?\n/).filter(Boolean);
    [...roles, ...users].forEach(id => assert.match(id, /^[1-9]\d*$/));
    return { roles: roles.join(',') || '-1', users: users.join(',') || '-1' };
  });
  for (const fixture of [...fixtures].reverse()) if (fixture.id) await attempt('remove tenant', async () => {
    if (Number(await sql('SELECT count(*) FROM systenant WHERE id=' + fixture.id))) await api(admin, 'sysTenant/delete', { id: fixture.id });
  });
  for (const table of ['systenant', 'sysuser', 'sysorg', 'sysrole', 'syspos', 'systenantmenu', 'systenantconfigdata']) await attempt('residue ' + table, async () => {
    assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + (table === 'systenant' ? 'id' : 'tenantid') + ' IN (' + predicate + ')'), '0');
  });
  if (ownership) for (const [table, column, set] of [['sysrolemenu','roleid',ownership.roles], ['sysuserrole','userid',ownership.users], ['sysuserrole','roleid',ownership.roles], ['sysuserextorg','userid',ownership.users], ['sysusermenu','userid',ownership.users], ['sysuserconfigdata','userid',ownership.users], ['sysroleorg','roleid',ownership.roles]]) await attempt('residue ' + table + ':' + column, async () => assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE ' + column + ' IN (' + set + ')'), '0'));
  await attempt('account residue', async () => assert.equal(await sql("SELECT count(*) FROM sysuser WHERE starts_with(account, '" + prefix + "')"), '0'));
  await attempt('organization residue', async () => assert.equal(await sql("SELECT count(*) FROM sysorg WHERE starts_with(name, '" + prefix + "')"), '0'));
  assert.deepEqual(failures, []);
  fixtures.length = 0;
  report.tenantFixturesRemoved = true;
}
