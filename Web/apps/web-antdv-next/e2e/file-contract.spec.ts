import { expect, test } from '@playwright/test';
import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1kAAAAASUVORK5CYII=', 'base64');
const record = { id: 17, fileName: '测试图片', suffix: '.png', fileType: '相关文件', isPublic: false, sizeKb: 1, bucketName: 'Local' };
test.beforeEach(async ({ page }) => {
	await page.route('**/prod-api/api/**', (route) => route.fulfill({ status: 404, json: { message: 'Contract fixture: undeclared API' } }));
	await mockAdminSession(page, 'file');
	await page.route('**/prod-api/api/sysFile/page', (route) => route.fulfill({ json: { code: 200, result: { items: [record], total: 1 } } }));
});
test('上传校验、取消清空及失败保留草稿', async ({ page }) => {
	let uploads = 0;
	await page.route('**/prod-api/api/sysFile/uploadFile', (route) => {
		uploads++;
		return route.fulfill({ status: 503, json: { message: '测试上传失败' } });
	});
	await loginAdmin(page, 'file');
	await page.getByRole('button', { name: '上传文件', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '上传文件', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByRole('alert')).toContainText('请选择有效文件');
	await dialog.locator('input[type=file]').setInputFiles({ name: 'bad.exe', mimeType: 'application/octet-stream', buffer: png });
	await expect(dialog.getByRole('alert')).toContainText('不支持');
	await dialog.locator('input[type=file]').setInputFiles({ name: 'image.png', mimeType: 'image/png', buffer: png });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.locator('.ant-message-error')).toHaveCount(1);
	await expect(dialog.getByText('image.png', { exact: true })).toBeVisible();
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	expect(uploads).toBe(1);
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.getByRole('button', { name: '上传文件', exact: true }).click();
	await expect(dialog.getByText('尚未选择文件', { exact: true })).toBeVisible();
});
test('编辑只发送元数据，失败不丢输入', async ({ page }) => {
	await page.route('**/prod-api/api/sysFile/update', (route) => {
		const data = route.request().postDataJSON();
		expect(Object.keys(data).sort()).toEqual(['fileName', 'fileType', 'id', 'isPublic']);
		expect(data.fileName).toBe('保留草稿');
		return route.fulfill({ json: { code: 400, message: '保存失败' } });
	});
	await loginAdmin(page, 'file');
	await page.getByRole('button', { name: '编辑', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '编辑文件', exact: true });
	await dialog.getByLabel('文件名称', { exact: true }).fill('保留草稿');
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.locator('.ant-message-error')).toHaveCount(1);
	await expect(dialog.getByLabel('文件名称', { exact: true })).toHaveValue('保留草稿');
});
test('下载二进制业务鉴权错误只提示一次', async ({ page }) => {
	await page.route('**/prod-api/api/sysFile/downloadFile', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 403, message: '没有文件权限' }) }));
	await loginAdmin(page, 'file');
	await page.getByRole('button', { name: '下载', exact: true }).click();
	await expect(page.locator('.ant-message-error')).toHaveCount(1);
	await expect(page.locator('.ant-message-error')).toContainText('没有文件权限');
});
test('私有图片使用带认证请求，关闭预览释放对象地址', async ({ page }) => {
	await page.addInitScript(() => {
		const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
		const active = new Set<string>();
		Object.assign(window, { previewUrls: active });
		URL.createObjectURL = (blob) => { const url = create(blob); active.add(url); return url; };
		URL.revokeObjectURL = (url) => { active.delete(url); return revoke(url); };
	});
	await page.route('**/prod-api/api/sysFile/downloadFile', (route) => {
		expect(route.request().headers().authorization).toMatch(/^Bearer /);
		expect(route.request().postDataJSON()).toEqual({ id: 17 });
		return route.fulfill({ contentType: 'application/octet-stream', body: png });
	});
	await loginAdmin(page, 'file');
	await page.getByRole('button', { name: '预览', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '测试图片.png', exact: true });
	await expect.poll(() => dialog.locator('img').evaluate((image) => image.naturalWidth)).toBeGreaterThan(0);
	await dialog.getByRole('button', { name: '关闭', exact: true }).click();
	await expect.poll(() => page.evaluate(() => (window as unknown as { previewUrls: Set<string> }).previewUrls.size)).toBe(0);
});
test('只读权限隐藏上传、编辑、删除和读取按钮', async ({ page }) => {
	await mockAdminSession(page, 'file', { readOnly: true });
	await loginAdmin(page, 'file');
	for (const name of ['上传文件', '编辑', '删除', '预览', '下载']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
});
test('关闭上传后迟到成功不能关闭新草稿', async ({ page }) => {
	let finish!: () => void;
	await page.route('**/prod-api/api/sysFile/uploadFile', async (route) => {
		await new Promise<void>((resolve) => { finish = resolve; });
		await route.fulfill({ json: { code: 200, result: record } }).catch(() => {});
	});
	await loginAdmin(page, 'file');
	await page.getByRole('button', { name: '上传文件', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '上传文件', exact: true });
	await dialog.locator('input[type=file]').setInputFiles({ name: 'first.png', mimeType: 'image/png', buffer: png });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect.poll(() => !!finish).toBe(true);
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	await page.getByRole('button', { name: '上传文件', exact: true }).click();
	await dialog.locator('input[type=file]').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: png });
	finish();
	await expect(dialog.getByText('second.png', { exact: true })).toBeVisible();
	await expect(page.locator('.ant-message-success')).toHaveCount(0);
});
