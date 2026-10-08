import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const password = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8')
	.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
const db = new DatabaseSync(join(runtime, 'main.db'), { readOnly: true });
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL(marker.baseUrl));
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(20_000);
const report = { passed: false, proposalComplete: false, steps: [] };
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let session;
const prefix = `browser06-${Date.now()}`;
const step = (name) => { report.steps.push(name); console.log(name); };
const byCode = (table, code) => db.prepare(`SELECT * FROM ${table} WHERE Code = ?`).get(code);
const userRow = (account) => db.prepare('SELECT * FROM SysUser WHERE Account = ?').get(account);
async function cleanupFixtures() {
	for (const account of [`${prefix}-copy`, prefix]) {
		const user = userRow(account);
		if (user) await api('sysUser/delete', { id: user.Id });
	}
	const pos = byCode('SysPos', prefix);
	const extra = byCode('SysOrg', `${prefix}-extra`);
	if (extra) await api('sysOrg/delete', { id: extra.Id });
	if (pos) await api('sysPos/delete', { id: pos.Id });
	const org = byCode('SysOrg', prefix);
	if (org) await api('sysOrg/delete', { id: org.Id });
	assert.equal(userRow(prefix), undefined);
	assert.equal(userRow(`${prefix}-copy`), undefined);
	assert.equal(byCode('SysOrg', prefix), undefined);
	assert.equal(byCode('SysPos', prefix), undefined);
	report.cleanupPassed = true;
}
async function api(path, data) {
	const response = await context.request.post(`${proxy.baseUrl}/prod-api/api/${path}`, {
		headers: { Authorization: `Bearer ${session.accessToken}`, 'X-Authorization': `Bearer ${session.refreshToken}` }, data,
	});
	if (response.headers()['access-token']) {
		session.accessToken = response.headers()['access-token'];
		session.refreshToken = response.headers()['x-access-token'] ?? session.refreshToken;
	}
	const result = await response.json();
	assert.equal(result.code, 200, `${path}: code=${result.code}`);
	return result.result;
}
async function save(dialog, endpoint, code = 200) {
	const [response] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith(`/api/${endpoint}`)),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	assert.equal((await response.json()).code, code);
	if (code === 200) await expect(dialog).toBeHidden();
}
async function pick(dialog, label, title, tree = false) {
	const input = dialog.getByLabel(label, { exact: true });
	await input.click();
	const option = tree
		? page.locator('.ant-select-dropdown:visible').last().locator('.ant-select-tree-title').filter({ hasText: new RegExp(`^${title}$`) })
		: page.getByRole('option', { name: title, exact: true });
	await option.click();
	await expect(input).toHaveAttribute('aria-expanded', 'false');
	await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
}
async function screenshot(name) {
	await expect(page.locator('.ant-message-notice')).toHaveCount(0, { timeout: 20_000 });
	await page.locator('.ant-table-content, .ant-table-body').evaluateAll((elements) => elements.forEach((element) => { element.scrollLeft = 0; }));
	await page.screenshot({ path: join(evidence, name), fullPage: true });
}
async function search(account) {
	await page.getByLabel('账号', { exact: true }).fill(account);
	await page.getByRole('button', { name: /^查\s*询$/ }).click();
	await expect(page.locator(`tr[data-row-key="${userRow(account).Id}"]`)).toBeVisible();
}
async function more(row, title) {
	await row.getByRole('button', { name: '更多账号操作' }).click();
	await page.getByRole('menuitem', { name: title, exact: true }).click();
}
async function fillUser(dialog, account, phone, orgName, posName) {
	await dialog.getByLabel('账号名称', { exact: true }).fill(account);
	await dialog.getByLabel('手机号码', { exact: true }).fill(phone);
	await dialog.getByLabel('真实姓名', { exact: true }).fill('桌面真实用户');
	await pick(dialog, '所属机构', orgName, true);
	await pick(dialog, '职位', posName);
}
try {
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Forg`);
	await expect(page.locator('button[type=submit]')).toBeEnabled();
	await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
	await page.getByLabel('密码', { exact: true }).fill(password);
	const [response] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith('/sysAuth/login')),
		page.locator('button[type=submit]').click(),
	]);
	const result = await response.json();
	assert.equal(result.code, 200);
	session = result.result;
	await expect(page).toHaveURL(/#\/system\/org$/);
	await page.getByRole('button', { name: '新增机构', exact: true }).click();
	let dialog = page.getByRole('dialog', { name: '添加机构', exact: true });
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await dialog.getByLabel('机构名称', { exact: true }).fill(prefix);
	await dialog.getByLabel('机构编码', { exact: true }).fill(prefix);
	await save(dialog, 'sysOrg/add');
	const org = byCode('SysOrg', prefix);
	assert.ok(org);
	await page.locator(`tr[data-row-key="${org.Id}"]`).getByRole('button', { name: '编辑机构' }).click();
	dialog = page.getByRole('dialog', { name: '编辑机构', exact: true });
	await dialog.getByLabel('备注', { exact: true }).fill('真实桌面机构资料');
	await save(dialog, 'sysOrg/update');
	assert.equal(byCode('SysOrg', prefix).Remark, '真实桌面机构资料');
	await page.reload();
	await expect(page.locator(`tr[data-row-key="${org.Id}"]`)).toBeVisible();
	await screenshot('org-desktop-real.png');
	step('production-desktop-real-organization-create-edit-refresh');
	await api('sysPos/add', { name: prefix, code: prefix, tenantId: org.TenantId, status: 1 });
	const pos = byCode('SysPos', prefix);
	const extraId = await api('sysOrg/add', { name: `${prefix}-extra`, code: `${prefix}-extra`, pid: org.Id, tenantId: org.TenantId });

	await page.goto(`${proxy.baseUrl}/#/system/user`);
	await page.getByRole('button', { name: '新增账号', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '添加账号', exact: true });
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByText('请输入账号名称', { exact: true })).toBeVisible();
	assert.equal(userRow(prefix), undefined);
	await fillUser(dialog, prefix, `139${Date.now().toString().slice(-8)}`, prefix, prefix);
	await dialog.getByLabel('工号', { exact: true }).fill('WEB06');
	await dialog.getByRole('button', { name: '增加附属机构' }).click();
	await pick(dialog, '附属机构 1', `${prefix}-extra`, true);
	await pick(dialog, '附属职位 1', prefix);
	await dialog.getByRole('tab', { name: '角色授权' }).click();
	await dialog.locator('.role-transfer input:not([type="checkbox"])').first().fill('isolated-online-read');
	await dialog.getByText('isolated-online-read', { exact: true }).click();
	await dialog.locator('.ant-transfer-actions button').first().click();
	await dialog.getByRole('tab', { name: '档案信息' }).click();
	await dialog.getByLabel('紧急联系人', { exact: true }).fill('桌面联系人');
	await dialog.getByLabel('备注', { exact: true }).fill('桌面资料');
	await save(dialog, 'sysUser/add');
	const employee = userRow(prefix);
	assert.equal(employee.JobNum, 'WEB06');
	assert.equal(employee.EmergencyContact, '桌面联系人');
	assert.equal(db.prepare('SELECT OrgId FROM SysUserExtOrg WHERE UserId = ?').get(employee.Id).OrgId, extraId);
	await search(prefix);
	let row = page.locator(`tr[data-row-key="${employee.Id}"]`);
	await row.getByRole('button', { name: '编辑账号', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '编辑账号', exact: true });
	await expect(dialog.getByLabel('工号', { exact: true })).toHaveValue('WEB06');
	await dialog.getByRole('tab', { name: '角色授权' }).click();
	await dialog.getByText('isolated-online-read', { exact: true }).click();
	await dialog.locator('.ant-transfer-actions button').last().click();
	await screenshot('user-desktop-role-revocation.png');
	await save(dialog, 'sysUser/update');
	assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUserRole WHERE UserId = ?').get(employee.Id).n, 0);
	step('production-desktop-user-validation-profile-assignments-and-empty-roles');

	await more(row, '复制账号');
	dialog = page.getByRole('dialog', { name: '复制账号', exact: true });
	await expect(dialog.getByLabel('账号名称', { exact: true })).toHaveValue('');
	await expect(dialog.getByLabel('附属机构 1', { exact: true })).toBeVisible();
	await dialog.getByLabel('账号名称', { exact: true }).fill(prefix);
	await save(dialog, 'sysUser/add', 400);
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('账号名称', { exact: true })).toHaveValue(prefix);
	await dialog.getByLabel('账号名称', { exact: true }).fill(`${prefix}-copy`);
	await dialog.getByLabel('手机号码', { exact: true }).fill(`138${Date.now().toString().slice(-8)}`);
	await save(dialog, 'sysUser/add');
	const copied = userRow(`${prefix}-copy`);
	assert.ok(copied && copied.Id !== employee.Id);
	assert.equal(db.prepare('SELECT OrgId FROM SysUserExtOrg WHERE UserId = ?').get(copied.Id).OrgId, extraId);
	await search(prefix);
	row = page.locator(`tr[data-row-key="${employee.Id}"]`);
	await row.getByRole('switch').click();
	await expect.poll(() => userRow(prefix).Status).toBe(2);
	await row.getByRole('switch').click();
	await expect.poll(() => userRow(prefix).Status).toBe(1);
	await more(row, '重置密码');
	await page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByLabel('重置后的密码')).not.toHaveValue('');
	await page.getByRole('dialog', { name: '密码重置成功' }).getByRole('button', { name: /关闭|Close/ }).click();
	await more(row, '解除登录锁定');
	const [unlockResponse] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith('/sysUser/unlockLogin')),
		page.getByRole('dialog').getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	assert.equal((await unlockResponse.json()).code, 200);
	await screenshot('user-desktop-real.png');
	step('production-desktop-copy-duplicate-draft-status-reset-password-and-unlock');

	for (const id of [copied.Id, employee.Id]) {
		await page.locator(`tr[data-row-key="${id}"]`).getByRole('button', { name: '删除账号', exact: true }).click();
		const [deleted] = await Promise.all([
			page.waitForResponse((item) => item.url().endsWith('/sysUser/delete')),
			page.getByRole('button', { name: /^确\s*定$/ }).click(),
		]);
		assert.equal((await deleted.json()).code, 200);
		assert.equal(db.prepare('SELECT COUNT(*) AS n FROM SysUser WHERE Id = ?').get(id).n, 0);
	}
	await page.reload();
	await expect(page.getByRole('button', { name: '新增账号', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '新增账号', exact: true }).click();
	dialog = page.getByRole('dialog', { name: '添加账号', exact: true });
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	await fillUser(dialog, `${prefix}-outage`, `137${Date.now().toString().slice(-8)}`, prefix, prefix);
	await cleanupFixtures();
	execFileSync('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true, stdio: 'pipe', timeout: 30_000 });
	const [failure] = await Promise.all([
		page.waitForResponse((item) => item.url().endsWith('/sysUser/add')),
		dialog.getByRole('button', { name: /^确\s*定$/ }).click(),
	]);
	assert.equal(failure.status(), 502);
	await expect(page.getByText('请求失败（502）', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('账号名称', { exact: true })).toHaveValue(`${prefix}-outage`);
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	assert.equal(userRow(`${prefix}-outage`), undefined);
	await dialog.locator('.ant-modal-body').evaluate((element) => { element.scrollTop = 0; });
	await page.screenshot({ path: join(evidence, 'user-desktop-service-outage.png'), fullPage: true });
	assert.deepEqual(errors, []);
	step('production-desktop-delete-refresh-and-real-service-outage-draft-preservation');
	report.passed = true;
} catch (error) {
	report.transferDom = await page.locator('.role-transfer').evaluate((element) => ({
		inputs: [...element.querySelectorAll('input')].map((input) => ({ type: input.type, role: input.getAttribute('role'), placeholder: input.placeholder, class: input.className })),
		sections: [...element.children].map((child) => ({ class: child.className, text: child.textContent?.slice(0, 250) })),
	})).catch(() => undefined);
	console.log(JSON.stringify(report.transferDom));
	report.error = error.message.replace(/eyJ[A-Za-z0-9_.-]+/g, '[redacted-token]');
	process.exitCode = 1;
	await page.getByLabel('密码', { exact: true }).fill('', { timeout: 1000 }).catch(() => {});
	// 密码重置弹窗含临时凭据，失败截图之前先关闭。
	await page.getByRole('dialog', { name: '密码重置成功' }).getByRole('button', { name: /关闭|Close/ }).click({ timeout: 1000 }).catch(() => {});
	await page.screenshot({ path: join(evidence, 'user-browser-failure.png'), fullPage: true }).catch(() => {});
	console.error(report.error);
} finally {
	if (session && !report.cleanupPassed) {
		await cleanupFixtures().catch(() => { report.cleanupPassed = false; });
	}
	writeFileSync(join(evidence, 'user-browser-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	await context.close();
	await browser.close();
	await proxy.close();
	db.close();
}
