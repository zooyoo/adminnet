import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

const rootMenu = {
	id: 10,
	title: '用户管理',
	type: 2,
	name: 'users',
	path: '/users',
	component: '/system/user/index',
	status: 1,
	children: [
		{ id: 11, title: '查看用户', type: 3, permission: 'sysUser:page', status: 1 },
		{ id: 12, title: '编辑用户', type: 3, permission: 'sysUser:update', status: 1 },
	],
};
const orgs = [
	{
		id: 1,
		name: '总部',
		code: 'HQ',
		tenantId: 1,
		pid: 0,
		level: 1,
		type: 'company',
		status: 1,
		children: [{ id: 2, name: '研发部', code: 'DEV', tenantId: 1, pid: 1, level: 2, type: 'department', status: 1 }],
	},
];
const roles = [{ id: 1, name: '部门管理员', code: 'dept_admin', tenantId: 1, status: 1, dataScope: 5, orderNo: 100 }];

async function login(page: Page, module: 'role' | 'menu' | 'org', readOnly = false, extraPermissions: string[] = []) {
	await page.route('**/prod-api/**', (route) => route.fulfill({ status: 503, json: { message: 'Contract fixture: endpoint not declared' } }));
	await page.route('**/prod-api/api/sysNotice/unReadList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	const accessToken = `head.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 600 })).toString('base64url')}.signature`;
	await page.route('**/prod-api/api/sysConfig/sysInfo', (route) =>
		route.fulfill({ json: { code: 200, result: { title: 'Admin.NET', captcha: 2, secondVer: 2, hideTenantForLogin: true, enableReg: 2 } } })
	);
	await page.route('**/prod-api/api/sysAuth/login', (route) => route.fulfill({ json: { code: 200, result: { accessToken, refreshToken: 'refresh', homepage: `/system/${module}` } } }));
	const prefix = `sys${module[0]!.toUpperCase()}${module.slice(1)}`;
	await page.route('**/prod-api/api/sysAuth/userInfo', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					id: 1,
					account: 'contract',
					realName: '测试用户',
					accountType: 777,
					roleIds: [1],
					tenantId: 1,
					currentTenantId: 1,
					buttons: [...(readOnly ? ['page', 'list'] : ['page', 'list', 'add', 'update', 'delete', 'setStatus', 'grantDataScope']).map((action) => `${prefix}:${action}`), ...extraPermissions],
				},
			},
		})
	);
	await page.route('**/prod-api/api/sysMenu/vbenMenuTree', (route) =>
		route.fulfill({ json: { code: 200, result: [{ name: prefix, path: `/system/${module}`, component: `/system/${module}/index`, meta: { title: '权限管理', icon: 'ele-Setting' } }] } })
	);
	await page.route('**/prod-api/api/sysMenu/list**', (route) => route.fulfill({ json: { code: 200, result: [rootMenu] } }));
	await page.route('**/prod-api/api/sysOrg/list**', (route) => route.fulfill({ json: { code: 200, result: orgs } }));
	await page.route('**/prod-api/api/sysOrg/tree**', (route) => route.fulfill({ json: { code: 200, result: orgs } }));
	await page.route('**/prod-api/api/sysRole/page', (route) => route.fulfill({ json: { code: 200, result: { items: roles, total: 1 } } }));
	await page.route('**/prod-api/api/sysRole/ownMenuList**', (route) => route.fulfill({ json: { code: 200, result: [11] } }));
	await page.route('**/prod-api/api/sysRole/ownOrgList**', (route) => route.fulfill({ json: { code: 200, result: [2] } }));
	await page.route('**/prod-api/api/sysDictType/allDictList', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: {
					org_type: [
						{ label: '公司', value: 'company' },
						{ label: '部门', value: 'department' },
					],
				},
			},
		})
	);
	await page.goto('/#/auth/login', { waitUntil: 'networkidle' });
	await page.getByLabel('账号', { exact: true }).fill('contract');
	await page.getByLabel('密码', { exact: true }).fill('contract-password');
	await page.locator('button[type=submit]').click();
	await expect(page).toHaveURL(new RegExp(`#\\/system\\/${module}$`));
}

function treeCheckbox(container: Locator, title: string) {
	return container
		.locator('.ant-tree-treenode')
		.filter({
			has: container
				.page()
				.locator('.ant-tree-title')
				.filter({ hasText: new RegExp(`^${title}$`) }),
		})
		.locator('.ant-tree-checkbox');
}

test('role edit preserves partial menu selection and can revoke every menu', async ({ page }, testInfo) => {
	await login(page, 'role');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/prod-api/api/sysRole/update', (route) => route.fulfill({ json: { code: 200, result: null } }));
	await page.getByRole('button', { name: '编辑角色', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(treeCheckbox(dialog, '查看用户')).toHaveClass(/ant-tree-checkbox-checked/);
	await expect(treeCheckbox(dialog, '编辑用户')).not.toHaveClass(/ant-tree-checkbox-checked/);
	await expect(treeCheckbox(dialog, '用户管理')).toHaveClass(/indeterminate/);
	expect(
		await dialog.getByRole('button', { name: /^确\s*定$/ }).evaluate((button) => {
			const rect = button.getBoundingClientRect();
			return rect.top >= 0 && rect.bottom <= innerHeight;
		})
	).toBe(true);
	await dialog.getByLabel('角色名称', { exact: true }).fill('更新角色');
	const [save] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysRole/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(save.postDataJSON()).toMatchObject({ id: 1, name: '更新角色', menuIdList: [11] });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '编辑角色', exact: true }).click();
	await expect(treeCheckbox(dialog, '查看用户')).toHaveClass(/ant-tree-checkbox-checked/);
	await treeCheckbox(dialog, '查看用户').click();
	const [revoke] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysRole/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(revoke.postDataJSON().menuIdList).toEqual([]);
	await expect(dialog).toBeHidden();
	expect(errors).toEqual([]);
	await page.screenshot({ path: testInfo.outputPath('role.png'), fullPage: true });
});

test('selecting a parent grants both children and clearing it revokes all', async ({ page }) => {
	await login(page, 'role');
	await page.route('**/prod-api/api/sysRole/update', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑角色', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(treeCheckbox(dialog, '用户管理')).toHaveClass(/indeterminate/);
	await treeCheckbox(dialog, '用户管理').click();
	await expect(treeCheckbox(dialog, '查看用户')).toHaveClass(/checkbox-checked/);
	await expect(treeCheckbox(dialog, '编辑用户')).toHaveClass(/checkbox-checked/);
	const saving = page.waitForRequest((request) => request.url().endsWith('/sysRole/update'));
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	expect((await saving).postDataJSON().menuIdList.sort()).toEqual([10, 11, 12]);
	await expect(dialog).toBeHidden();
	await page.route('**/prod-api/api/sysRole/ownMenuList**', (route) => route.fulfill({ json: { code: 200, result: [10, 11, 12] } }));
	await page.getByRole('button', { name: '编辑角色', exact: true }).click();
	await expect(treeCheckbox(dialog, '用户管理')).toHaveClass(/checkbox-checked/);
	await treeCheckbox(dialog, '用户管理').click();
	const clearing = page.waitForRequest((request) => request.url().endsWith('/sysRole/update'));
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	expect((await clearing).postDataJSON().menuIdList).toEqual([]);
});

test('role data scope loads checked organizations and drops them for non-custom scope', async ({ page }) => {
	await login(page, 'role');
	await page.route('**/prod-api/api/sysRole/grantDataScope', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '数据范围', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(treeCheckbox(dialog, '研发部')).toHaveClass(/ant-tree-checkbox-checked/);
	const [custom] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/grantDataScope')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(custom.postDataJSON().orgIdList).toContain(2);
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '数据范围', exact: true }).click();
	await dialog.getByLabel('数据范围', { exact: true }).click();
	await page.getByRole('option', { name: '本部门数据', exact: true }).click();
	const [scoped] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/grantDataScope')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(scoped.postDataJSON()).toEqual({ id: 1, dataScope: 3, orgIdList: [] });
});

test('failed permission loading blocks role saving instead of submitting empty grants', async ({ page }) => {
	await login(page, 'role');
	await page.route('**/prod-api/api/sysRole/ownMenuList**', (route) => route.fulfill({ status: 500, json: { message: '权限加载失败' } }));
	await page.getByRole('button', { name: '编辑角色', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByRole('alert')).toContainText('权限加载失败');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeDisabled();
});

test('organization parent picker excludes self and descendants; copying preserves fields', async ({ page }, testInfo) => {
	await login(page, 'org');
	const headquarters = page.locator('.admin-table tr[data-row-key="1"]');
	await expect(headquarters.getByText('总部', { exact: true })).toBeVisible();
	await headquarters.getByRole('button', { name: '编辑机构' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('上级机构', { exact: true }).click();
	await expect(page.locator('.ant-select-dropdown').getByText('根节点', { exact: true })).toBeVisible();
	await expect(page.locator('.ant-select-dropdown').getByText('总部', { exact: true })).toHaveCount(0);
	await expect(page.locator('.ant-select-dropdown').getByText('研发部', { exact: true })).toHaveCount(0);
	await dialog.getByLabel('机构名称', { exact: true }).click();
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await headquarters.getByRole('button', { name: '复制机构' }).click();
	await expect(dialog.getByLabel('机构名称', { exact: true })).toHaveValue('');
	await expect(dialog.getByLabel('机构编码', { exact: true })).toHaveValue('HQ');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(dialog).toBeHidden();
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('org.png'), fullPage: true });
});

test('menu editor supports button permissions and retains runtime UI flags', async ({ page }, testInfo) => {
	await login(page, 'menu');
	await page.route('**/prod-api/api/sysMenu/update', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('row').filter({ hasText: '用户管理' }).getByRole('button', { name: '编辑菜单' }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('缓存页面', { exact: true }).click();
	await dialog.getByLabel('隐藏菜单', { exact: true }).click();
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysMenu/update')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(saved.postDataJSON()).toMatchObject({ id: 10, type: 2, isHide: true, isKeepAlive: false });
	await expect(dialog).toBeHidden();
	await page.getByRole('button', { name: '新增菜单', exact: true }).click();
	await dialog.getByText('按钮', { exact: true }).click();
	await expect(dialog.getByLabel('权限标识', { exact: true })).toBeVisible();
	await expect(dialog.getByLabel('组件路径', { exact: true })).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('menu.png'), fullPage: true });
	await page.route('**/prod-api/api/sysMenu/add', (route) => route.fulfill({ json: { code: 200, result: 13 } }));
	await dialog.getByLabel('菜单名称', { exact: true }).fill('删除用户');
	await dialog.getByLabel('权限标识', { exact: true }).fill('sysUser:delete');
	const [added] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysMenu/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(added.postDataJSON()).toMatchObject({ title: '删除用户', permission: 'sysUser:delete', type: 3 });
	await expect(dialog).toBeHidden();
});

for (const module of ['role', 'menu', 'org'] as const) {
	test(`${module} read-only permissions hide all mutation controls`, async ({ page }) => {
		await login(page, module, true);
		await expect(page.locator('.admin-table tbody tr[data-row-key]').first()).toBeVisible();
		await expect(page.getByRole('button', { name: /新增|编辑角色|删除角色|编辑机构|删除机构|复制机构|编辑菜单|删除菜单|复制菜单/ })).toHaveCount(0);
		await expect(page.getByRole('switch')).toHaveCount(0);
	});
}

test('role mutation failures keep the authoritative state and editable draft', async ({ page }) => {
	await login(page, 'role');
	const errors: string[] = [];
	page.on('pageerror', (error) => errors.push(error.message));
	await page.route('**/prod-api/api/sysRole/setStatus', (route) => route.fulfill({ json: { code: 400, message: '状态修改被拒绝' } }));
	const status = page.getByRole('switch', { name: '切换部门管理员状态' });
	await status.click();
	await expect(page.getByText('状态修改被拒绝', { exact: true }).first()).toBeVisible();
	await expect(status).toBeChecked();
	await page.route('**/prod-api/api/sysRole/update', (route) => route.fulfill({ json: { code: 400, message: '角色编码重复' } }));
	await page.getByRole('button', { name: '编辑角色', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await expect(treeCheckbox(dialog, '查看用户')).toHaveClass(/ant-tree-checkbox-checked/);
	await dialog.getByLabel('角色名称', { exact: true }).fill('保留编辑内容');
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByText('角色编码重复', { exact: true }).first()).toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(dialog.getByLabel('角色名称', { exact: true })).toHaveValue('保留编辑内容');
	expect(errors).toEqual([]);
});

test('menu translations use the existing entity and language API contracts', async ({ page }) => {
	await login(page, 'menu', false, ['sysLangText:batchSave']);
	await page.route('**/prod-api/api/sysLang/dropdownData', (route) =>
		route.fulfill({
			json: {
				code: 200,
				result: [
					{ code: 'zh-CN', value: 'zh-CN', label: '中文' },
					{ code: 'en', value: 'en-US', label: 'English' },
				],
			},
		})
	);
	await page.route('**/prod-api/api/sysLangText/list', (route) => route.fulfill({ json: { code: 200, result: [{ langCode: 'en', content: 'Users' }] } }));
	await page.route('**/prod-api/api/sysLangText/batchSave', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '编辑菜单', exact: true }).click();
	const menu = page.getByRole('dialog', { name: '编辑菜单' });
	await menu.getByRole('button', { name: '多语言设置', exact: true }).click();
	const translation = page.getByRole('dialog', { name: '多语言设置' });
	await expect(translation.getByRole('button', { name: 'AI 翻译', exact: true })).toHaveCount(0);
	await expect(translation.getByLabel('English', { exact: true })).toHaveValue('Users');
	await translation.getByLabel('English', { exact: true }).fill('User Management');
	const [saved] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysLangText/batchSave')), translation.getByRole('button', { name: '确认修改', exact: true }).click()]);
	expect(saved.postDataJSON()).toContainEqual({ entityName: 'SysMenu', entityId: 10, fieldName: 'Title', langCode: 'en', content: 'User Management' });
	await expect(translation).toBeHidden();
	await expect(menu.getByLabel('菜单名称', { exact: true })).toHaveValue('用户管理');
});

test('organization create/delete preserve their API contracts', async ({ page }) => {
	await login(page, 'org');
	await page.route('**/prod-api/api/sysOrg/add', (route) => route.fulfill({ json: { code: 200, result: 3 } }));
	await page.route('**/prod-api/api/sysOrg/delete', (route) => route.fulfill({ json: { code: 200 } }));
	await page.getByRole('button', { name: '新增机构', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('机构名称', { exact: true }).fill('新部门');
	await dialog.getByLabel('机构编码', { exact: true }).fill('NEW');
	const [created] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysOrg/add')), dialog.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(created.postDataJSON()).toMatchObject({ name: '新部门', code: 'NEW', pid: 0, status: 1, orderNo: 100 });
	expect(new URL(created.url()).pathname).toBe('/prod-api/api/sysOrg/add');
	await expect(dialog).toBeHidden();
	await page.locator('.admin-table tr[data-row-key="2"]').getByRole('button', { name: '删除机构' }).click();
	const [removed] = await Promise.all([page.waitForRequest((req) => req.url().endsWith('/sysOrg/delete')), page.getByRole('button', { name: /^确\s*定$/ }).click()]);
	expect(removed.postDataJSON()).toEqual({ id: 2 });
});
