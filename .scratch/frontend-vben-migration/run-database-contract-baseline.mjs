import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = mkdtempSync(join(tmpdir(), 'adminnet-database-ui-'));
const report = { passed: false, boundary: 'production-browser-mocked-api', evidence };
let proxy;
try {
	proxy = await startProductionProxy(join(root, 'Web/dist'), new URL('http://127.0.0.1:1'));
	const { stdout, stderr } = await promisify(execFile)('pwsh', ['-NoProfile', '-Command', "$ErrorActionPreference = 'Stop'; pnpm exec playwright test --config ../.scratch/frontend-vben-migration/database-playwright.config.mjs --project=desktop --output $env:DATABASE_EVIDENCE; if ($LASTEXITCODE -ne 0) { throw 'Database contracts failed.' }"], { cwd: join(root, 'Web'), windowsHide: true, timeout: 300000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl, DATABASE_EVIDENCE: evidence } });
	writeFileSync(join(evidence, 'browser.log'), stdout + stderr, 'utf8'); report.passed = true;
} catch (error) {
	writeFileSync(join(evidence, 'browser.log'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`, 'utf8'); report.error = 'Database contract failed; inspect browser.log'; process.exitCode = 1;
} finally {
	await proxy?.close(); writeFileSync(join(evidence, 'database-contract-baseline.json'), JSON.stringify(report, null, 2), 'utf8'); console.log(JSON.stringify(report));
}
