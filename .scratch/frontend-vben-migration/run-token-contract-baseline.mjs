import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = mkdtempSync(join(tmpdir(), 'adminnet-token-ui-'));
const report = { passed: false, proposalComplete: false, boundary: 'production-browser-mocked-api', evidence };
let proxy;
try {
	proxy = await startProductionProxy(join(root, 'Web/dist'), new URL('http://127.0.0.1:1'));
	const { stdout, stderr } = await promisify(execFile)('pwsh', [
		'-NoProfile', '-Command',
		"$ErrorActionPreference = 'Stop'; corepack pnpm exec playwright test token-contract.spec.ts auth-contract.spec.ts --project=desktop --workers=2 --output $env:TOKEN_EVIDENCE; if ($LASTEXITCODE -ne 0) { throw 'Token contracts failed.' }",
	], { cwd: join(root, 'Web'), windowsHide: true, timeout: 300_000, maxBuffer: 2 * 1024 * 1024, env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl, TOKEN_EVIDENCE: evidence } });
	writeFileSync(join(evidence, 'browser.log'), stdout + stderr, 'utf8');
	report.passed = true;
} catch (error) {
	writeFileSync(join(evidence, 'browser.log'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`, 'utf8');
	report.error = 'Token browser contract failed; inspect evidence log.';
	process.exitCode = 1;
} finally {
	await proxy?.close();
	writeFileSync(join(evidence, 'token-contract-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
