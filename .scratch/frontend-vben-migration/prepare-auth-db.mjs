import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const runtimeRoot = realpathSync(resolve(process.argv[2] ?? ''));
const marker = JSON.parse(readFileSync(join(runtimeRoot, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(dirname(runtimeRoot).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtimeRoot), /^adminnet-vben-[a-f0-9]{32}$/);
assert.equal(marker.runtimeRoot.toLowerCase(), runtimeRoot.toLowerCase());
let running = false;
try {
	process.kill(marker.processId, 0);
	running = true;
} catch (error) {
	if (error.code !== 'ESRCH') throw error;
}
assert.equal(running, false, 'Stop the isolated API before changing fixture data.');
const database = new DatabaseSync(join(runtimeRoot, 'main.db'));
try {
	database.exec('BEGIN');
	for (const [code, value] of [
		['sys_captcha', 'False'],
		['sys_second_ver', 'True'],
		['sys_token_expire', '1'],
		['sys_refresh_token_expire', '3'],
	]) {
		assert.equal(database.prepare('UPDATE SysConfig SET Value = ? WHERE Code = ?').run(value, code).changes, 1);
	}
	database.exec('COMMIT');
	console.log('Isolated authentication fixture prepared: slider enabled, access lifetime 1 minute, refresh lifetime 3 minutes; image captcha tested separately.');
} finally {
	database.close();
}
