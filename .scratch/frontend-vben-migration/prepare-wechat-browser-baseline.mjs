import fs from 'node:fs';
const source = fs.readFileSync('.scratch/frontend-vben-migration/run-sdk-browser-baseline.mjs', 'utf8');
const head = source.slice(0, source.indexOf('// 生产桌面页面'));
const tail = source.slice(source.indexOf('try {\n  const port = Number(process.argv[2]'));
const flow = fs.readFileSync('.scratch/frontend-vben-migration/wechat-browser-flow.mjs', 'utf8');
const permissions = fs.readFileSync('.scratch/frontend-vben-migration/wechat-permission-flow.mjs', 'utf8');
const combinedFlow = flow
  .replace("  proxy = await startProductionProxy", "  await runWechatPermissions();\n  proxy = await startProductionProxy")
  .replace('async function cleanupFixtures()', 'async function cleanupWechatProfiles()');
const cleanup = `
async function cleanupFixtures() {
  const errors = [];
  report.fixtureRecordsRemoved = false;
  for (const [label, work] of [['profiles', cleanupWechatProfiles], ['tenants', cleanupWechatTenants]]) {
    try { await work(); } catch (error) { errors.push(clean(label + ': ' + error.message)); }
  }
  report.fixtureRecordsRemoved = errors.length === 0 && report.tenantFixturesRemoved === true;
  assert.deepEqual(errors, []);
}
`;
const output = (head + permissions + combinedFlow + cleanup + tail)
  .replaceAll('sdk-browser-baseline.json', 'wechat-browser-baseline.json')
  .replaceAll('plugin-startup-report.json', 'wechat-startup-report.json')
  .replace('production-desktop-real-api-postgresql-generated-sdk-no-mock', 'production-desktop-real-api-postgresql-wechat-first-integration-no-mock')
  .replace('process.argv[2] ?? 5035', 'process.argv[2] ?? 5038')
  .replace('frontend-vben-migration/plugin-api-build', 'frontend-vben-migration/wechat-api-build')
  .replace('await runSdkBrowser();', 'await runWechat();');
fs.writeFileSync('.scratch/frontend-vben-migration/run-wechat-browser-baseline.mjs', output, 'utf8');
