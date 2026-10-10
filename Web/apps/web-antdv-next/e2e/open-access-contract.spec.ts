import type { Locator, Page } from '@playwright/test';

import { Buffer } from 'node:buffer';
import { createHmac } from 'node:crypto';

import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

// 主代理提供当前 dist 的生产代理地址；此文件只验证 Mock HTTP 契约。
test.use({ channel: 'msedge' });
const undeclared = new WeakMap<Page, string[]>();
const mockKey = 'mock-open-access-key';
const mockSecret = Buffer.from('0123456789abcdef').toString('base64').replace(/==$/, '');
interface OpenAccessDraft {
	id?: number;
	accessKey: string;
	accessSecret: string;
	bindTenantId?: number;
	bindUserId?: number;
}
interface OpenAccessRow extends OpenAccessDraft {
	id: number;
	bindTenantName?: string;
	bindUserAccount?: string;
	updateUserName?: string;
	updateTime?: string;
}
interface OpenAccessQuery {
	page: number;
	pageSize: number;
	accessKey?: string;
}
interface OpenAccessSignatureInput {
	accessKey: string;
	accessSecret: string;
	method: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
	url: string;
	timestamp: number;
	nonce: string;
}
const initialRow: OpenAccessRow = {
	id: 31,
	accessKey: mockKey,
	accessSecret: mockSecret,
	bindTenantId: 1,
	bindUserId: 10,
	bindTenantName: '租户一',
	bindUserAccount: 'alice',
	updateUserName: '测试用户',
	updateTime: '2026-10-10 10:00:00',
};
type Action = 'add' | 'delete' | 'generateSignature' | 'page' | 'secret' | 'tenantList' | 'update' | 'userList';
const methods: Record<Action, string> = { add: 'POST', delete: 'POST', generateSignature: 'POST', page: 'POST', secret: 'POST', tenantList: 'GET', update: 'POST', userList: 'POST' };

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { promise, release };
}
function sign(input: OpenAccessSignatureInput) {
	const method = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'][input.method];
	return createHmac('sha256', input.accessSecret).update(`${method}&${input.url}&${input.accessKey}&${input.timestamp}&${input.nonce}`).digest('base64');
}
async function setup(page: Page, options: Parameters<typeof mockAdminSession>[2] = {}) {
	await mockAdminSession(page, 'openAccess', options);
	const fixture = {
		rows: [{ ...initialRow }],
		fail: new Set<Action>(),
		counts: new Map<Action, number>(),
		requests: [] as Array<{ action: Action; input: unknown; method: string }>,
		holds: {} as Partial<Record<Action, Promise<void>>>,
		userHolds: new Map<number, Promise<void>>(),
	};
	await page.route('**/prod-api/api/sysOpenAccess/*', async (route) => {
		const request = route.request();
		const action = new URL(request.url()).pathname.split('/').at(-1) as Action;
		if (!(action in methods) || request.method() !== methods[action]) {
			undeclared.get(page)!.push(`${request.method()} ${new URL(request.url()).pathname}`);
			await route.fulfill({ status: 501, json: { code: 501, message: 'Undeclared Mock request' } });
			return;
		}
		const input: unknown = request.postData() ? request.postDataJSON() : undefined;
		fixture.counts.set(action, (fixture.counts.get(action) ?? 0) + 1);
		fixture.requests.push({ action, input, method: request.method() });
		const hold = fixture.holds[action];
		if (hold) await hold;
		if (action === 'userList') {
			const userHold = fixture.userHolds.get(Number((input as { tenantId: number }).tenantId));
			if (userHold) await userHold;
		}
		try {
			if (fixture.fail.has(action)) {
				await route.fulfill({ json: { code: 500, message: 'Mock service failure', result: null } });
				return;
			}
			let result: unknown = null;
			switch (action) {
				case 'page': {
					const query = input as OpenAccessQuery;
					const rows = fixture.rows.filter((row) => !query.accessKey || row.accessKey.includes(query.accessKey));
					result = { items: rows.slice((query.page - 1) * query.pageSize, query.page * query.pageSize), total: rows.length };
					break;
				}
				case 'tenantList':
					result = [
						{ id: 1, name: '租户一' },
						{ id: 2, name: '租户二' },
					];
					break;
				case 'userList': {
					const tenantId = Number((input as { tenantId: number }).tenantId);
					result = [{ id: tenantId * 10, account: tenantId === 1 ? 'alice' : 'bob', realName: tenantId === 1 ? '用户甲' : '用户乙', tenantId }];
					break;
				}
				case 'secret':
					result = mockSecret;
					break;
				case 'generateSignature':
					result = sign(input as OpenAccessSignatureInput);
					break;
				case 'add':
					fixture.rows.push({ ...(input as OpenAccessDraft), id: 32, bindTenantName: '租户二', bindUserAccount: 'bob' });
					break;
				case 'update':
					fixture.rows = fixture.rows.map((row) => (row.id === (input as OpenAccessDraft).id ? { ...row, ...(input as OpenAccessDraft) } : row));
					break;
				case 'delete':
					fixture.rows = fixture.rows.filter((row) => row.id !== (input as { id: number }).id);
					break;
			}
			await route.fulfill({ json: { code: 200, result } });
		} catch {
			/* 离页或参数变化后，请求可能已经被 AbortSignal 取消。 */
		}
	});
	return fixture;
}
async function open(page: Page) {
	await loginAdmin(page, 'openAccess');
	await expect(page.locator('.open-access-page')).toBeVisible();
	await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
	const entry = page.locator('script[type="module"][src^="/jse/"]');
	await expect(entry, '必须使用当前 dist 中的生产 entry').toHaveCount(1);
	await expect(entry).toHaveAttribute('src', /^\/jse\/.+-[\w-]+\.js$/);
}
async function select(page: Page, dialog: Locator, label: string, text: string) {
	await dialog.getByRole('combobox', { name: label, exact: true }).click();
	await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: text }).click();
	await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
}
const mutation = (page: Page, action: Action) => page.waitForRequest((request) => new URL(request.url()).pathname === `/prod-api/api/sysOpenAccess/${action}` && request.method() === methods[action]);
const row = (page: Page, key = mockKey) => page.locator('.ant-table-tbody tr').filter({ hasText: key });
async function fillSignature(dialog: Locator, nonce = '123456') {
	await dialog.getByRole('textbox', { name: '接口请求地址', exact: true }).fill('/api/example/action');
	await dialog.getByRole('textbox', { name: '时间戳', exact: true }).fill('1700000000');
	await dialog.getByRole('textbox', { name: '随机数', exact: true }).fill(nonce);
}

test.beforeEach(async ({ page, isMobile }) => {
	test.skip(isMobile, '仅执行桌面验收');
	undeclared.set(page, []);
	await page.route('**/prod-api/**', async (route) => {
		undeclared.get(page)!.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
		await route.fulfill({ status: 501, json: { code: 501, message: 'Undeclared Mock request' } });
	});
});
test.afterEach(async ({ page }) => {
	expect(undeclared.get(page) ?? [], '拒绝未声明后端请求').toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`普通账号旧菜单 alias、明文列、固定帮助及桌面 ${colorScheme}`, async ({ page }, testInfo) => {
		const consoleMessages: string[] = [];
		page.on('console', (message) => consoleMessages.push(message.text()));
		const fixture = await setup(page, { openAccessMenuPath: '/platform/openAccess' });
		await page.emulateMedia({ colorScheme });
		await open(page);
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) await page.getByRole('button', { name: colorScheme, exact: true }).click();
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await expect(row(page)).toContainText(mockSecret);
		await expect(row(page)).toContainText('alice');
		await expect(row(page)).toContainText('租户一');
		expect(fixture.requests.find((request) => request.action === 'page')?.input).toEqual({ page: 1, pageSize: 50 });
		await page.getByRole('button', { name: '说明', exact: true }).click();
		const help = page.getByRole('dialog', { name: '开放接口说明' });
		for (const text of ['accessKey', 'timestamp', 'nonce', 'sign', 'UPPER_METHOD&PATH&KEY&TIMESTAMP&NONCE', 'Base64(HMACSHA256']) await expect(help).toContainText(text);
		await expect(help).not.toContainText(mockKey);
		await expect(help).not.toContainText(mockSecret);
		await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
		await page.mouse.move(250, 110);
		await expect.poll(() => help.evaluate((element) => { const style = getComputedStyle(element); return style.opacity === '1' && ['matrix(1, 0, 0, 1, 0, 0)', 'none'].includes(style.transform); })).toBe(true);
		await help.screenshot({ path: testInfo.outputPath(`open-access-help-${colorScheme}.png`) });
		await help.locator('.ant-modal-footer').getByRole('button', { name: '关闭', exact: true }).click();
		await expect(help).toBeHidden();
		expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('mock-open-access-key'))).toBe(false);
		expect(await page.evaluate((secret) => JSON.stringify({ ...localStorage, ...sessionStorage }).includes(secret), mockSecret)).toBe(false);
		expect(consoleMessages.join('\n')).not.toContain(mockKey);
		expect(consoleMessages.join('\n')).not.toContain(mockSecret);
		await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.waitForFunction(() => document.getAnimations().every((animation) => animation.playState === 'finished' || animation.playState === 'idle' || animation.effect?.getTiming().iterations === Infinity));
		await page.screenshot({ path: testInfo.outputPath(`open-access-${colorScheme}.png`), fullPage: true, mask: [page.locator('.ant-table-tbody td:nth-child(2), .ant-table-tbody td:nth-child(3)')] });
		await page.evaluate(() => {
			location.hash = '/platform/openAccess';
		});
		await expect(page.locator('.open-access-page')).toHaveCount(1);
		await expect(page.locator('.open-access-page')).toBeVisible();
	});
}

test('查询重置、全 draft CRUD、绑定切换及删除取消', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await page.getByRole('textbox', { name: '筛选身份标识', exact: true }).fill('missing');
	await page.getByRole('button', { name: '查询', exact: true }).click();
	await expect(row(page)).toHaveCount(0);
	await page.getByRole('button', { name: '重置', exact: true }).click();
	await expect(row(page)).toBeVisible();
	await page.getByRole('button', { name: '新增', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '添加开放接口身份' });
	await editor.getByRole('textbox', { name: '身份标识', exact: true }).fill('created-key');
	await editor.getByRole('button', { name: '生成密钥', exact: true }).click();
	await expect(editor.getByRole('textbox', { name: '密钥', exact: true })).toHaveValue(mockSecret);
	await select(page, editor, '绑定租户', '租户一');
	await select(page, editor, '绑定用户', 'alice');
	await select(page, editor, '绑定租户', '租户二');
	await expect(editor.getByRole('combobox', { name: '绑定用户', exact: true })).toBeEnabled();
	await editor.getByRole('button', { name: '保存', exact: true }).click();
	await expect(editor).toContainText('请选择绑定用户');
	expect(fixture.counts.get('add') ?? 0).toBe(0);
	await select(page, editor, '绑定用户', 'bob');
	const [added] = await Promise.all([mutation(page, 'add'), editor.getByRole('button', { name: '保存', exact: true }).click()]);
	expect(added.postDataJSON()).toEqual({ accessKey: 'created-key', accessSecret: mockSecret, bindTenantId: 2, bindUserId: 20 });
	await expect(editor).not.toBeVisible();
	await expect(row(page, 'created-key')).toBeVisible();
	await row(page, 'created-key').getByRole('button', { name: '编辑', exact: true }).click();
	const edit = page.getByRole('dialog', { name: '编辑开放接口身份' });
	await edit.getByRole('textbox', { name: '身份标识', exact: true }).fill('edited-key');
	await expect(edit.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
	const [updated] = await Promise.all([mutation(page, 'update'), edit.getByRole('button', { name: '保存', exact: true }).click()]);
	expect(updated.postDataJSON()).toMatchObject({ id: 32, accessKey: 'edited-key', accessSecret: mockSecret, bindTenantId: 2, bindUserId: 20 });
	await expect(edit).not.toBeVisible();
	await row(page, 'edited-key').getByRole('button', { name: '删除', exact: true }).click();
	const confirmation = page.getByRole('dialog', { name: '删除开放接口身份' });
	await confirmation.getByRole('button', { name: '取消', exact: true }).click();
	expect(fixture.counts.get('delete') ?? 0).toBe(0);
	await row(page, 'edited-key').getByRole('button', { name: '删除', exact: true }).click();
	const [deleted] = await Promise.all([mutation(page, 'delete'), confirmation.getByRole('button', { name: '删除', exact: true }).click()]);
	expect(deleted.postDataJSON()).toEqual({ id: 32 });
	await expect(row(page, 'edited-key')).toHaveCount(0);
});

test('全部九种方法、只读凭据、秒时间戳及 crypto 六位随机数', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await row(page).getByRole('button', { name: '生成签名', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '生成签名' });
	await expect(dialog.getByRole('textbox', { name: '身份标识', exact: true })).toHaveAttribute('readonly', '');
	await expect(dialog.getByRole('textbox', { name: '密钥', exact: true })).toHaveAttribute('readonly', '');
	await dialog.getByRole('button', { name: '获取时间戳', exact: true }).click();
	expect(Number(await dialog.getByRole('textbox', { name: '时间戳', exact: true }).inputValue())).toBeLessThanOrEqual(Math.floor(Date.now() / 1000));
	await dialog.getByRole('button', { name: '获取随机数', exact: true }).click();
	await expect(dialog.getByRole('textbox', { name: '随机数', exact: true })).toHaveValue(/^\d{6}$/);
	await fillSignature(dialog);
	const output = dialog.getByRole('textbox', { name: '签名', exact: true });
	for (const [method, label] of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'].entries()) {
		if (method > 0) await select(page, dialog, '请求方式', label);
		await expect(output).toHaveValue(
			sign({ accessKey: mockKey, accessSecret: mockSecret, method: method as OpenAccessSignatureInput['method'], url: '/api/example/action', timestamp: 1700000000, nonce: '123456' })
		);
	}
	expect(fixture.requests.filter((request) => request.action === 'generateSignature').map((request) => (request.input as OpenAccessSignatureInput).method)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
	const before = fixture.counts.get('generateSignature');
	await dialog.getByRole('textbox', { name: '接口请求地址', exact: true }).fill('https://example.com/api/path?q=1#x');
	await expect(output).toHaveValue('');
	await expect(dialog).toContainText('不包含域名、查询参数或片段');
	await page.waitForTimeout(300);
	expect(fixture.counts.get('generateSignature')).toBe(before);
});

test('用户候选乱序不回填旧租户', async ({ page }) => {
	const fixture = await setup(page);
	const held = gate();
	fixture.userHolds.set(1, held.promise);
	await open(page);
	await page.getByRole('button', { name: '新增', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '添加开放接口身份' });
	try {
		await select(page, dialog, '绑定租户', '租户一');
		await expect.poll(() => fixture.counts.get('userList')).toBe(1);
		await select(page, dialog, '绑定租户', '租户二');
		await select(page, dialog, '绑定用户', 'bob');
	} finally {
		held.release();
	}
	await dialog.getByRole('combobox', { name: '绑定用户', exact: true }).click();
	await expect(page.locator('.ant-select-dropdown:visible')).toContainText('bob');
	await expect(page.locator('.ant-select-dropdown:visible')).not.toContainText('alice');
	await page.keyboard.press('Escape');
	await dialog.getByRole('button', { name: '取消', exact: true }).click();
	expect(fixture.counts.get('add') ?? 0).toBe(0);
});

test('保存和签名失败保留输入，不假报成功或泄漏凭据', async ({ page }) => {
	const fixture = await setup(page);
	fixture.fail.add('update');
	fixture.fail.add('generateSignature');
	await open(page);
	await row(page).getByRole('button', { name: '编辑', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '编辑开放接口身份' });
	await expect(editor.getByRole('button', { name: '保存', exact: true })).toBeEnabled();
	await editor.getByRole('textbox', { name: '身份标识', exact: true }).fill('unsaved-key');
	await editor.getByRole('button', { name: '保存', exact: true }).click();
	await expect(editor).toContainText('保存失败，已保留填写内容');
	await expect(editor.getByRole('textbox', { name: '身份标识', exact: true })).toHaveValue('unsaved-key');
	await expect(editor.getByRole('textbox', { name: '密钥', exact: true })).toHaveValue(mockSecret);
	await expect(page.getByText('保存成功', { exact: true })).toHaveCount(0);
	await editor.getByRole('button', { name: '取消', exact: true }).click();
	await row(page).getByRole('button', { name: '生成签名', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '生成签名' });
	await fillSignature(dialog);
	await expect(dialog).toContainText('签名生成失败，已保留填写内容');
	await expect(dialog.getByRole('textbox', { name: '随机数', exact: true })).toHaveValue('123456');
	await expect(dialog.getByRole('textbox', { name: '签名', exact: true })).toHaveValue('');
	fixture.fail.delete('generateSignature');
	await dialog.getByRole('button', { name: '生成签名', exact: true }).click();
	await expect(dialog.getByRole('textbox', { name: '签名', exact: true })).not.toHaveValue('');
	await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
});

test('签名参数变化立即清旧值，迟到签名不能覆盖新结果', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await row(page).getByRole('button', { name: '生成签名', exact: true }).click();
	const dialog = page.getByRole('dialog', { name: '生成签名' });
	const held = gate();
	fixture.holds.generateSignature = held.promise;
	try {
		await fillSignature(dialog);
		await expect.poll(() => fixture.counts.get('generateSignature')).toBe(1);
		delete fixture.holds.generateSignature;
		await dialog.getByRole('textbox', { name: '随机数', exact: true }).fill('654321');
		await expect(dialog.getByRole('textbox', { name: '签名', exact: true })).toHaveValue('');
		await expect(dialog.getByRole('textbox', { name: '签名', exact: true })).toHaveValue(
			sign({ accessKey: mockKey, accessSecret: mockSecret, method: 0, url: '/api/example/action', timestamp: 1700000000, nonce: '654321' })
		);
	} finally {
		held.release();
	}
	await expect(dialog.getByRole('textbox', { name: '随机数', exact: true })).toHaveValue('654321');
});

test('KeepAlive 离页清理草稿，迟到密钥不回灌，重新激活重载', async ({ page }) => {
	const fixture = await setup(page);
	const held = gate();
	fixture.holds.secret = held.promise;
	await open(page);
	await page.getByRole('button', { name: '新增', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '添加开放接口身份' });
	try {
		await editor.getByRole('textbox', { name: '身份标识', exact: true }).fill('must-clear-draft');
		await editor.getByRole('button', { name: '生成密钥', exact: true }).click();
		await expect.poll(() => fixture.counts.get('secret')).toBe(1);
		await page.evaluate(() => {
			location.hash = '/about';
		});
		await expect(page).toHaveURL(/#\/about$/);
		await expect(page.locator('.open-access-page')).not.toBeVisible();
		await expect(editor).not.toBeVisible();
	} finally {
		held.release();
	}
	await page.evaluate(() => {
		location.hash = '/system/openAccess';
	});
	await expect(page.locator('.open-access-page')).toBeVisible();
	await expect.poll(() => fixture.counts.get('page')).toBe(2);
	await page.getByRole('button', { name: '新增', exact: true }).click();
	await expect(editor.getByRole('textbox', { name: '身份标识', exact: true })).toHaveValue('');
	await expect(editor.getByRole('textbox', { name: '密钥', exact: true })).toHaveValue('');
});

for (const actions of [[], ['page']] as const) {
	test(`无权限或只读账号的请求与操作边界 ${actions.join(',') || 'none'}`, async ({ page }) => {
		const fixture = await setup(page, { openAccessActions: [...actions] });
		await open(page);
		for (const name of ['新增', '编辑', '删除']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
		if (actions.length === 0) {
			await expect(page.getByText('暂无开放接口身份查看权限', { exact: true })).toBeVisible();
			await page.waitForTimeout(300);
			expect(fixture.requests).toEqual([]);
		} else {
			await expect(row(page).getByRole('button', { name: '生成签名', exact: true })).toBeVisible();
			expect(fixture.counts.get('page')).toBe(1);
		}
	});
}

test('普通 update-only 账号仍可获取专用候选与后端密钥', async ({ page }) => {
	const fixture = await setup(page, { openAccessActions: ['page', 'update'] });
	await open(page);
	await row(page).getByRole('button', { name: '编辑', exact: true }).click();
	const editor = page.getByRole('dialog', { name: '编辑开放接口身份' });
	await expect(editor.getByRole('combobox', { name: '绑定用户', exact: true })).toBeEnabled();
	await editor.getByRole('button', { name: '生成密钥', exact: true }).click();
	await expect(editor.getByRole('textbox', { name: '密钥', exact: true })).toHaveValue(mockSecret);
	expect(fixture.requests.some((request) => request.action === 'tenantList' && request.method === 'GET')).toBe(true);
	expect(fixture.requests.some((request) => request.action === 'userList' && request.method === 'POST')).toBe(true);
	expect(fixture.counts.get('secret')).toBe(1);
});
