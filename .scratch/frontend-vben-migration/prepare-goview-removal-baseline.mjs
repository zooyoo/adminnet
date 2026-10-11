import fs from 'node:fs';
const source = fs.readFileSync('.scratch/frontend-vben-migration/run-sdk-browser-baseline.mjs', 'utf8');
const head = source.slice(0, source.indexOf('// 生产桌面页面'));
const tail = source.slice(source.indexOf('try {\n  const port = Number(process.argv[2]'));
const flow = fs.readFileSync('.scratch/frontend-vben-migration/goview-removal-flow.mjs', 'utf8');
const output = (head + flow + tail)
  .replaceAll('sdk-browser-baseline.json', 'goview-removal-baseline.json')
  .replaceAll('plugin-startup-report.json', 'goview-startup-report.json')
  .replace('production-desktop-real-api-postgresql-generated-sdk-no-mock', 'production-desktop-real-api-postgresql-goview-removal-no-mock')
  .replace('process.argv[2] ?? 5035', 'process.argv[2] ?? 5037')
  .replace('frontend-vben-migration/plugin-api-build', 'frontend-vben-migration/goview-removal-api-build')
  .replace('await runSdkBrowser();', 'await runRemoval();');
fs.writeFileSync('.scratch/frontend-vben-migration/run-goview-removal-baseline.mjs', output, 'utf8');
