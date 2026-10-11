import { spawn } from 'node:child_process';
import { openSync, closeSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let proxy, output;
const failures = [];
try {
  proxy = await startProductionProxy(join(root, 'Web/dist'), new URL('http://127.0.0.1:1'));
  output = openSync(join(root, '.scratch/frontend-vben-migration/plugin-desktop-contract.log'), 'w');
  const child = spawn(process.execPath, [join(root, 'Web/node_modules/@playwright/test/cli.js'), 'test', '--config', join(root, '.scratch/frontend-vben-migration/plugin-playwright.config.mjs'), '--project=desktop'], { cwd: join(root, 'Web'), env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl }, stdio: ['ignore', output, output], windowsHide: true });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  if (code !== 0) throw new Error(`Desktop Mock contract failed: ${code}`);
} catch (error) { failures.push(error); }
finally {
  if (output !== undefined) try { closeSync(output); } catch (error) { failures.push(error); }
  if (proxy) try { await proxy.close(); } catch (error) { failures.push(error); }
}
if (failures.length) throw new AggregateError(failures, '插件桌面合同或清理失败');
console.log('生产桌面 Mock 合同及代理清理通过');
