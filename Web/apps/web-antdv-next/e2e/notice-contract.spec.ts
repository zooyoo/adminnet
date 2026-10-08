import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

test.beforeEach(async ({ page }) => {
	await mockAdminSession(page, 'notice');
	await page.route('**/prod-api/api/sysNotice/page', (route) =>
		route.fulfill({
			json: { code: 200, result: { total: 1, items: [{ id: '101', title: '隔离通知', content: '测试内容', type: 1, status: 0, createUserId: 10 }] } },
		})
	);
});

test('notice publishing requires confirmation and cancellation sends nothing', async ({ page }) => {
	const published: unknown[] = [];
	await page.route('**/prod-api/api/sysNotice/public', (route) => {
		published.push(route.request().postDataJSON());
		return route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'notice');
	await expect(page.getByRole('cell', { name: '隔离通知', exact: true })).toBeVisible();
	await page.getByRole('button', { name: '发布通知', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '确定发布通知？发布后不可撤销' });
	await dialog.getByRole('button', { name: /^取\s*消$/ }).click();
	expect(published).toHaveLength(0);
	await page.getByRole('button', { name: '发布通知', exact: true }).click();
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog).toBeHidden();
	expect(published).toEqual([{ id: '101' }]);
});

test('notice validation prevents empty submissions and failures preserve the draft', async ({ page }) => {
	let saves = 0;
	await page.route('**/prod-api/api/sysNotice/add', (route) => {
		saves++;
		return route.fulfill({ status: 500, json: { message: '通知保存失败' } });
	});
	await loginAdmin(page, 'notice');
	await page.getByRole('button', { name: '新增通知', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '新增通知', exact: true });
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByRole('alert')).toContainText('请输入');
	expect(saves).toBe(0);
	await page.getByLabel('通知标题', { exact: true }).fill('未保存的草稿');
	await expect(page.getByRole('textbox', { name: '通知内容', exact: true })).toBeVisible();
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(dialog.getByRole('alert')).toContainText('请输入');
	expect(saves).toBe(0);
	await page.getByLabel('通知内容', { exact: true }).fill('不可丢失的内容');
	await dialog.getByRole('button', { name: /^确\s*定$/ }).click();
	await expect(page.getByText('通知保存失败', { exact: true })).toBeVisible();
	await expect(dialog).toBeVisible();
	await expect(page.getByLabel('通知标题', { exact: true })).toHaveValue('未保存的草稿');
	await expect(page.getByRole('textbox', { name: '通知内容', exact: true })).toContainText('不可丢失的内容');
	await expect(dialog.getByRole('button', { name: /^确\s*定$/ })).toBeEnabled();
	expect(saves).toBe(1);
});

test('readonly notice users do not get management mutations', async ({ page }) => {
	await mockAdminSession(page, 'notice', { readOnly: true });
	await loginAdmin(page, 'notice');
	await expect(page.getByRole('cell', { name: '隔离通知', exact: true })).toBeVisible();
	for (const name of ['新增通知', '编辑通知', '发布通知', '删除通知']) {
		await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	}
});

test('notification center reads received items and persists read status before clearing unread', async ({ page }) => {
	let read = false;
	const notice = { id: '101', title: '收件箱通知', content: '已持久化的消息内容', type: 1, status: 1 };
	await page.route('**/prod-api/api/sysNotice/unReadList', (route) => route.fulfill({ json: { code: 200, result: read ? [] : [notice] } }));
	await page.route('**/prod-api/api/sysNotice/pageReceived', (route) =>
		route.fulfill({
			json: { code: 200, result: { total: 1, items: [{ id: '201', noticeId: '101', readStatus: read ? 1 : 0, sysNotice: notice }] } },
		})
	);
	await page.route('**/prod-api/api/sysNotice/setRead', (route) => {
		expect(route.request().postDataJSON()).toEqual({ id: '101' });
		read = true;
		return route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'notice');
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	await page.locator('.bell-button').click();
	await page.getByRole('button', { name: '查看所有消息', exact: true }).click();
	const center = page.getByRole('dialog', { name: '通知中心', exact: true });
	await expect(center.getByText('未读', { exact: true })).toBeVisible();
	await center.getByRole('button', { name: '查看通知 收件箱通知', exact: true }).click();
	const detail = page.getByRole('dialog', { name: '通知详情', exact: true });
	await expect(detail.getByText('已持久化的消息内容')).toBeVisible();
	await expect(center.getByText('已读', { exact: true })).toBeVisible();
	await expect(page.getByRole('button', { name: '通知，0 条未读', exact: true })).toBeAttached();
	expect(read).toBe(true);
});

test('rich notice content keeps formatting and strips scripts and overlay styles', async ({ page }) => {
	const html =
		'<h2>安全标题</h2><p><strong>加粗正文</strong><a href="javascript:alert(1)">无效链接</a></p><table><tbody><tr><td>表格内容</td></tr></tbody></table><script>window.noticeAttack=true</script><p onclick="window.noticeAttack=true" style="position:fixed;inset:0;z-index:99999;color:rgb(255,0,0)">安全样式</p><svg onload="window.noticeAttack=true"></svg><iframe srcdoc="<script>alert(1)</script>"></iframe>';
	await page.route('**/prod-api/api/sysNotice/page', (route) =>
		route.fulfill({
			json: { code: 200, result: { total: 1, items: [{ id: '101', title: '隔离通知', content: html, type: 1, status: 1 }] } },
		})
	);
	await loginAdmin(page, 'notice');
	await page.getByRole('button', { name: '查看内容', exact: true }).click();
	const content = page.getByRole('dialog').locator('.notice-rich-content');
	await expect(content.locator('h2')).toHaveText('安全标题');
	await expect(content.locator('strong')).toHaveText('加粗正文');
	await expect(content.getByRole('cell')).toHaveText('表格内容');
	await expect(content.locator('script,svg,iframe,[onclick]')).toHaveCount(0);
	await expect(content.getByText('安全样式', { exact: true })).toHaveCSS('position', 'static');
	await expect(content.getByText('安全样式', { exact: true })).toHaveCSS('color', 'rgb(255, 0, 0)');
	expect(await content.locator('a').getAttribute('href')).toBeNull();
	expect(await page.evaluate(() => 'noticeAttack' in window)).toBe(false);
});

test('rich editor reloads old HTML and sends formatted HTML without lifecycle fields changing', async ({ page }, testInfo) => {
	let saved: Record<string, unknown> | undefined;
	const html = '<p><strong>旧加粗内容</strong></p><table><tbody><tr><td>旧表格</td></tr></tbody></table><p><img src="/logo.png" alt="站点标志" style="width:80px;"></p>';
	await page.route('**/prod-api/api/sysNotice/page', (route) =>
		route.fulfill({
			json: { code: 200, result: { total: 1, items: [{ id: '101', title: '隔离通知', content: html, type: 1, status: 0, createUserId: 10 }] } },
		})
	);
	await page.route('**/prod-api/api/sysNotice/update', (route) => {
		saved = route.request().postDataJSON();
		return route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'notice');
	await page.getByRole('button', { name: '编辑通知', exact: true }).click();
	const editor = page.getByRole('textbox', { name: '通知内容', exact: true });
	await expect(editor.locator('strong')).toHaveText('旧加粗内容');
	await expect(editor.getByRole('cell')).toContainText('旧表格');
	await expect.poll(() => editor.getByRole('img', { name: '站点标志' }).evaluate((image) => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	const confirmButton = page.getByRole('dialog', { name: '编辑通知', exact: true }).getByRole('button', { name: /^确\s*定$/ });
	await expect
		.poll(() =>
			confirmButton.evaluate((button) => {
				const rect = button.getBoundingClientRect();
				return rect.top >= 0 && rect.bottom <= innerHeight;
			})
		)
		.toBe(true);
	await page.getByLabel('通知标题', { exact: true }).click();
	await page.mouse.move(0, 0);
	await page.screenshot({ path: testInfo.outputPath('notice-rich-editor.png'), fullPage: true, animations: 'disabled' });
	await page
		.getByRole('dialog', { name: '编辑通知', exact: true })
		.getByRole('button', { name: /^确\s*定$/ })
		.click();
	await expect(page.getByRole('dialog', { name: '编辑通知', exact: true })).toBeHidden();
	expect(saved?.content).toContain('<strong>旧加粗内容</strong>');
	expect(saved?.content).toContain('<table');
});

test('legacy received notice address redirects anonymous users to login', async ({ page }) => {
	await page.goto('/#/dashboard/notice');
	await expect(page).toHaveURL(/#\/auth\/login/);
});

test('legacy received notice address remains authenticated and refreshable', async ({ page }) => {
	await page.route('**/prod-api/api/sysNotice/pageReceived', (route) =>
		route.fulfill({
			json: { code: 200, result: { total: 1, items: [{ id: '201', readStatus: 1, sysNotice: { id: '101', title: '历史收件', content: 'body', type: 1 } }] } },
		})
	);
	await loginAdmin(page, 'notice');
	await page.goto('/#/dashboard/notice');
	await expect(page.getByRole('cell', { name: '历史收件', exact: true })).toBeVisible();
	await page.reload();
	await expect(page.getByRole('cell', { name: '历史收件', exact: true })).toBeVisible();
});

test('unread badge deduplicates notices and partial all-read failure retains the failed notice', async ({ page }, testInfo) => {
	const first = { id: '101', title: '第一条通知', content: '<p>内容一</p>', type: 1 };
	const second = { id: '102', title: '第二条通知', content: '<p>内容二</p>', type: 1 };
	let firstRead = false;
	let secondRead = false;
	let rejectSecond = true;
	await page.route('**/prod-api/api/sysNotice/unReadList', (route) =>
		route.fulfill({
			json: { code: 200, result: [...(firstRead ? [] : [first, first]), ...(secondRead ? [] : [second])] },
		})
	);
	await page.route('**/prod-api/api/sysNotice/setRead', (route) => {
		if (route.request().postDataJSON().id === '101') firstRead = true;
		else if (rejectSecond) return route.fulfill({ status: 500, json: { message: '已读更新失败' } });
		else secondRead = true;
		return route.fulfill({ json: { code: 200 } });
	});
	await loginAdmin(page, 'notice');
	await expect(page.getByRole('button', { name: '通知，2 条未读', exact: true })).toBeVisible();
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	await page.getByRole('button', { name: '通知，2 条未读', exact: true }).click();
	const inbox = page.getByRole('region', { name: '未读通知', exact: true });
	await expect(inbox.getByRole('listitem')).toHaveCount(2);
	await expect
		.poll(() =>
			inbox.evaluate((element) => {
				const rect = element.getBoundingClientRect();
				return rect.left >= 0 && rect.right <= innerWidth;
			})
		)
		.toBe(true);
	await expect
		.poll(() =>
			inbox.getByRole('button', { name: '全部标记为已读', exact: true }).evaluate((button) => {
				const rect = button.getBoundingClientRect();
				return rect.left >= 0 && rect.right <= innerWidth && button.contains(document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2));
			})
		)
		.toBe(true);
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('notice-inbox.png'), fullPage: true, animations: 'disabled' });
	await inbox.getByRole('button', { name: '全部标记为已读', exact: true }).click();
	await expect(page.getByRole('button', { name: '通知，1 条未读', exact: true })).toBeVisible();
	await expect(inbox.getByRole('alert')).toContainText('部分通知未能');
	await expect(inbox.getByRole('listitem')).toHaveCount(1);
	await expect(inbox).toContainText('第二条通知');
	rejectSecond = false;
	await inbox.getByRole('button', { name: '全部标记为已读', exact: true }).click();
	await expect(page.getByRole('button', { name: '通知，0 条未读', exact: true })).toBeVisible();
	await expect(inbox.getByText('没有未读通知', { exact: true })).toBeVisible();
});

test('notice popover and editor fit narrow light-theme screens', async ({ page, isMobile }, testInfo) => {
	test.skip(!isMobile, 'Narrow mobile layout');
	await page.route('**/prod-api/api/sysNotice/unReadList', (route) => route.fulfill({
		json: { code: 200, result: [{ id: '101', title: '窄屏通知', content: '<p>中文内容和 longwordwithoutspaces0123456789012345678901234567890</p>' }] },
	}));
	await loginAdmin(page, 'notice');
	await page.setViewportSize({ width: 1100, height: 740 });
	if (await page.locator('html').evaluate((element) => element.classList.contains('dark'))) await page.getByRole('button', { name: 'light', exact: true }).click();
	await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(false);
	await page.setViewportSize({ width: 320, height: 740 });
	await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
	await page.getByRole('button', { name: '通知，1 条未读', exact: true }).click();
	const inbox = page.getByRole('region', { name: '未读通知', exact: true });
	await expect.poll(() => inbox.evaluate((element) => {
		const rect = element.getBoundingClientRect();
		return rect.left >= 0 && rect.right <= innerWidth;
	})).toBe(true);
	await page.screenshot({ path: testInfo.outputPath('notice-narrow-light-inbox.png'), fullPage: true, animations: 'disabled' });
	await page.keyboard.press('Escape');
	await page.getByRole('button', { name: '新增通知', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '新增通知', exact: true });
	await expect(page.getByRole('textbox', { name: '通知内容', exact: true })).toBeVisible();
	await expect.poll(() => dialog.getByRole('button', { name: /^确\s*定$/ }).evaluate((button) => {
		const rect = button.getBoundingClientRect();
		return rect.left >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight;
	})).toBe(true);
	await page.getByLabel('通知标题', { exact: true }).click();
	await page.mouse.move(0, 0);
	await page.screenshot({ path: testInfo.outputPath('notice-narrow-light-editor.png'), fullPage: true, animations: 'disabled' });
});
