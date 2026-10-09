import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const profile = {
	id: 10, account: 'contract', realName: '测试用户', nickName: '原昵称', phone: '13800000000', email: 'user@example.test',
	birthday: '2000-01-02', sex: 1, langCode: 'zh-CN', homepage: '/system/cache', address: '测试地址', remark: '原备注',
};

test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'cache');
	await page.route('**/prod-api/api/sysAuth/userInfo', (route) => route.fulfill({ json: { code: 200, result: {
		id: 10, account: 'contract', realName: '测试用户', accountType: 777, tenantId: 1, currentTenantId: 1,
		roleIds: [1], buttons: ['sysCache:keyList', 'sysUser:baseInfo', 'sysUser:changePwd', 'sysFile:uploadAvatar', 'sysFile:uploadSignature'],
		watermarkText: '测试租户-测试用户',
	} } }));
	await page.route('**/prod-api/api/sysCache/keyList', (route) => route.fulfill({ json: { code: 200, result: [] } }));
	await page.route('**/prod-api/api/sysUser/baseInfo', (route) => route.fulfill({ json: { code: 200, result: profile } }));
	await page.route('**/prod-api/api/sysLang/dropdownData', (route) => route.fulfill({ json: { code: 200, result: [{ label: '中文', code: 'zh-CN' }, { label: 'English', code: 'en-US' }] } }));
	await page.route('**/prod-api/api/sysAuth/logout', (route) => route.fulfill({ json: { code: 200, result: null } }));
});

test('真实字段保存失败保留草稿且不显示上游角色编辑', async ({ page }) => {
	await loginAdmin(page, 'cache');
	await page.goto('/#/profile');
	await expect(page.getByLabel('真实姓名', { exact: true })).toHaveValue(profile.realName);
	await expect(page.getByLabel('角色', { exact: true })).toHaveCount(0);
	await page.route('**/prod-api/api/sysUser/baseInfo', (route) => route.request().method() === 'POST'
		? route.fulfill({ json: { code: 400, message: '资料保存失败' } })
		: route.fulfill({ json: { code: 200, result: profile } }));
	await page.getByLabel('真实姓名', { exact: true }).fill('保留的姓名');
	await page.getByRole('button', { name: '保存基本信息', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确定修改个人基础信息？' });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByRole('alert')).toContainText('资料保存失败');
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await expect(page.getByLabel('真实姓名', { exact: true })).toHaveValue('保留的姓名');
});

test('个人资料加载失败禁止提交', async ({ page }) => {
	await page.route('**/prod-api/api/sysUser/baseInfo', (route) => route.fulfill({ status: 503, json: { message: '资料不可用' } }));
	await loginAdmin(page, 'cache');
	await page.goto('/#/profile');
	await expect(page.getByRole('button', { name: '重新加载', exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '保存基本信息', exact: true })).toHaveCount(0);
});

test('密码修改必须调用真实合同并加密，失败不能提示成功', async ({ page }) => {
	let calls = 0;
	await page.route('**/prod-api/api/sysUser/changePwd', (route) => {
		calls++;
		const data = route.request().postDataJSON();
		expect(data.passwordOld).toMatch(/^[\da-f]{192,}$/i);
		expect(data.passwordNew).toMatch(/^[\da-f]{192,}$/i);
		return route.fulfill({ json: { code: 400, message: '原密码错误' } });
	});
	await loginAdmin(page, 'cache');
	await page.goto('/#/profile');
	await page.getByRole('tab', { name: '修改密码', exact: true }).click();
	await page.getByLabel('当前密码', { exact: true }).fill('old-secret');
	await page.getByLabel('新密码', { exact: true }).fill('new-secret');
	await page.getByLabel('确认密码', { exact: true }).fill('different');
	await page.getByRole('button', { name: '修改密码', exact: true }).click();
	await expect(page.locator('#app').getByRole('alert').filter({ hasText: '两次输入的密码不一致' })).toBeVisible();
	expect(calls).toBe(0);
	await page.getByLabel('确认密码', { exact: true }).fill('new-secret');
	await page.getByRole('button', { name: '修改密码', exact: true }).click();
	await expect(page.locator('#app').getByRole('alert').filter({ hasText: '原密码错误' })).toBeVisible();
	expect(calls).toBe(1);
	await expect(page).toHaveURL(/#\/profile$/);
});

test('头像裁剪取消不上传，组织页使用真实查询合同', async ({ page }) => {
	let uploads = 0;
	await page.route('**/prod-api/api/sysFile/uploadAvatar', (route) => { uploads++; return route.fulfill({ json: { code: 200, result: {} } }); });
	await page.route('**/prod-api/api/sysUser/orgInfo', (route) => route.fulfill({ json: { code: 200, result: [{ id: 1, name: '真实组织', children: [] }] } }));
	await loginAdmin(page, 'cache');
	await page.goto('/#/profile');
	const chooser = page.waitForEvent('filechooser');
	await page.getByRole('button', { name: '更换头像', exact: true }).click();
	await (await chooser).setFiles({ name: 'test.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=', 'base64') });
	const dialog = page.getByRole('dialog', { name: '更换头像' });
	await expect(dialog).toBeVisible();
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	expect(uploads).toBe(0);
	await page.getByRole('tab', { name: '组织机构', exact: true }).click();
	await expect(page.getByRole('tree')).toContainText('真实组织');
});
