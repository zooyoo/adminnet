import fs from 'node:fs';
const dir = '.scratch/frontend-vben-migration/';
const source = fs.readFileSync(dir + 'run-template-browser-baseline.mjs', 'utf8').split('\n');
// 复用已核对的隔离、脱敏和进程清理 helper，不复用模板业务用例。
let text = source.slice(0, 46).join('\n') + '\n' + source.slice(180, 185).join('\n');
text = text.replaceAll('template-startup-runtime-', 'plugin-startup-runtime-').replaceAll('template-browser-baseline.json', 'plugin-service-baseline.json').replaceAll('template-startup-report.json', 'plugin-startup-report.json').replace('production-desktop-real-postgresql-template-management', 'real-postgresql-plugin-service-no-browser');
text = text.replace("const publicKey = readFileSync(join(root, 'Web/apps/web-antdv-next/.env'), 'utf8').match(/^VITE_SM_PUBLIC_KEY=(.+)$/m)[1].trim();", "const publicKey = getPublishedPublicKey();");
text += `
function getPublishedPublicKey() {
  const keys = new Set();
  for (const file of readdirSync(join(root, 'Web/dist'), { recursive: true })) {
    if (file.endsWith('.js')) for (const match of readFileSync(join(root, 'Web/dist', file), 'utf8').matchAll(/(?<![a-f0-9])04[a-f0-9]{128}(?![a-f0-9])/gi)) keys.add(match[0]);
  }
  assert.equal(keys.size, 1, '生产静态文件中唯一公开 SM2 公钥');
  return [...keys][0];
}
const route = 'plugin34' + randomBytes(5).toString('hex');
function code(value) { return 'using Microsoft.AspNetCore.Mvc;\\r\\nusing Microsoft.AspNetCore.Authorization;\\r\\n[ApiController] [AllowAnonymous] [Route("api/' + route + '")] public class Plugin34Controller : ControllerBase { [HttpGet] public string Get() => "' + value + '"; }\\r\\n'; }
async function rows() { return api(admin, 'sysPlugin/page', { page: 1, pageSize: 100, name: prefix }); }
async function lookup(name) { const result = (await rows()).items.find(row => row.name === name); assert.ok(result); assert.match(String(result.id), /^\\d+$/); return result; }
async function callPlugin(expected) {
  const deadline = Date.now() + 10000;
  while (true) {
    const response = await fetch(new URL('/api/' + route, base), { signal: AbortSignal.timeout(3000) });
    const body = await response.text();
    if (expected === null ? response.status === 404 : response.ok && (body === expected || body === JSON.stringify(expected) || (() => { try { const data = JSON.parse(body); return data.code === 200 && data.result === expected; } catch { return false; } })())) return;
    if (Date.now() >= deadline) throw Error('动态路由状态不符 HTTP ' + response.status);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}
async function runService() {
  const name = prefix + '_service';
  const draft = { name, assemblyName: prefix + '_assembly', csharpCode: code('initial34'), orderNo: 100, status: 1, remark: '隔离真实动态插件' };
  await api(admin, 'sysPlugin/add', draft);
  let item = await lookup(name);
  createdIds.add(String(item.id));
  assert.equal(await sql('SELECT encode(convert_to(csharpcode, \\'UTF8\\'), \\'hex\\') FROM sysplugin WHERE id=' + item.id), Buffer.from(draft.csharpCode).toString('hex'));
  await callPlugin('initial34'); record('real-add-persist-original-code-and-execute');
  const before = await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + item.id);
  await api(admin, 'sysPlugin/update', { ...item, csharpCode: 'invalid C# source' }, 'POST', true);
  assert.equal(await sql('SELECT row_to_json(t)::text FROM sysplugin t WHERE id=' + item.id), before);
  await callPlugin('initial34'); record('compile-error-preserves-database-and-running-route');
  await api(admin, 'sysPlugin/update', { ...item, csharpCode: code('updated34') });
  item = await lookup(name); await callPlugin('updated34'); record('real-update-replaces-runtime');
  await api(admin, 'sysPlugin/update', { ...item, status: 2 });
  item = await lookup(name); assert.equal(item.status, 2); await callPlugin(null); record('disabled-plugin-removes-route');
  await api(admin, 'sysPlugin/update', { ...item, status: 1 });
  await callPlugin('updated34'); record('enable-republishes-route');
  await api(admin, 'sysPlugin/delete', { id: item.id });
  assert.equal(await sql('SELECT count(*) FROM sysplugin WHERE id=' + item.id), '0');
  await callPlugin(null); record('delete-removes-row-and-route');
}
async function cleanupFixtures() {
  const result = await rows(); assert.ok(result.total <= 100);
  assert.ok(result.items.every(item => item.name.startsWith(prefix)));
  const failures = [];
  for (const item of result.items) try { await api(admin, 'sysPlugin/delete', { id: item.id }); } catch (error) { failures.push(clean(error.message)); }
  assert.equal(await sql("SELECT count(*) FROM sysplugin WHERE starts_with(name, '" + prefix + "')"), '0');
  assert.deepEqual(failures, []); report.fixtureRecordsRemoved = true;
}
`;
text = text.replace('existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync', 'existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync');
let tail = source.slice(191).join('\n').replaceAll('template-browser-baseline.json', 'plugin-service-baseline.json').replaceAll('template-startup-report.json', 'plugin-startup-report.json').replace("?? 5033", "?? 5034").replace("'-TemplateFixture'", "'-PluginFixture', '-BuildRoot', join(root, '.scratch/frontend-vben-migration/plugin-api-build')");
tail = tail.replace("const cases = await runService(); stage = 'browser'; await runBrowser(cases); report.passed = true;", "await runService(); report.passed = true;");
text += tail;
fs.writeFileSync(dir + 'run-plugin-service-baseline.mjs', text, 'utf8');
console.log('已生成真实插件服务基线；未运行浏览器');
