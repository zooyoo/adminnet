import fs from 'node:fs';
import assert from 'node:assert/strict';
const source = fs.readFileSync('.scratch/frontend-vben-migration/run-wechat-browser-baseline.mjs', 'utf8');
assert.ok(source.includes('await runWechat();'));
const flow = fs.readFileSync('.scratch/frontend-vben-migration/payment-removal-flow.mjs', 'utf8');
const output = source
  .replaceAll('wechat-browser-baseline.json', 'payment-removal-baseline.json')
  .replaceAll('wechat-startup-report.json', 'payment-startup-report.json')
  .replaceAll('frontend-vben-migration/wechat-api-build', 'frontend-vben-migration/payment-api-build')
  .replace('process.argv[2] ?? 5038', 'process.argv[2] ?? 5039')
  .replace('production-desktop-real-api-postgresql-wechat-first-integration-no-mock', 'production-desktop-real-api-postgresql-payment-removal-wechat-regression-no-mock')
  .replace('await runWechat();', 'await verifyPaymentRemoval();\n  await runWechat();');
fs.writeFileSync('.scratch/frontend-vben-migration/run-payment-removal-baseline.mjs', output + '\n' + flow, 'utf8');
console.log('已生成支付移除与微信用户完整回归验收脚本');
