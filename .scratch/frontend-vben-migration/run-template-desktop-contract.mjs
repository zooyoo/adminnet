import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const node = process.execPath, pnpm = process.env.DSH_TEMPLATE_PNPM_PATH;
assert.ok(pnpm, 'DSH_TEMPLATE_PNPM_PATH must select the bundled pnpm script');
const logPath = join(root, '.scratch/frontend-vben-migration/template-desktop-contract.log');
let proxy, output;
const failures = [];
try {
  proxy = await startProductionProxy(join(root, 'Web/dist'), new URL('http://127.0.0.1:1'));
  output = openSync(logPath, 'w');
  const child = spawn(node, [pnpm, 'exec', 'playwright', 'test', '--config', join(root, '.scratch/frontend-vben-migration/template-playwright.config.mjs'), '--project=desktop'], { cwd: join(root, 'Web'), env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl }, stdio: ['ignore', output, output], windowsHide: true });
  const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve({ code, signal })); });
  assert.equal(result.code, 0, 'Desktop Mock contract failed (' + result.code + ', ' + (result.signal ?? 'no signal') + '); see ' + logPath);
} catch (error) { failures.push(error); }
finally {
  if (output !== undefined) try { closeSync(output); } catch (error) { failures.push(error); }
  if (proxy) try { await proxy.close(); } catch (error) { failures.push(error); }
}
if (failures.length) throw new AggregateError(failures, 'Desktop contract execution or independent cleanup failed');
console.log('Production desktop Mock contract and cleanup passed; ' + logPath);
