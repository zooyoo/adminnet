import fs from 'node:fs';
const dir = '.scratch/frontend-vben-migration/';
let source = fs.readFileSync(dir + 'run-plugin-service-baseline.mjs', 'utf8');
const flow = fs.readFileSync(dir + 'plugin-browser-flow.mjs', 'utf8');
source = source.replace('try {\n  const port =', flow + 'try {\n  const port =');
source = source.replace('await runService(); report.passed = true;', "await runService(); stage = 'browser'; await runBrowser(); report.passed = true;");
source = source.replaceAll('plugin-service-baseline.json', 'plugin-browser-baseline.json').replaceAll('plugin-startup-report.json', 'plugin-browser-startup-report.json').replace('real-postgresql-plugin-service-no-browser', 'production-desktop-real-postgresql-plugin-management');
fs.writeFileSync(dir + 'run-plugin-browser-baseline.mjs', source, 'utf8');
console.log('已生成生产桌面真实插件基线');
