import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs, { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { activateFrontendRelease, packFrontendRelease, verifyFrontendRelease } from './frontend-release.mjs';
const actualDeploy = dirname(fileURLToPath(import.meta.url));
function fixture(run) {
	const root = mkdtempSync(join(tmpdir(), 'adminnet-release-unit-'));
	const dist = join(root, 'dist');
	mkdirSync(dist);
	writeFileSync(join(dist, 'index.html'), '<script src="/_app-config-12345678.js"></script>');
	writeFileSync(join(dist, '_app-config-12345678.js'), '{}');
	writeFileSync(join(dist, 'asset-12345678.js'), 'real fixture bytes');
	try {
		run(root, dist);
	} finally {
		rmSync(root, { recursive: true });
	}
}
const pack = (root, dist) => packFrontendRelease({ dist, output: join(root, 'release'), commit: 'a'.repeat(40), version: 'candidate-1', deployRoot: actualDeploy });
test('清单逐字节核对，篡改、额外文件和旧哈希均拒绝', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		assert.equal(release.fileCount, 8);
		assert.throws(() => verifyFrontendRelease(release.root, 'f'.repeat(64)), /清单哈希/);
		writeFileSync(join(release.root, 'unexpected.txt'), 'not registered');
		assert.throws(() => verifyFrontendRelease(release.root), /未登记/);
		rmSync(join(release.root, 'unexpected.txt'));
		writeFileSync(join(release.root, 'html/asset-12345678.js'), 'changed');
		assert.throws(() => verifyFrontendRelease(release.root), /大小|哈希/);
	}));
test('未确认替换或坏包不会改变现有站点', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const target = join(root, 'current');
		mkdirSync(target);
		writeFileSync(join(target, 'keep.bin'), Buffer.from([255, 0, 13, 10]));
		const before = readFileSync(join(target, 'keep.bin'));
		assert.throws(() => activateFrontendRelease({ source: release.root, target, manifestSha256: release.manifestSha256 }), /显式确认/);
		writeFileSync(join(release.root, 'html/index.html'), 'tampered');
		assert.throws(() => activateFrontendRelease({ source: release.root, target, manifestSha256: release.manifestSha256, replace: true }));
		assert.deepEqual(readFileSync(join(target, 'keep.bin')), before);
		assert.deepEqual(readdirSync(target), ['keep.bin']);
	}));
test('明确切换只保留新发布，重复安装无临时备份或锁', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const target = join(root, 'current');
		mkdirSync(target);
		writeFileSync(join(target, 'legacy.html'), 'old');
		const options = { source: release.root, target, manifestSha256: release.manifestSha256, replace: true };
		assert.equal(activateFrontendRelease(options).previousReleaseRetained, false);
		assert.equal(existsSync(join(target, 'legacy.html')), false);
		assert.equal(verifyFrontendRelease(target, release.manifestSha256).fileCount, 8);
		activateFrontendRelease(options);
		assert.equal(
			readdirSync(root).some((name) => /stage-|rollback-|deploy-lock/.test(name)),
			false
		);
	}));
test('复制完成后切换失败会恢复原目录并清除本次临时资源', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const target = join(root, 'current');
		mkdirSync(target);
		writeFileSync(join(target, 'keep.bin'), Buffer.from([11, 22, 33]));
		const originalRename = fs.renameSync;
		fs.renameSync = (source, destination) => {
			if (String(source).includes('.current.stage-') && destination === target) throw new Error('模拟操作系统拒绝发布目录重命名');
			return originalRename(source, destination);
		};
		syncBuiltinESMExports();
		try {
			assert.throws(() => activateFrontendRelease({ source: release.root, target, manifestSha256: release.manifestSha256, replace: true }), /拒绝发布目录/);
		} finally {
			fs.renameSync = originalRename;
			syncBuiltinESMExports();
		}
		assert.deepEqual(readFileSync(join(target, 'keep.bin')), Buffer.from([11, 22, 33]));
		assert.deepEqual(readdirSync(target), ['keep.bin']);
		assert.equal(
			readdirSync(root).some((name) => /stage-|rollback-|deploy-lock/.test(name)),
			false
		);
	}));
test('目标独占锁和重叠目录拒绝，不覆盖其它任务内容', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const target = join(root, 'current');
		mkdirSync(join(root, '.current.deploy-lock'));
		assert.throws(() => activateFrontendRelease({ source: release.root, target, manifestSha256: release.manifestSha256 }));
		assert.equal(existsSync(target), false);
		assert.equal(existsSync(join(root, '.current.deploy-lock')), true);
		assert.throws(() => activateFrontendRelease({ source: release.root, target: join(release.root, 'nested'), manifestSha256: release.manifestSha256 }), /互相包含/);
	}));
test('Windows 大小写别名不能将候选目录作为切换目标', { skip: process.platform !== 'win32' }, () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const target = join(root, 'RELEASE');
		assert.equal(existsSync(target), true);
		assert.throws(() => activateFrontendRelease({ source: release.root, target, manifestSha256: release.manifestSha256, replace: true }), /互相包含/);
		assert.equal(verifyFrontendRelease(release.root, release.manifestSha256).fileCount, 8);
	})
);
test('Windows 大小写别名不能将打包输出放入输入目录', { skip: process.platform !== 'win32' }, () =>
	fixture((root, dist) => {
		assert.throws(() => packFrontendRelease({ dist, output: join(root, 'DIST', 'candidate'), commit: 'a'.repeat(40), version: 'candidate-1', deployRoot: actualDeploy }), /不能互相包含/);
		assert.deepEqual(readdirSync(dist).sort(), ['_app-config-12345678.js', 'asset-12345678.js', 'index.html']);
	})
);
test('悬空目录链接必须明确拒绝且保持链接和缺失目标不变', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const target = join(root, 'current');
		const missing = join(root, 'missing');
		fs.symlinkSync(missing, target, process.platform === 'win32' ? 'junction' : 'dir');
		assert.equal(existsSync(target), false);
		assert.throws(() => activateFrontendRelease({ source: release.root, target, manifestSha256: release.manifestSha256, replace: true }), /链接|联接/);
		assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
		assert.equal(existsSync(missing), false);
	}));
test('打包输出拒绝悬空链接并保留原链接', () =>
	fixture((root, dist) => {
		const output = join(root, 'release');
		const missing = join(root, 'missing');
		fs.symlinkSync(missing, output, process.platform === 'win32' ? 'junction' : 'dir');
		assert.equal(existsSync(output), false);
		assert.throws(() => pack(root, dist), /链接|联接/);
		assert.equal(fs.lstatSync(output).isSymbolicLink(), true);
		assert.equal(existsSync(missing), false);
		assert.equal(
			readdirSync(root).some((name) => /stage-|rollback-|deploy-lock/.test(name)),
			false
		);
	}));
test('清单越界与缺失资源拒绝', () =>
	fixture((root, dist) => {
		const release = pack(root, dist);
		const manifestFile = join(release.root, 'release-manifest.json');
		const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
		manifest.files[0].path = '../outside';
		writeFileSync(manifestFile, JSON.stringify(manifest));
		assert.throws(() => verifyFrontendRelease(release.root), /目录内|越界/);
	}));
