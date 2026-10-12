import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyFrontendRelease } from '../../Web/scripts/deploy/frontend-release.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const origin = resolve(directory, '../..');
const runtime = realpathSync(process.argv[2] ?? '');
const json = (file) => JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const artifact = (file) => ({
	path: file.replaceAll('\\', '/'),
	sha256: sha256(file),
});
const quote = (value) => "'" + String(value).replaceAll("'", "''") + "'";
const native = (command, args) =>
	execFileSync(
		'pwsh',
		[
			'-NoProfile',
			'-NonInteractive',
			'-Command',
			"$ErrorActionPreference='Stop'; & " + [command, ...args].map(quote).join(' ') + "; if($LASTEXITCODE -ne 0){throw 'Read-only evidence command failed'}",
		],
		{ cwd: origin, encoding: 'utf8', timeout: 20000 }
	).trim();
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = json(join(runtime, 'isolated-run.json'));
const pg = json(join(runtime, 'isolated-postgres.json'));
assert.equal(realpathSync(marker.runtimeRoot).toLowerCase(), runtime.toLowerCase());
assert.equal(realpathSync(pg.runtimeRoot).toLowerCase(), runtime.toLowerCase());
assert.ok(Number.isSafeInteger(marker.processId) && marker.processId > 0);
const control = json(join(directory, 'release48-control.tmp.json'));
const ownerRoot = realpathSync(control.ownerRoot);
assert.equal(dirname(ownerRoot).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(ownerRoot), /^adminnet-release48-[a-f0-9]{32}$/);
const owner = json(join(ownerRoot, '.adminnet-release48-owner.json'));
assert.equal(owner.kind, 'proposal48-local-release');
assert.equal(realpathSync(owner.origin).toLowerCase(), realpathSync(origin).toLowerCase());
assert.equal(owner.productionAuthorized, false);
assert.equal(control.productionAuthorized, false);
for (const file of [control.packagedRoot, control.extractedRoot, control.zip]) assert.equal(dirname(realpathSync(file)).toLowerCase(), ownerRoot.toLowerCase());
verifyFrontendRelease(control.packagedRoot, control.manifestSha256);
verifyFrontendRelease(control.extractedRoot, control.manifestSha256);
assert.equal(control.zipSha256, sha256(control.zip));
assert.equal(control.fileCount, 435);
assert.equal(control.previousOwnedPreparationRemoved, true);

const reportPath = join(runtime, 'evidence/release48-browser-baseline.json');
const report = json(reportPath);
for (const key of ['passed', 'cleanupPassed', 'fixtureRecordsRemoved', 'generatedFilesRemoved', 'nginxRemoved', 'containerRemoved', 'apiStopped', 'noDuplicatedPrefix'])
	assert.equal(report[key], true, key);
for (const key of ['proposalComplete', 'primaryDeletionApplied', 'productionAuthorized', 'productionSwitched']) assert.equal(report[key], false, key);
assert.deepEqual(report.deferredProposals, [41, 46, 47]);
assert.equal(report.steps.length, 17);
assert.deepEqual(report.cleanupErrors, []);
assert.deepEqual(report.browserErrors, []);
assert.equal(report.release.manifestSha256, control.manifestSha256);
assert.equal(report.release.zipSha256, control.zipSha256);
assert.equal(report.release.fileCount, 435);
assert.equal(report.baseCommit, control.baseCommit);
assert.equal(report.firstLogins.length, 2);
for (const login of report.firstLogins) {
	assert.equal(login.required, true);
	assert.equal(login.validLegacyCookieIgnored, true);
	assert.equal(login.authenticatedRequestsBeforeManualLogin, 0);
	assert.equal(login.legacyKeysPreserved, true);
	assert.ok(login.newKeys.length > 0 && login.newKeys.every((key) => key.startsWith('adminnet-vben-v1-5.8.0-prod-')));
}
assert.equal(report.cutovers.length, 2);
for (const cutover of report.cutovers) {
	for (const key of ['rejectedTampered', 'currentPreserved', 'liveActivation', 'parentMounted']) assert.equal(cutover[key], true);
	assert.equal(cutover.previousReleaseRetained, false);
	assert.equal(cutover.manifestSha256, control.manifestSha256);
	assert.equal(cutover.files, 435);
}
assert.equal(report.eventStreams.length, 2);
for (const stream of report.eventStreams) {
	assert.equal(stream.status, 200);
	assert.equal(stream.contentType, 'text/event-stream');
}
assert.ok(report.sseEvents.length >= 4);
assert.equal(report.webSocketClosure.serverConfirmed, true);

// 只读复核临时端口、所属 PG 容器与记录的 API 进程；不终止任何进程。
const urls = [marker.baseUrl, ...report.addresses.flatMap((address) => [address.http, address.tls].filter(Boolean))].map((value) => new URL(value));
for (const url of urls) assert.equal(url.hostname, '127.0.0.1');
const ports = [...new Set(urls.map((url) => Number(url.port)))];
for (const port of ports) assert.ok(Number.isSafeInteger(port) && port > 0 && port < 65536);
await Promise.all(
	ports.map(
		(port) =>
			new Promise((done, reject) => {
				const socket = createConnection({ host: '127.0.0.1', port });
				socket.setTimeout(1500);
				socket.once('connect', () => {
					socket.destroy();
					reject(new Error('临时验收端口仍可连接：' + port));
				});
				socket.once('timeout', () => {
					socket.destroy();
					reject(new Error('临时端口核验超时：' + port));
				});
				socket.once('error', (error) => {
					socket.destroy();
					error.code === 'ECONNREFUSED' ? done() : reject(error);
				});
			})
	)
);
assert.equal(native('docker', ['ps', '-aq', '--filter', 'label=adminnet.isolated-runtime=' + runtime]), '');
const unrelatedNginxSnapshot = native('docker', ['ps', '-aq', '--filter', 'label=adminnet.runtime.fixture']);
const activeProcessCount = Number(
	execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', "$ErrorActionPreference='Stop'; @(Get-Process -Id " + marker.processId + ' -ErrorAction SilentlyContinue).Count'], {
		encoding: 'utf8',
		timeout: 10000,
	}).trim()
);
assert.equal(activeProcessCount, 0);

const cleanupPlan = json(join(directory, 'cleanup47-plan.json'));
assert.equal(cleanupPlan.deletions.length, 770);
for (const file of cleanupPlan.deletions) assert.equal(sha256(join(origin, file.path)), file.workingOriginalSha256, file.path);
const cleanupAudit = {
	passed: true,
	boundary: 'read-only-no-process-or-container-mutation',
	apiProcessAbsent: true,
	ownedPostgresqlContainersAbsent: true,
	fixtureProxyContainersVisible: unrelatedNginxSnapshot ? unrelatedNginxSnapshot.split(/\r?\n/).length : 0,
	nginxOwnedCleanupVerifiedByBrowser: report.nginxRemoved,
	closedPorts: ports,
	primaryLegacyFilesPreserved: 770,
};
writeFileSync(join(directory, 'release48-cleanup-audit.json'), JSON.stringify(cleanupAudit, null, 2) + '\n', 'utf8');

const reviewed = [
	['48-release-first-login-0.png', '59a7e86fc587b3cf28be6888ae91e50e9c59d17db06a3827baf6bdb5791d9988'],
	['48-release-first-login-1.png', '59a7e86fc587b3cf28be6888ae91e50e9c59d17db06a3827baf6bdb5791d9988'],
	['48-release-runtime-online-0-2.png', '485948e1714336d58380888dd47099579007a37518927889aad4dbb99ff1ef24'],
	['48-release-runtime-online-1-0.png', '5f85f14546059f1ae2c243bd3cbe0861eb71d9a4c3cf0f8a43d3e7347895d452'],
	['48-release-runtime-file-preview-0.png', '32f4b720f158c1baca660e106aac26473c8c2afde5ce94583a4065e2d68b962f'],
	['48-release-runtime-file-preview-1.png', '4e534d12df334e30ac06c9950b7b7f252006d031254465d120aeb3888d71f4ea'],
].map(([file, expected]) => {
	const entry = artifact(join(runtime, 'evidence', file));
	assert.equal(entry.sha256, expected);
	return { ...entry, reviewed: true };
});
const files = [
	'Web/scripts/deploy/frontend-release.mjs',
	'Web/scripts/deploy/frontend-release.test.mjs',
	'Web/scripts/deploy/CUTOVER.md',
	'Web/scripts/deploy/README.md',
	'.scratch/frontend-vben-migration/prepare-release48-browser-baseline.mjs',
	'.scratch/frontend-vben-migration/run-release48-browser-baseline.mjs',
	'.scratch/frontend-vben-migration/release48-nginx-fixture.mjs',
	'.scratch/frontend-vben-migration/seal-release48-acceptance.mjs',
	'.scratch/frontend-vben-migration/run-cleanup47-browser-baseline.mjs',
	'.scratch/frontend-vben-migration/runtime45-browser-flow.mjs',
	'.scratch/frontend-vben-migration/mqtt-api-startup.mjs',
];
for (const [published, source] of [
	['frontend-release.mjs', 'Web/scripts/deploy/frontend-release.mjs'],
	['CUTOVER.md', 'Web/scripts/deploy/CUTOVER.md'],
	['README.md', 'Web/scripts/deploy/README.md'],
	['nginx-http.conf', 'Web/scripts/deploy/nginx.conf'],
	['nginx-tls.conf', 'docker/nginx/conf/nginx.conf'],
])
	assert.equal(sha256(join(control.extractedRoot, 'deploy', published)), sha256(join(origin, source)), published);
const testsLog = join(directory, 'release48-tool-tests.tmp.log');
const testsText = readFileSync(testsLog, 'utf8');
assert.match(testsText, /tests\s+10\b/u);
assert.match(testsText, /pass\s+10\b/u);
assert.match(testsText, /fail\s+0\b/u);
assert.match(testsText, /skipped\s+0\b/u);
const pathRegressionCases = [
	['Windows 大小写别名不能将候选目录作为切换目标', 'release48-path-red-alias.tmp.log', /Missing expected exception/u],
	['Windows 大小写别名不能将打包输出放入输入目录', 'release48-path-red-pack.tmp.log', /Missing expected exception/u],
	['悬空目录链接必须明确拒绝且保持链接和缺失目标不变', 'release48-path-red-link.tmp.log', /operation not permitted, rename/u],
	['打包输出拒绝悬空链接并保留原链接', 'release48-path-red-pack-link.tmp.log', /operation not permitted, rename/u],
];
assert.equal(process.platform, 'win32', '大小写别名回归必须在真实 Windows 文件系统上执行');
const pathRegressions = pathRegressionCases.map(([name, log, failure]) => {
	assert.ok(testsText.includes(name), name);
	assert.match(readFileSync(join(directory, log), 'utf8'), failure);
	return {
		name,
		redBeforeFix: true,
		passedAfterFix: true,
		redLog: artifact(join(directory, log)),
	};
});
const evidence = {
	proposal: 48,
	scopePassed: true,
	complete: false,
	execution: 'local-verified-awaiting-dependencies-and-production-authorization',
	deferredProposals: [41, 46, 47],
	productionAuthorized: false,
	productionSwitched: false,
	primaryDeletionApplied: false,
	applicationBaselineCommit: control.baseCommit,
	buildInput: {
		cleanup47Acceptance: artifact(join(directory, 'cleanup47-acceptance.json')),
		cleanup47Plan: artifact(join(directory, 'cleanup47-plan.json')),
	},
	release: {
		source: 'verified-cleanup47-dist',
		supersedes: control.supersedes ?? null,
		zip: artifact(control.zip),
		manifestSha256: control.manifestSha256,
		packagedRoot: control.packagedRoot,
		extractedRoot: control.extractedRoot,
		files: 435,
		requiresFreshLogin: true,
	},
	toolTests: {
		passed: 10,
		failed: 0,
		skipped: 0,
		log: artifact(testsLog),
		pathRegressions,
	},
	sourceHashes: Object.fromEntries(
		files.map((file) => {
			assert.ok(existsSync(join(origin, file)), file);
			return [file, sha256(join(origin, file))];
		})
	),
	browser: { log: artifact(reportPath), report, reviewed },
	independentCleanup: {
		...artifact(join(directory, 'release48-cleanup-audit.json')),
		report: cleanupAudit,
	},
	outstanding: ['41: 用户暂缓的授权播放源及真实首帧验收', '46: 第 41 项完成后整体闭票', '47: 第 46 项闭票后应用主工作区清理', '48: 第 47 项闭票与独立生产发布授权、现场配置和访问地址验收'],
};
writeFileSync(join(directory, 'release48-acceptance.json'), JSON.stringify(evidence, null, 2) + '\n', 'utf8');
console.log(
	JSON.stringify(
		{
			scopePassed: true,
			complete: false,
			files: 435,
			browserSteps: report.steps.length,
			reviewed: reviewed.length,
			toolTests: 10,
			cleanup: cleanupAudit,
			productionSwitched: false,
		},
		null,
		2
	)
);
