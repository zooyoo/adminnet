import fs from 'node:fs';
const source = fs.readFileSync('.scratch/frontend-vben-migration/run-sdk-generation-baseline.mjs', 'utf8');
const head = source.slice(0, source.indexOf('async function runGeneration()'));
const tail = source.slice(source.indexOf('try {\n  const port = Number(process.argv[2]')).replace('await runGeneration();', 'await runSdkBrowser();');
const flow = fs.readFileSync('.scratch/frontend-vben-migration/sdk-browser-flow.mjs', 'utf8');
fs.writeFileSync('.scratch/frontend-vben-migration/run-sdk-browser-baseline.mjs', (head + flow + tail).replaceAll('sdk-generation-baseline.json', 'sdk-browser-baseline.json').replace('real-postgresql-swagger-sdk-generation-no-browser', 'production-desktop-real-api-postgresql-generated-sdk-no-mock'), 'utf8');
