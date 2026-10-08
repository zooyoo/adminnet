import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const runtime = realpathSync(resolve(process.argv[2] ?? ''));
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
let running = false;
try { process.kill(marker.processId, 0); running = true; }
catch (error) { if (error.code !== 'ESRCH') throw error; }
assert.equal(running, false, 'Stop the isolated API before preparing fixtures.');
const database = new DatabaseSync(join(runtime, 'main.db'));
try {
	database.exec('BEGIN');
	for (const [code, value] of [
		['sys_captcha', 'False'], ['sys_second_ver', 'False'],
		['sys_single_login', 'False'], ['sys_login_out_reminder', 'True'],
		['sys_token_expire', '1'], ['sys_refresh_token_expire', '10'],
	]) {
		assert.equal(database.prepare('UPDATE SysConfig SET Value = ? WHERE Code = ?').run(value, code).changes, 1);
	}
	function insert(table, row) {
		const fields = Object.keys(row);
		const columns = fields.map((field) => `"${field.replaceAll('"', '""')}"`).join(',');
		database.prepare(`INSERT INTO "${table}" (${columns}) VALUES (${fields.map(() => '?').join(',')})`).run(...Object.values(row));
	}
	const tenant = database.prepare('SELECT * FROM SysTenant ORDER BY Id LIMIT 1').get();
	const user = database.prepare('SELECT * FROM SysUser WHERE Account = ?').get('TestUser3');
	assert.ok(tenant && user);
	const role = database.prepare('SELECT * FROM SysRole ORDER BY Id LIMIT 1').get();
	const membership = database.prepare('SELECT * FROM SysUserRole ORDER BY Id LIMIT 1').get();
	const grant = database.prepare('SELECT * FROM SysRoleMenu ORDER BY Id LIMIT 1').get();
	assert.ok(role && membership && grant);
	const roleId = 1300000990201;
	insert('SysRole', { ...role, Id: roleId, TenantId: tenant.Id, Name: 'isolated-online-read', Code: 'isolated-online-read' });
	insert('SysUserRole', { ...membership, Id: 1300000990202, UserId: user.Id, RoleId: roleId });
	let menu = database.prepare('SELECT * FROM SysMenu WHERE Path = ?').get('/system/pos');
	let grantId = 1300000990210;
	assert.ok(menu);
	while (menu) {
		insert('SysRoleMenu', { ...grant, Id: grantId++, RoleId: roleId, MenuId: menu.Id });
		menu = menu.Pid ? database.prepare('SELECT * FROM SysMenu WHERE Id = ?').get(menu.Pid) : undefined;
	}
	const tenantId = 1300000990001;
	const userId = 1300000990111;
	insert('SysTenant', { ...tenant, Id: tenantId, OrgId: tenantId, UserId: userId, Host: 'isolated-online.invalid', Title: 'isolated-online', Remark: 'isolated-online' });
	const org = database.prepare('SELECT * FROM SysOrg WHERE Id = ?').get(tenant.OrgId);
	if (org) insert('SysOrg', { ...org, Id: tenantId, TenantId: tenantId, Name: 'isolated-online', Code: 'isolated-online', Pid: 0 });
	insert('SysUser', { ...user, Id: userId, TenantId: tenantId, Account: 'OnlineForeign', RealName: 'isolated-online', OrgId: tenantId });
	database.exec('COMMIT');
	console.log('Isolated online fixture prepared: multiple sessions, login reminders, short access tokens and a foreign tenant.');
} finally {
	database.close();
}
