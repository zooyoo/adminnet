async function ownedRow(session, name) {
  const data = await api(session, 'sysPlugin/page', { page: 1, pageSize: 100, name });
  const found = data.items.find(item => item.name === name); assert.ok(found); return found;
}
async function runPermission() {
  const editor = await createTenant('editor'), other = await createTenant('other'), reader = await createTenant('reader'), denied = await createTenant('denied');
  await grant(reader, ['page']); await grant(denied, []);
  const draft = { name: prefix + '_tenant', csharpCode: code('tenant34'), orderNo: 100, status: 2 };
  await api(editor.session, 'sysPlugin/add', draft);
  const own = await ownedRow(editor.session, draft.name);
  assert.equal(String(own.tenantId), editor.id);
  const before = await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id);
  const foreign = await api(other.session, 'sysPlugin/page', { page: 1, pageSize: 100, name: draft.name, tenantId: editor.id });
  assert.equal(foreign.items.length, 0);
  for (const [action, body] of [['update', { ...own, name: prefix + '_stolen' }], ['delete', { id: own.id }], ['add', { ...draft, name: prefix + '_cross', tenantId: editor.id }]]) await api(other.session, 'sysPlugin/' + action, body, 'POST', true);
  await api(editor.session, 'sysPlugin/update', { ...own, tenantId: other.id }, 'POST', true);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id), before);
  record('granted-cross-tenant-page-update-delete-add-and-reparent-denied');
  const endpoints = [['page', { page: 1, pageSize: 20 }], ['add', draft], ['update', own], ['delete', { id: own.id }], ['compileAssembly?assemblyName=' + prefix + '_denied', code('denied')], ['removeAssembly/' + encodeURIComponent(own.assemblyName), {}]];
  for (const session of [undefined, denied.session]) for (const [action, body] of endpoints) await api(session, 'sysPlugin/' + action, body, 'POST', 'auth');
  for (const [action, body] of endpoints.filter(([action]) => action !== 'page')) await api(reader.session, 'sysPlugin/' + action, body, 'POST', 'auth');
  const readerPage = await api(reader.session, 'sysPlugin/page', { page: 1, pageSize: 20 }); assert.equal(readerPage.total, 0);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id), before);
  record('anonymous-ungranted-readonly-crud-and-direct-endpoint-denials');
  const assemblyName = prefix + '_temporary';
  const compiled = await api(admin, 'sysPlugin/compileAssembly?assemblyName=' + assemblyName, code('temporary34'));
  assert.equal(compiled, assemblyName); await callPlugin('temporary34');
  await api(admin, 'sysPlugin/compileAssembly?assemblyName=' + assemblyName, code('conflict'), 'POST', true);
  await callPlugin('temporary34');
  await api(admin, 'sysPlugin/removeAssembly/Admin.NET.Core', {}, 'POST', true);
  await callPlugin('temporary34');
  await api(admin, 'sysPlugin/removeAssembly/' + assemblyName, {}); await callPlugin(null);
  await api(admin, 'sysPlugin/removeAssembly/' + assemblyName, {}, 'POST', true);
  await api(admin, 'sysPlugin/compileAssembly?assemblyName=' + encodeURIComponent(own.assemblyName), code('reserved'), 'POST', true);
  record('direct-compile-execute-conflict-host-protection-remove-and-disabled-name-reservation');
  for (const action of ['compileAssembly', 'removeAssembly']) {
    const permission = 'sysPlugin:' + action;
    if (await sql('SELECT count(*) FROM sysmenu WHERE permission=' + quote(permission)) === '0') {
      await api(admin, 'sysMenu/add', { title: prefix + '_direct_' + action, type: 3, pid: 0, permission, status: 1, tenantId: 0 });
    }
  }
  for (const tenant of [editor, other]) await grant(tenant, ['page', 'add', 'update', 'delete', 'compileAssembly', 'removeAssembly']);
  const tenantAssembly = prefix + '_owned_temporary';
  assert.equal(await api(editor.session, 'sysPlugin/compileAssembly?assemblyName=' + tenantAssembly, code('owned34')), tenantAssembly);
  await callPlugin('owned34');
  await api(other.session, 'sysPlugin/removeAssembly/' + tenantAssembly, {}, 'POST', true);
  await callPlugin('owned34');
  await api(other.session, 'sysPlugin/removeAssembly/' + encodeURIComponent(own.assemblyName), {}, 'POST', true);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + own.id), before);
  await api(editor.session, 'sysPlugin/removeAssembly/' + tenantAssembly, {}); await callPlugin(null);
  record('explicitly-granted-direct-tenant-compile-foreign-removal-denied-owner-removal-succeeds');
}
