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
	const result = database.prepare("UPDATE SysConfig SET Value = 'False' WHERE Code = 'sys_captcha'").run();
	assert.equal(result.changes, 1, 'Exactly one isolated captcha setting must change.');
	const position = database.prepare('SELECT * FROM SysPos ORDER BY Id LIMIT 1').get();
	assert.ok(position, 'A seeded position must exist.');
	const foreignPosition = {
		...position,
		Id: 1300000990901,
		TenantId: 1300000990001,
		Name: 'isolated-foreign-position',
		Code: 'isolated-foreign-position',
		CreateUserId: 1300000000111,
	};
	const columns = Object.keys(foreignPosition);
	const quotedColumns = columns.map((column) => `"${column.replaceAll('"', '""')}"`).join(', ');
	database.prepare(`INSERT INTO SysPos (${quotedColumns}) VALUES (${columns.map(() => '?').join(', ')})`)
		.run(...Object.values(foreignPosition));
	console.log('Isolated CRUD fixture prepared; captcha disabled only for this CRUD scenario.');
} finally {
	database.close();
}
