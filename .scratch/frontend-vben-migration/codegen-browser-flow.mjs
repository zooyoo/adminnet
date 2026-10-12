const codegenMenuIds = [], codegenIds = [];
const optionKeys = ['columnComment','effectType','dictTypeCode','queryType','whetherTable','whetherAddUpdate','whetherImport','whetherRequired','whetherSortable','whetherQuery','whetherRetract','orderNo','fkConfigId','fkTableName','fkEntityName','fkLinkColumnName','fkColumnNetType','fkDisplayColumnList','pidColumn'];
let codegenMenuDigest, codegenDataDigest, codegenPrintDigest, triggerActive = false;
const triggerName = 'cg42_' + prefix.slice(4);
async function codegenDigest() {
 return sql("SELECT md5(coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY id) FROM syscodegen t), '') || '#' || coalesce((SELECT string_agg(row_to_json(t)::text, '|' ORDER BY id) FROM syscodegenconfig t), ''))");
}
async function fieldsFor(id) { return api(admin, 'sysCodeGenConfig/list?codeGenId=' + id, undefined, 'GET'); }
function optionsOnly(rows) { return rows.map(row => Object.fromEntries(['id','codeGenId','columnName','propertyName',...optionKeys].map(key => [key,row[key] ?? null]))).sort((a,b) => String(a.id).localeCompare(String(b.id))); }
function immutableOnly(rows) { return rows.map(row => Object.fromEntries(['id','codeGenId','columnName','propertyName','columnLength','columnKey','whetherCommon','dataType','defaultValue','netType'].map(key => [key,row[key] ?? null]))).sort((a,b) => String(a.id).localeCompare(String(b.id))); }
async function removeFailureTrigger() {
 if (!triggerActive) return;
 await sql('DROP TRIGGER IF EXISTS ' + triggerName + ' ON syscodegenconfig; DROP FUNCTION IF EXISTS ' + triggerName + '()');
 triggerActive = false;
}
async function runCodegenBrowser() {
 stage = 'codegen-real-fixtures';
 codegenMenuDigest = await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t");
 codegenDataDigest = await codegenDigest();
 const tenantId = await sql('SELECT id FROM systenant ORDER BY id LIMIT 1');
 codegenPrintDigest=await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysprint t");
 const printName=prefix+'_print';
 await api(admin,'sysPrint/add',{tenantId,name:printName,printType:1,status:1,template:JSON.stringify({basePdf:{width:210,height:297,padding:[12,12,12,12]},schemas:[[]]}),printDataDemo:'{}'});
 const route = '/' + prefix + '_codegen';
 const menuId = await api(admin, 'sysMenu/add', { tenantId, pid: 0, type: 2, title: '生成配置隔离验收', name: prefix + '_codegen', path: route, component: '/system/codeGen/index', status: 1 });
 assert.match(String(menuId), /^[1-9]\d*$/); codegenMenuIds.push(String(menuId)); report.menuIds = [...codegenMenuIds];
 assert.ok(JSON.stringify(await api(admin, 'sysMenu/vbenMenuTree', undefined, 'GET')).includes(route));
 const databases = await api(admin, 'sysCodeGen/databaseList', undefined, 'GET');
 for (const db of databases) { secret(db.connectionString); }
 const database = databases.find(db => String(db.dbType) === 'PostgreSQL' || String(db.dbType) === '4') ?? databases[0];
 assert.ok(database, '隔离 PostgreSQL 数据库可供选择');
 const configId = String(database.configId);
 const tables = await api(admin, 'sysCodeGen/tableList/' + encodeURIComponent(configId), undefined, 'GET');
 const org = tables.find(table => table.entityName === 'SysOrg'); assert.ok(org, '真实 SysOrg 实体与数据库表存在');
 const dictionaries = await api(admin, 'sysDictType/list', undefined, 'GET');
 const dict = dictionaries.find(row => row.code && !row.code.endsWith('Enum')); assert.ok(dict);
 const effects = await api(admin, 'sysDictData/dataList/code_gen_effect_type', undefined, 'GET');
 const queries = await api(admin, 'sysDictData/dataList/code_gen_query_type', undefined, 'GET');
 const printTypes=await api(admin,'sysDictData/dataList/code_gen_print_type',undefined,'GET');
 const printLabel=value=>printTypes.find(row=>String(row.value)===value)?.label??value;
 const effectLabel = value => effects.find(row => String(row.value) === value)?.label ?? value;
 const queryLabel = value => queries.find(row => String(row.value) === value)?.label ?? value;
 const author = prefix + '_author', busName = prefix + '_业务';
 proxy = await startProductionProxy(join(root, 'Web/dist'), base);
 browser = await chromium.launch({ channel: 'msedge', headless: true });
 page = await browser.newPage({ viewport: { width: 1680, height: 1100 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(20000);
 const errors = []; page.on('pageerror', error => errors.push(clean(error.message)));
 page.on('request', request => { const token = request.headers().authorization; if (token) secret(token.replace(/^Bearer /u,'')); });
 page.on('response', response => { for (const name of ['access-token','x-access-token']) secret(response.headers()[name]); });
 const isApi = (path, method = 'POST') => response => new URL(response.url()).pathname === '/prod-api/api/' + path && response.request().method() === method;
 await page.goto(proxy.baseUrl + '/#/login?token=' + encodeURIComponent(admin.accessToken) + '&redirect=' + encodeURIComponent(route));
 const panel = page.locator('.codegen-page'); await expect(panel).toBeVisible();
 await expect(panel.getByRole('button', { name: '新增生成配置', exact: true })).toBeEnabled();
 assert.equal(await page.locator('script[src*="/@vite/client"]').count(), 0);
 record('production-real-login-codegen-dynamic-menu-postgresql');
 const dialog = () => page.getByRole('dialog').last();
 async function choose(scope, name, text) {
  const namedControl=scope.getByRole('combobox',{name,exact:true});
  const controlId=await namedControl.getAttribute('id'); assert.ok(controlId);
  const control=page.locator('[id="'+controlId+'"]');
  await control.click(); await expect(control).toHaveAttribute('aria-expanded','true');
  const listId=await control.getAttribute('aria-controls'); assert.ok(listId,'Select 必须关联自己的选项列表');
  const popup=page.locator('.ant-select-dropdown:visible').filter({has:page.locator('[id="'+listId+'"]')});
  await expect(popup).toBeVisible();
  const escaped=text.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&');
  const labelPattern=new RegExp(text.startsWith('— ')?escaped+'$':'^'+escaped,'u');
  const candidates=popup.locator('.ant-select-item-option').filter({hasText:labelPattern});
  if (!(await candidates.count()) && await control.isEditable()) await control.fill(text.replace(/^—\s*|\s*\[.*$/gu,'').trim());
  await expect(candidates).toHaveCount(1); await candidates.click();
  // 多选不会自动关闭；点击当前弹窗标题，随后等待对应弹层真正结束。
  if ((await control.getAttribute('aria-expanded'))==='true') await page.getByRole('dialog').last().locator('.ant-modal-title').click();
  await expect(control).toHaveAttribute('aria-expanded','false'); await expect(popup).toHaveCount(0);
 }
 async function responseResult(path, action, method = 'POST') {
  const [response] = await Promise.all([page.waitForResponse(isApi(path,method)), action()]);
  assert.equal(response.status(),200); const payload = await response.json(); assert.equal(payload.code,200,clean(payload.message)); return payload.result;
 }
 stage = 'codegen-main-editor-validation';
 await panel.getByRole('button', { name: '新增生成配置', exact: true }).click();
 await dialog().getByRole('button', { name: '保存生成配置', exact: true }).click();
 await expect(dialog().getByRole('alert')).toContainText('数据库和实体');
 await choose(dialog(),'数据库',database.dbNickName ?? configId);
 await choose(dialog(),'实体','— SysOrg');
 await dialog().getByRole('textbox', { name: '业务名称', exact: true }).fill(busName);
 await dialog().getByRole('textbox', { name: '作者', exact: true }).fill(author);
 await dialog().getByRole('textbox', { name: '菜单图标', exact: true }).fill('ele-Menu');
 await dialog().getByRole('textbox', { name: '菜单页面目录', exact: true }).fill(prefix + '_page');
 await choose(dialog(),'打印类型',printLabel('custom'));
 await dialog().getByRole('button',{name:'保存生成配置',exact:true}).click();
 await expect(dialog().getByRole('alert')).toContainText('自定义打印模板');
 await choose(dialog(),'打印模板名称',printName);
 await dialog().getByRole('button', { name: '添加唯一约束', exact: true }).click();
 await choose(dialog(),'唯一约束 1 字段','Name [');
 await dialog().getByRole('textbox', { name: '唯一约束 1 提示', exact: true }).fill('同名不可重复');
 const connection = await dialog().getByRole('textbox',{ name:'数据库地址', exact:true }).inputValue();
 assert.ok(!/(?:password|pwd)\s*=\s*(?!\[已隐藏\])/iu.test(connection));
 await responseResult('sysCodeGen/add', () => dialog().getByRole('button',{name:'保存生成配置',exact:true}).click());
 const added = (await api(admin,'sysCodeGen/page',{ page:1,pageSize:100,busName })).items.find(row => row.busName === busName); assert.ok(added);
 const codeGenId = String(added.id); assert.match(codeGenId,/^[1-9]\d*$/u); codegenIds.push(codeGenId); report.codeGenIds = [...codegenIds];
 await expect(panel.getByText(busName,{exact:true})).toBeVisible();
 const detail = await api(admin,'sysCodeGen/detail?id=' + codeGenId,undefined,'GET');
 assert.equal(detail.authorName,author); assert.equal(detail.pagePath,prefix+'_page');
 assert.deepEqual(detail.tableUniqueList?.[0]?.columns,['Name']);
 assert.equal(detail.tableUniqueList?.[0]?.message,'同名不可重复');
 assert.equal(detail.printType,'custom'); assert.equal(detail.printName,printName);
 record('main-config-all-options-unique-menu-save-real-reload');
 const configRow = () => panel.locator('tbody tr').filter({hasText:busName});
 async function openFields() {
  await configRow().getByRole('button',{name:'字段配置',exact:true}).click();
  await expect(dialog().getByRole('status')).toContainText('字段配置已加载');
  await expect(dialog().getByRole('textbox',{name:'Name 描述',exact:true})).toBeVisible();
 }
 async function closeFields() { await dialog().getByRole('button',{ name:/^(?:放弃更改并关闭|关闭字段配置)$/u }).click(); await expect(page.getByRole('dialog')).toHaveCount(0); }
 async function saveFields() { await responseResult('sysCodeGenConfig/update', () => dialog().getByRole('button',{name:'保存字段配置',exact:true}).click()); await expect(dialog().getByRole('status')).toContainText('字段配置已加载'); }
 const before = await fieldsFor(codeGenId); const baseMetadata = immutableOnly(before);
 assert.ok(before.some(row => row.propertyName==='Name') && before.some(row => row.propertyName==='Pid') && before.some(row => row.propertyName==='Code'));
 stage = 'codegen-editable-fields'; await openFields();
 await expect(dialog().getByRole('combobox',{name:'Id 作用类型',exact:true})).toBeDisabled();
 await expect(dialog().getByRole('checkbox',{name:'Id 增改',exact:true})).toBeDisabled();
 for (const title of ['字段信息','生成选项','查询设置']) await expect(dialog().getByRole('columnheader',{name:title,exact:true})).toBeVisible();
 await dialog().getByRole('textbox',{name:'Name 描述',exact:true}).fill(prefix+'_名称');
 for (const flag of ['显示','增改','导入','必填','可排序','查询','查询折叠']) await dialog().getByRole('checkbox',{name:'Name '+flag,exact:true}).setChecked(false);
 await dialog().getByRole('checkbox',{name:'Name 查询',exact:true}).check();
 await dialog().getByRole('checkbox',{name:'Name 查询折叠',exact:true}).check();
 await dialog().getByRole('checkbox',{name:'Name 可排序',exact:true}).check();
 await choose(dialog(),'Name 查询方式',queryLabel('=='));
 await dialog().getByRole('spinbutton',{name:'Name 排序',exact:true}).fill('765');
 await choose(dialog(),'Code 作用类型',effectLabel('DictSelector'));
 await choose(dialog(),'Code 字典',dict.name ?? dict.code);
 await choose(dialog(),'Pid 作用类型',effectLabel('ApiTreeSelector'));
 await expect(dialog()).toHaveAccessibleName('树选择器配置');
 await choose(dialog(),'关联数据库',database.dbNickName ?? configId);
 await choose(dialog(),'关联表',org.tableName + ' [');
 await choose(dialog(),'显示字段','Name [');
 await choose(dialog(),'值字段','Id [');
 await choose(dialog(),'父级字段','Pid [');
 await dialog().getByRole('button',{name:'应用关联配置',exact:true}).click();
 await saveFields();
 const saved = await fieldsFor(codeGenId); assert.deepEqual(immutableOnly(saved),baseMetadata);
 const nameField = saved.find(row=>row.propertyName==='Name'), codeField=saved.find(row=>row.propertyName==='Code'), pidField=saved.find(row=>row.propertyName==='Pid');
 assert.equal(nameField.columnComment,prefix+'_名称'); assert.equal(nameField.orderNo,765);
 assert.deepEqual(['whetherTable','whetherAddUpdate','whetherImport','whetherRequired'].map(key=>nameField[key]),['N','N','N','N']);
 assert.deepEqual(['whetherSortable','whetherQuery','whetherRetract'].map(key=>nameField[key]),['Y','Y','Y']);
 assert.equal(nameField.queryType,'=='); assert.equal(codeField.effectType,'DictSelector'); assert.equal(codeField.dictTypeCode,dict.code);
 assert.equal(pidField.effectType,'ApiTreeSelector'); assert.equal(pidField.fkEntityName,'SysOrg'); assert.equal(pidField.fkLinkColumnName,'Id'); assert.deepEqual(pidField.fkDisplayColumnList,['Name']); assert.equal(pidField.pidColumn,'Pid');
 assert.equal(await sql('SELECT count(*) FROM syscodegenconfig WHERE codegenid=' + codeGenId + ' AND propertyname=\'Name\' AND columncomment=' + quote(prefix+'_名称') + " AND orderno=765 AND whetherquery='Y' AND whetherretract='Y'"),'1');
 record('editable-all-field-flags-dictionary-tree-property-names-persisted');
 stage='codegen-table-column-settings';
 await dialog().getByRole('button',{name:'列设置',exact:true}).click();
 const popover=page.locator('.ant-popover:visible');
 await popover.getByRole('checkbox',{name:'数据类型',exact:true}).uncheck();
 await expect(dialog().getByRole('columnheader',{name:'数据类型',exact:true})).toHaveCount(0);
 await popover.getByRole('button',{name:'上移作用类型',exact:true}).click();
 await choose(popover,'固定排序','不固定');
 await popover.getByRole('checkbox',{name:'数据类型',exact:true}).check();
 await choose(popover,'固定排序','固定右侧');
 await dialog().getByRole('status').click();
 const headerKeys = await dialog().locator('thead tr').last().locator('th').allTextContents();
 assert.ok(headerKeys.findIndex(text=>text.includes('作用类型'))<headerKeys.findIndex(text=>text.includes('数据类型')));
 const scroller=dialog().locator('.ant-table-body').first();
 await scroller.evaluate(element=>{element.scrollLeft=element.scrollWidth;});
 const propertyCell=dialog().locator('tbody tr').filter({has:page.getByText('Name',{exact:true})}).locator('td').first();
 await expect(propertyCell).toBeVisible();
 assert.equal(await propertyCell.evaluate(element=>getComputedStyle(element).position),'sticky');
 await scroller.evaluate(element=>{element.scrollLeft=0;});
 for (const mode of ['light','dark']) {
  await closeFields();
  if ((await page.locator('html').evaluate(element=>element.classList.contains('dark'))) !== (mode==='dark')) await page.getByRole('button',{name:mode,exact:true}).click();
  await expect.poll(()=>page.locator('html').evaluate(element=>element.classList.contains('dark'))).toBe(mode==='dark');
  await openFields();
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth));
  await expect.poll(()=>dialog().evaluate(element=>{
   for(let parent=element;parent && parent!==document.body;parent=parent.parentElement){if(parent.getAnimations().some(animation=>animation.playState==='running'))return false;}
   return element.getAnimations({subtree:true}).every(animation=>animation.playState!=='running');
  })).toBe(true);
  await page.screenshot({path:join(evidence,'42-codegen-fields-'+mode+'.png'),fullPage:true,animations:'disabled',mask:[page.getByRole('textbox',{name:'数据库地址',exact:true})]});
 }
 record('public-editable-table-grouped-headers-sticky-columns-settings-light-dark-desktop');
 await closeFields(); await openFields();
 await expect(dialog().getByRole('textbox',{name:'Name 描述',exact:true})).toHaveValue(prefix+'_名称');
 await expect(dialog().getByRole('spinbutton',{name:'Name 排序',exact:true})).toHaveValue('765');
 await closeFields();
 stage='codegen-sync-keeps-options';
 const beforeSync=await fieldsFor(codeGenId);
 await configRow().getByRole('button',{name:'同步字段',exact:true}).click();
 await responseResult('sysCodeGen/syncField',()=>dialog().getByRole('button',{name:'同步字段',exact:true}).click());
 const afterSync=await fieldsFor(codeGenId); assert.deepEqual(optionsOnly(afterSync),optionsOnly(beforeSync)); assert.deepEqual(immutableOnly(afterSync),immutableOnly(beforeSync));
 record('real-field-sync-keeps-all-user-options-and-existing-ids');
 stage='codegen-server-rejects-invalid-batches';
 const baseline=await codegenDigest();
 const invalidBatches=[
  saved.slice(1),
  [...saved,saved[0]],
  saved.map((row,index)=>index===0?{...row,codeGenId:codeGenId+'1'}:row),
  saved.map((row,index)=>index===saved.length-1?{...row,propertyName:row.propertyName+'_tampered'}:{...row,columnComment:'should-rollback'}),
  saved.map((row,index)=>index===saved.length-1?{...row,effectType:'invalid-expression'}:{...row,columnComment:'should-rollback'}),
 ];
 for(const batch of invalidBatches){await api(admin,'sysCodeGenConfig/update',batch,'POST',true);assert.equal(await codegenDigest(),baseline);}
 await api(admin,'sysCodeGen/syncField',{...detail,tableName:'MissingEntity_'+prefix},'POST',true); assert.equal(await codegenDigest(),baseline);
 await api(admin,'sysCodeGen/add',{...detail,id:undefined,tableName:'MissingEntity_'+prefix,busName:prefix+'_invalid'},'POST',true); assert.equal(await codegenDigest(),baseline);
 await api(undefined,'sysCodeGenConfig/update',saved,'POST','auth'); assert.equal(await codegenDigest(),baseline);
 record('real-api-rejects-incomplete-duplicate-mixed-stale-invalid-and-anonymous-without-mutation',{cases:8});
 stage='codegen-transaction-rollback-draft-retry'; await openFields();
 const failureId=String(saved.at(-1).id); assert.match(failureId,/^[1-9]\d*$/u);
 await sql('CREATE FUNCTION '+triggerName+"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id="+failureId+" THEN RAISE EXCEPTION 'isolated codegen42 update rejection'; END IF; RETURN NEW; END $$; CREATE TRIGGER "+triggerName+' BEFORE UPDATE ON syscodegenconfig FOR EACH ROW EXECUTE FUNCTION '+triggerName+'()'); triggerActive=true;
 const beforeFailure=await codegenDigest();
 await dialog().getByRole('textbox',{name:'Name 描述',exact:true}).fill(prefix+'_失败后保留');
 const [failed]=await Promise.all([page.waitForResponse(isApi('sysCodeGenConfig/update')),dialog().getByRole('button',{name:'保存字段配置',exact:true}).click()]);
 assert.notEqual((await failed.json()).code,200);
 await expect(dialog().getByRole('alert')).toContainText('草稿已保留');
 await expect(dialog().getByRole('textbox',{name:'Name 描述',exact:true})).toHaveValue(prefix+'_失败后保留');
 await expect(dialog().getByRole('button',{name:'保存字段配置',exact:true})).toBeEnabled();
 assert.equal(await codegenDigest(),beforeFailure,'后面的 SQL 更新失败时前面的更新一并回滚');
 await page.screenshot({path:join(evidence,'42-codegen-real-save-failure.png'),fullPage:true});
 await removeFailureTrigger(); await saveFields();
 assert.equal((await fieldsFor(codeGenId)).find(row=>row.propertyName==='Name').columnComment,prefix+'_失败后保留');
 record('real-postgresql-last-update-failure-rolls-back-keeps-draft-and-retries');
 stage='codegen-cache-leave-clears-drafts';
 await dialog().getByRole('textbox',{name:'Name 描述',exact:true}).fill(prefix+'_未保存离页');
 await page.evaluate(()=>{location.hash='/platform/cache';}); await expect(panel).toHaveCount(0);
 await page.evaluate(value=>{location.hash=value;},route); await expect(panel).toBeVisible(); await expect(page.getByRole('dialog')).toHaveCount(0);
 await openFields(); await expect(dialog().getByRole('textbox',{name:'Name 描述',exact:true})).toHaveValue(prefix+'_失败后保留'); await closeFields();
 record('same-document-cached-page-leave-clears-unsaved-field-draft');
 stage='codegen-main-edit-rebuilds';
 const rebuildBefore=await fieldsFor(codeGenId);
 await configRow().getByRole('button',{name:'编辑并重建',exact:true}).click(); await expect(dialog().getByText('保存主配置会按实体重建字段并恢复默认值。',{exact:false})).toBeVisible();
 await expect(dialog().getByRole('textbox',{name:'作者',exact:true})).toHaveValue(author);
 await dialog().getByRole('textbox',{name:'作者',exact:true}).fill(author+'_updated');
 await responseResult('sysCodeGen/update',()=>dialog().getByRole('button',{name:'保存生成配置',exact:true}).click());
 const rebuilt=await fieldsFor(codeGenId); assert.ok(rebuilt.every(row=>!rebuildBefore.some(old=>String(old.id)===String(row.id))));
 assert.notEqual(rebuilt.find(row=>row.propertyName==='Name').columnComment,prefix+'_失败后保留');
 assert.equal((await api(admin,'sysCodeGen/detail?id='+codeGenId,undefined,'GET')).authorName,author+'_updated');
 record('main-editor-explicit-rebuild-refreshes-defaults');
  stage='codegen-copy-preserves-parameters-clears-entity';
 await configRow().getByRole('button',{name:'复制配置',exact:true}).click();
 await expect(dialog()).toHaveAccessibleName('复制生成配置');
 await expect(dialog().getByRole('textbox',{name:'作者',exact:true})).toHaveValue(author+'_updated');
 await expect(dialog().getByRole('textbox',{name:'业务名称',exact:true})).toHaveValue('');
 await expect(dialog().getByRole('combobox',{name:'实体',exact:true})).toHaveValue('');
 await expect(dialog().getByRole('combobox',{name:'唯一约束 1 字段',exact:true})).toHaveCount(0);
 await dialog().getByRole('button',{name:'保存生成配置',exact:true}).click();
 await expect(dialog().getByRole('alert')).toContainText('数据库和实体');
 const copyEntity=tables.find(table=>table.entityName==='SysNotice'); assert.ok(copyEntity);
 await choose(dialog(),'实体','— '+copyEntity.entityName);
 const copyBusName=prefix+'_copy'; await dialog().getByRole('textbox',{name:'业务名称',exact:true}).fill(copyBusName);
 await responseResult('sysCodeGen/add',()=>dialog().getByRole('button',{name:'保存生成配置',exact:true}).click());
 const copied=(await api(admin,'sysCodeGen/page',{page:1,pageSize:100,busName:copyBusName})).items.find(row=>row.busName===copyBusName); assert.ok(copied);
 codegenIds.push(String(copied.id)); report.codeGenIds=[...codegenIds];
 assert.notEqual(String(copied.id),codeGenId); assert.equal(copied.authorName,author+'_updated'); assert.equal(copied.tableName,'SysNotice'); assert.equal(copied.printType,'custom'); assert.equal(copied.printName,printName);
 assert.equal((await api(admin,'sysCodeGen/detail?id='+codeGenId,undefined,'GET')).tableName,'SysOrg');
 assert.ok((await fieldsFor(copied.id)).length>0);
 record('copy-config-preserves-generation-parameters-creates-new-entity-without-mutating-source');
 stage='codegen-browser-delete';
 await configRow().getByRole('button',{name:'删除配置',exact:true}).click(); await responseResult('sysCodeGen/delete',()=>dialog().getByRole('button',{name:'删除配置',exact:true}).click());
 await expect(panel.getByText(busName,{exact:true})).toHaveCount(0); assert.equal(await sql('SELECT count(*) FROM syscodegen WHERE id='+codeGenId),'0');assert.equal(await sql('SELECT count(*) FROM syscodegenconfig WHERE codegenid='+codeGenId),'0');
 assert.deepEqual(errors,[]); report.browserErrors=errors;
 record('browser-delete-removes-main-and-all-fields');
}
async function cleanupFixtures() {
 const prints=await api(admin,'sysPrint/page',{page:1,pageSize:100,name:prefix+'_print'});
 for(const row of prints.items.filter(row=>row.name===prefix+'_print')) await api(admin,'sysPrint/delete',{id:row.id});
 assert.equal(await sql('SELECT count(*) FROM sysprint WHERE name='+quote(prefix+'_print')),'0');
 if(codegenPrintDigest!==undefined) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysprint t"),codegenPrintDigest);
 await removeFailureTrigger();
 const leftovers=await api(admin,'sysCodeGen/page',{page:1,pageSize:100,busName:prefix});
 for(const row of leftovers.items.filter(row=>String(row.busName).startsWith(prefix))) if(!codegenIds.includes(String(row.id))) codegenIds.push(String(row.id));
 if(codegenIds.length) {
  const existing=await sql('SELECT coalesce(string_agg(id::text,\',\'),\'\') FROM syscodegen WHERE id IN ('+codegenIds.join(',')+')');
  if(existing) await api(admin,'sysCodeGen/delete',existing.split(',').map(id=>({id})));
  assert.equal(await sql('SELECT count(*) FROM syscodegen WHERE id IN ('+codegenIds.join(',')+')'),'0');
  assert.equal(await sql('SELECT count(*) FROM syscodegenconfig WHERE codegenid IN ('+codegenIds.join(',')+')'),'0');
 }
 if(codegenDataDigest!==undefined) assert.equal(await codegenDigest(),codegenDataDigest);
 if(codegenMenuIds.length) {
  for (const id of codegenMenuIds) await api(admin,'sysMenu/delete',{id});
  for(const table of ['sysmenu','systenantmenu','sysrolemenu','sysusermenu']) {
   const column=table==='sysmenu'?'id':'menuid'; assert.equal(await sql('SELECT count(*) FROM '+table+' WHERE '+column+' IN ('+codegenMenuIds.join(',')+')'),'0');
  }
 }
 if(codegenMenuDigest!==undefined) assert.equal(await sql("SELECT md5(coalesce(string_agg(row_to_json(t)::text, '|' ORDER BY id), '')) FROM sysmenu t"),codegenMenuDigest);
 report.fixtureRecordsRemoved=true;
 record('codegen-menu-config-field-trigger-postgresql-cleanup-restores-digests');
}
