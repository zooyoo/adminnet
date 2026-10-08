import { execFile } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = mkdtempSync(join(tmpdir(), 'adminnet-notice-ui-'));
// 契约请求由 Playwright 拦截；未声明的请求发往不可用 loopback 地址，不接触开发服务。
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL('http://127.0.0.1:1'));
const report = { passed: false, proposalComplete: false, boundary: 'production-browser-mocked-api', evidence };
try {
	const { stdout, stderr } = await promisify(execFile)('pwsh', [
		'-NoProfile', '-Command',
		"$ErrorActionPreference = 'Stop'; corepack pnpm exec playwright test notice-contract.spec.ts --workers=2 --output $env:NOTICE_EVIDENCE; if ($LASTEXITCODE -ne 0) { throw 'Notice production contracts failed.' }",
	], {
		cwd: join(root, 'Web'), windowsHide: true, timeout: 240_000, maxBuffer: 2 * 1024 * 1024,
		env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl, NOTICE_EVIDENCE: evidence },
	});
	writeFileSync(join(evidence, 'browser.log'), stdout + stderr, 'utf8');
	report.passed = true;
	console.log(stdout.split('\n').filter((line) => /^\s*\d+ (passed|failed|skipped)/.test(line)).join('\n'));
} catch (error) {
	writeFileSync(join(evidence, 'browser.log'), `${error.stdout ?? ''}\n${error.stderr ?? ''}`, 'utf8');
	report.error = 'Production browser contract failed; inspect the evidence log.';
	process.exitCode = 1;
} finally {
	await proxy.close();
	writeFileSync(join(evidence, 'notice-ui-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
