import fs from 'node:fs';
const dir = '.scratch/frontend-vben-migration/';
const template = fs.readFileSync(dir + 'run-template-browser-baseline.mjs', 'utf8').split('\n');
let source = fs.readFileSync(dir + 'run-plugin-service-baseline.mjs', 'utf8');
const helpers = template.slice(46, 58).join('\n').replaceAll('sysTemplate', 'sysPlugin').replace('delete|preview', 'delete|compileAssembly|removeAssembly');
const cleanup = template.slice(157, 180).filter((_, i) => ![13, 20].includes(i)).join('\n').replaceAll('sysTemplate', 'sysPlugin').replaceAll('systemplate', 'sysplugin').replaceAll('templates', 'plugins').replaceAll('template ', 'plugin ').replace('-original-snapshot-preserved', '');
const flow = fs.readFileSync(dir + 'plugin-permission-flow.mjs', 'utf8');
const start = source.indexOf('async function cleanupFixtures() {');
const end = source.indexOf('\ntry {\n  const port =', start);
if (start < 0 || end < 0) throw Error('基线结构变化');
source = source.slice(0, start) + cleanup + '\n' + helpers + '\n' + flow + source.slice(end);
source = source.replace('await runService(); report.passed = true;', 'await runPermission(); report.passed = true;');
source = source.replace('  if (failures.length) throw new Error(failures.join', `  await attempt('direct permission menu cleanup', async () => {
    const ids = (await sql('SELECT id FROM sysmenu WHERE starts_with(title, ' + quote(prefix + '_direct_') + ')')).split(/\\r?\\n/).filter(Boolean);
    for (const id of ids) { assert.match(id, /^\\d+$/); await api(admin, 'sysMenu/delete', { id }); }
    assert.equal(await sql('SELECT count(*) FROM sysmenu WHERE starts_with(title, ' + quote(prefix + '_direct_') + ')'), '0');
    for (const table of ['systenantmenu', 'sysrolemenu', 'sysusermenu']) if (ids.length) assert.equal(await sql('SELECT count(*) FROM ' + table + ' WHERE menuid IN (' + ids.join(',') + ')'), '0');
    report.directPermissionMenusRemoved = true;
  });
  if (failures.length) throw new Error(failures.join`);
source = source.replaceAll('plugin-service-baseline.json', 'plugin-permission-baseline.json').replaceAll('plugin-startup-report.json', 'plugin-permission-startup-report.json').replace('real-postgresql-plugin-service-no-browser', 'real-postgresql-plugin-permission-no-browser');
fs.writeFileSync(dir + 'run-plugin-permission-baseline.mjs', source, 'utf8');
console.log('已生成真实权限与租户隔离基线');
