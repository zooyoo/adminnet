import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const node = process.execPath;
const pnpm = process.env.DSH_UPDATE_PNPM_PATH;
assert.ok(pnpm, 'DSH_UPDATE_PNPM_PATH must select the bundled pnpm script');
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL('http://127.0.0.1:1'));
const logPath = join(root, '.scratch/frontend-vben-migration/update-desktop-contract.log');
const output = openSync(logPath, 'w');
try {
  const child = spawn(node, [pnpm, 'exec', 'playwright', 'test', '--config', join(root, '.scratch/frontend-vben-migration/update-playwright.config.mjs'), '--project=desktop'], {
    cwd: join(root, 'Web'), env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl }, stdio: ['ignore', output, output], windowsHide: true,
  });
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => resolve({ code, signal }));
  });
  assert.equal(result.code, 0, `Desktop Mock contract failed (${result.code}, ${result.signal ?? 'no signal'}); see ${logPath}`);
  console.log('Production desktop Mock contract passed; ' + logPath);
} finally {
  closeSync(output);
  await proxy.close();
}
