import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const manifestName = 'release-manifest.json';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const slash = (value) => value.split(sep).join('/');
function safePath(root, name) {
	assert.equal(typeof name, 'string', '发布路径无效');
	assert.ok(name && !isAbsolute(name) && !name.includes('\\') && !name.split('/').some((part) => !part || part === '.' || part === '..'), '发布路径必须位于目录内');
	const result = resolve(root, name);
	assert.ok(result.startsWith(resolve(root) + sep), '发布路径越界');
	return result;
}
function noLinks(file) {
	let current = resolve(file);
	while (true) {
		if (existsSync(current)) assert.equal(lstatSync(current).isSymbolicLink(), false, '发布目录不能经过符号链接或联接');
		const parent = dirname(current);
		if (parent === current) break;
		current = parent;
	}
}
function filesUnder(root) {
	noLinks(root);
	assert.ok(lstatSync(root).isDirectory(), '发布根目录不存在');
	const output = [];
	function walk(directory) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = join(directory, entry.name);
			assert.equal(entry.isSymbolicLink(), false, '发布包不能包含链接');
			if (entry.isDirectory()) walk(file);
			else {
				assert.ok(entry.isFile(), '发布包只能包含普通文件');
				output.push(slash(relative(root, file)));
			}
		}
	}
	walk(root);
	return output.sort();
}
function checkHtml(root) {
	const html = readFileSync(join(root, 'html/index.html'), 'utf8');
	const configuration = html.match(/src=["']([^"']*_app-config[^"']*\.js)["']/)?.[1];
	assert.ok(configuration && !configuration.includes('..'), '生产 HTML 必须引用外置运行时配置');
	assert.ok(existsSync(safePath(join(root, 'html'), configuration.replace(/^\//, ''))), '运行时配置资源缺失');
	return configuration.replace(/^\//, '');
}
export function verifyFrontendRelease(root, expectedManifestSha256) {
	root = resolve(root);
	noLinks(root);
	const bytes = readFileSync(join(root, manifestName));
	const manifestSha256 = digest(bytes);
	if (expectedManifestSha256) assert.equal(manifestSha256, expectedManifestSha256, '发布清单哈希不匹配');
	const manifest = JSON.parse(bytes.toString('utf8'));
	assert.equal(manifest.format, 1);
	assert.equal(manifest.kind, 'adminnet-vben-frontend');
	assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0);
	const listed = new Set();
	for (const item of manifest.files) {
		const file = safePath(root, item.path);
		assert.equal(listed.has(item.path), false, '发布清单路径重复');
		assert.notEqual(item.path, manifestName);
		listed.add(item.path);
		noLinks(file);
		assert.ok(lstatSync(file).isFile(), '发布清单资源缺失');
		const content = readFileSync(file);
		assert.equal(content.length, item.size, '发布文件大小不匹配');
		assert.equal(digest(content), item.sha256, '发布文件哈希不匹配');
	}
	assert.deepEqual(
		filesUnder(root).filter((file) => file !== manifestName),
		[...listed].sort(),
		'发布包含未登记或缺失的文件'
	);
	assert.equal(checkHtml(root), manifest.runtimeConfig);
	assert.equal(manifest.requiresFreshLogin, true);
	return { manifest, manifestSha256, fileCount: listed.size };
}
export function packFrontendRelease({ dist, output, commit, version, deployRoot = dirname(fileURLToPath(import.meta.url)) }) {
	dist = resolve(dist);
	output = resolve(output);
	assert.match(commit, /^[a-f0-9]{40}$/);
	assert.ok(typeof version === 'string' && /^[\w.-]{1,80}$/.test(version), '发布版本无效');
	assert.equal(existsSync(output), false, '发布输出已存在');
	assert.ok(!output.startsWith(dist + sep) && !dist.startsWith(output + sep) && output !== dist, '发布输出与输入不能互相包含');
	noLinks(dist);
	noLinks(dirname(output));
	const pending = join(dirname(output), '.' + basename(output) + '.stage-' + randomUUID());
	mkdirSync(pending);
	try {
		for (const file of filesUnder(dist)) {
			const destination = safePath(join(pending, 'html'), file);
			mkdirSync(dirname(destination), { recursive: true });
			copyFileSync(join(dist, file), destination);
		}
		mkdirSync(join(pending, 'deploy'));
		const configs = [
			['nginx.conf', 'nginx-http.conf'],
			['../../../docker/nginx/conf/nginx.conf', 'nginx-tls.conf'],
			['frontend-release.mjs', 'frontend-release.mjs'],
			['CUTOVER.md', 'CUTOVER.md'],
			['README.md', 'README.md'],
		];
		for (const [input, name] of configs) copyFileSync(resolve(deployRoot, input), join(pending, 'deploy', name));
		const runtimeConfig = checkHtml(pending);
		const files = filesUnder(pending).map((file) => {
			const content = readFileSync(join(pending, file));
			return { path: file, size: content.length, sha256: digest(content) };
		});
		const manifest = { format: 1, kind: 'adminnet-vben-frontend', version, commit, requiresFreshLogin: true, runtimeConfig, files };
		writeFileSync(join(pending, manifestName), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
		const result = verifyFrontendRelease(pending);
		renameSync(pending, output);
		return { ...result, root: output };
	} finally {
		if (existsSync(pending)) rmSync(pending, { recursive: true });
	}
}
export function activateFrontendRelease({ source, target, manifestSha256, replace = false }) {
	source = resolve(source);
	target = resolve(target);
	assert.match(manifestSha256, /^[a-f0-9]{64}$/, '切换需要先核对发布清单哈希');
	assert.ok(source !== target && !source.startsWith(target + sep) && !target.startsWith(source + sep), '发布源与目标不能互相包含');
	const verified = verifyFrontendRelease(source, manifestSha256);
	noLinks(dirname(target));
	noLinks(target);
	const existed = existsSync(target);
	assert.ok(!existed || replace, '现有发布目录必须显式确认替换');
	if (existed) filesUnder(target);
	const lock = join(dirname(target), '.' + basename(target) + '.deploy-lock');
	// mkdir 的独占创建防止两个切换进程操作同一目标。
	mkdirSync(lock);
	const id = randomUUID();
	const pending = join(dirname(target), '.' + basename(target) + '.stage-' + id);
	const backup = join(dirname(target), '.' + basename(target) + '.rollback-' + id);
	let movedOld = false;
	let published = false;
	let restored = false;
	try {
		mkdirSync(pending);
		for (const file of [...verified.manifest.files.map((item) => item.path), manifestName]) {
			const destination = safePath(pending, file);
			mkdirSync(dirname(destination), { recursive: true });
			copyFileSync(safePath(source, file), destination);
		}
		verifyFrontendRelease(pending, manifestSha256);
		noLinks(target);
		if (existed) {
			renameSync(target, backup);
			movedOld = true;
		}
		try {
			renameSync(pending, target);
			published = true;
		} catch (error) {
			if (movedOld) {
				renameSync(backup, target);
				restored = true;
			}
			throw error;
		}
		// 只在新目录完整发布后清除本次临时备份，不长期保存旧发布版本。
		if (movedOld) rmSync(backup, { recursive: true });
		return { manifestSha256, version: verified.manifest.version, files: verified.fileCount, previousReleaseRetained: false };
	} catch (error) {
		if (movedOld && !published && !restored && existsSync(backup)) {
			throw new Error('切换恢复未完成，保留本次临时备份：' + backup, { cause: error });
		}
		throw error;
	} finally {
		if (existsSync(pending)) rmSync(pending, { recursive: true });
		rmSync(lock, { recursive: true });
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const [command, ...args] = process.argv.slice(2);
		const options = {};
		for (let i = 0; i < args.length; i++) {
			assert.ok(args[i].startsWith('--'), '参数必须使用 --名称');
			const key = args[i].slice(2);
			options[key] = key === 'replace' ? true : args[++i];
		}
		const result =
			command === 'pack'
				? packFrontendRelease({ dist: options.dist, output: options.output, commit: options.commit, version: options.version })
				: command === 'verify'
					? verifyFrontendRelease(options.root, options.sha)
					: command === 'activate'
						? activateFrontendRelease({ source: options.release, target: options.target, manifestSha256: options.sha, replace: options.replace })
						: assert.fail('命令为 pack、verify 或 activate');
		console.log(JSON.stringify({ passed: true, manifestSha256: result.manifestSha256, files: result.fileCount ?? result.files, version: result.manifest?.version ?? result.version }));
	} catch (error) {
		console.error(error.message);
		process.exitCode = 1;
	}
}
