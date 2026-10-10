import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

// 生产资源 + Edge 的 Mock HTTP 契约，不作为真实发布、备份或还原的证据。
test.use({ channel: 'msedge' });
const undeclared = new WeakMap<Page, string[]>();
const mockKey = 'contract-private-webhook-key';
const backupRows = [{ fileName: 'release-01.zip', createTime: '2026-10-10 10:00:00' }, { fileName: 'release-02.zip', createTime: '2026-10-10 11:00:00' }];
type Action = 'clear' | 'list' | 'logs' | 'restore' | 'status' | 'update' | 'webHookKey';

function gate() {
	let release!: () => void;
	const promise = new Promise<void>((resolve) => { release = resolve; });
	return { promise, release };
}

async function setup(page: Page, options: Parameters<typeof mockAdminSession>[2] = {}) {
	await mockAdminSession(page, 'update', options);
	const fixture = {
		status: { enabled: true, reason: '', targetName: 'Mock 隔离目标', isRunning: false },
		backups: [...backupRows],
		logs: ['Mock 契约日志：尚未执行更新', `长行自动换行 ${'desktop-log-content '.repeat(100)}`],
		fail: new Set<Action>(),
		counts: new Map<Action, number>(),
		holds: {} as Partial<Record<Action, Promise<void>>>,
	};
	const methods: Record<Action, string> = { status: 'GET', list: 'POST', logs: 'GET', update: 'POST', restore: 'POST', clear: 'GET', webHookKey: 'GET' };
	await page.route('**/prod-api/api/sysUpdate/*', async (route) => {
		const request = route.request();
		const action = new URL(request.url()).pathname.split('/').at(-1) as Action;
		if (!(action in methods) || request.method() !== methods[action]) {
			undeclared.get(page)!.push(`${request.method()} ${new URL(request.url()).pathname}`);
			await route.fulfill({ status: 501, json: { code: 501, message: 'Undeclared Mock request' } });
			return;
		}
		fixture.counts.set(action, (fixture.counts.get(action) ?? 0) + 1);
		if (fixture.holds[action]) await fixture.holds[action];
		try {
			if (fixture.fail.has(action)) { await route.fulfill({ json: { code: 500, message: 'Mock service failure', result: null } }); return; }
			let result: unknown = null;
			switch (action) {
				case 'status': result = fixture.status; break;
				case 'list': result = fixture.backups; break;
				case 'logs': result = fixture.logs; break;
				case 'webHookKey': result = mockKey; break;
				case 'clear': fixture.logs = []; break;
				case 'update': fixture.logs.push('Mock 更新完成'); break;
				case 'restore': fixture.logs.push('Mock 还原完成'); break;
			}
			await route.fulfill({ json: { code: 200, result } });
		} catch { /* 离页后响应可能已被 AbortSignal 取消。 */ }
	});
	return fixture;
}

async function open(page: Page) {
	await loginAdmin(page, 'update');
	await expect(page.locator('.system-update-page')).toBeVisible();
	// 明确拒绝 dev server，统一由主代理传入生产资源代理 URL。
	await expect(page.locator('script[src*="/@vite/client"]')).toHaveCount(0);
	const entry = page.locator('script[type="module"][src^="/jse/"]');
	await expect(entry, '此契约必须使用真实 production entry').toHaveCount(1);
	await expect(entry).toHaveAttribute('src', /^\/jse\/.+-[\w-]+\.js$/);
}

async function selectBackup(page: Page, fileName = 'release-02.zip') {
	await page.getByRole('combobox', { name: '备份列表', exact: true }).click();
	// antdv-next 1.5.2 可见浮层的真实选项；不点击辅助隐藏 role=option。
	await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: fileName }).click();
	await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
}

const mutation = (page: Page, action: Action) => page.waitForRequest((request) => new URL(request.url()).pathname === `/prod-api/api/sysUpdate/${action}` && request.method() === (action === 'clear' || action === 'webHookKey' ? 'GET' : 'POST'));

test.beforeEach(async ({ page, isMobile }) => {
	test.skip(isMobile, '仅执行桌面验收');
	undeclared.set(page, []);
	await page.route('**/prod-api/**', async (route) => {
		undeclared.get(page)!.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
		await route.fulfill({ status: 501, json: { code: 501, message: 'Undeclared Mock request' } });
	});
});

test.afterEach(async ({ page }) => {
	expect(undeclared.get(page) ?? [], 'Mock 契约拒绝未声明的后端请求').toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`普通账号动态菜单、确认还原和长日志在桌面 ${colorScheme} 可读`, async ({ page }, testInfo) => {
		const fixture = await setup(page, { updateMenuPath: '/platform/update' });
		await page.emulateMedia({ colorScheme });
		await open(page);
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) await page.getByRole('button', { name: colorScheme, exact: true }).click();
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await expect(page.getByRole('button', { name: '更新', exact: true })).toBeEnabled();
		await expect(page.getByRole('button', { name: '还原', exact: true })).toBeDisabled();
		await selectBackup(page);
		await page.getByRole('button', { name: '还原', exact: true }).click();
		const dialog = page.getByRole('dialog', { name: '确认还原备份' });
		await expect(dialog).toContainText('release-02.zip');
		await dialog.getByRole('button', { name: '取消', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		expect(fixture.counts.get('restore') ?? 0).toBe(0);
		await expect(page.getByLabel('更新日志', { exact: true })).toContainText('尚未执行更新');
		await page.getByRole('button', { name: '还原', exact: true }).click();
		const [request] = await Promise.all([mutation(page, 'restore'), dialog.getByRole('button', { name: '确认还原', exact: true }).click()]);
		expect(request.postDataJSON()).toEqual({ fileName: 'release-02.zip' });
		await expect(page.getByRole('status').filter({ hasText: '备份还原已完成' })).toBeVisible();
		await expect(page.getByLabel('更新日志', { exact: true })).toContainText('Mock 还原完成');
		expect(fixture.counts.get('webHookKey') ?? 0).toBe(0);
		await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.locator('.system-update-page').evaluate((element) => { for (let current: HTMLElement | null = element as HTMLElement; current; current = current.parentElement) if (current.scrollHeight > current.clientHeight) current.scrollTop = 0; });
		await page.screenshot({ path: testInfo.outputPath(`system-update-${colorScheme}.png`), fullPage: true });
		await page.getByLabel('更新日志', { exact: true }).screenshot({ path: testInfo.outputPath(`system-update-${colorScheme}-logs.png`) });
		await page.evaluate(() => { location.hash = '/platform/update'; });
		await expect(page.locator('.system-update-page')).toHaveCount(1);
		await expect(page.locator('.system-update-page')).toBeVisible();
	});
}

test('更新直接执行；忙状态防止重复操作并持续观察日志', async ({ page }) => {
	const fixture = await setup(page);
	const held = gate();
	fixture.holds.update = held.promise;
	await open(page);
	await selectBackup(page);
	try {
		await Promise.all([mutation(page, 'update'), page.getByRole('button', { name: '更新', exact: true }).click()]);
		await expect(page.getByRole('dialog')).toHaveCount(0);
		for (const name of ['更新', '还原', '清空日志', '复制 WebHook 密钥']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
		const previous = fixture.counts.get('logs') ?? 0;
		await expect.poll(() => fixture.counts.get('logs') ?? 0).toBeGreaterThan(previous);
		expect(fixture.counts.get('update')).toBe(1);
	} finally { held.release(); }
	await expect(page.getByRole('status').filter({ hasText: '系统更新已完成' })).toBeVisible();
	await expect(page.getByRole('button', { name: '更新', exact: true })).toBeEnabled();
});

test('更新、还原、清空失败保留选择和日志；服务成功才清空', async ({ page }) => {
	const fixture = await setup(page);
	fixture.fail = new Set(['clear', 'restore', 'update']);
	await open(page);
	await selectBackup(page);
	await page.getByRole('button', { name: '更新', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: '更新失败' })).toBeVisible();
	await page.getByRole('button', { name: '还原', exact: true }).click();
	await page.getByRole('dialog').getByRole('button', { name: '确认还原', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: '还原失败' })).toBeVisible();
	await expect(page.locator('.backup-form')).toContainText('release-02.zip');
	await page.getByRole('button', { name: '清空日志', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: '清空日志失败' })).toBeVisible();
	await expect(page.getByLabel('更新日志', { exact: true })).toContainText('尚未执行更新');
	fixture.fail.delete('clear');
	await page.getByRole('button', { name: '清空日志', exact: true }).click();
	await expect(page.getByText('暂无更新日志', { exact: true })).toBeVisible();
});

test('目标禁用仍能查看和清空，服务端正在运行时禁止所有 mutation', async ({ page }) => {
	const fixture = await setup(page);
	fixture.status = { enabled: false, reason: 'Mock 发布目标未配置', targetName: '', isRunning: false };
	await open(page);
	await expect(page.getByText('Mock 发布目标未配置', { exact: true })).toBeVisible();
	await selectBackup(page);
	for (const name of ['更新', '还原', '复制 WebHook 密钥']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
	await expect(page.getByRole('button', { name: '清空日志', exact: true })).toBeEnabled();
	fixture.status = { enabled: true, reason: '', targetName: 'Mock 隔离目标', isRunning: true };
	await expect(page.getByText('目标正在执行更新或还原', { exact: true })).toBeVisible();
	for (const name of ['更新', '还原', '清空日志', '复制 WebHook 密钥']) await expect(page.getByRole('button', { name, exact: true })).toBeDisabled();
	expect(fixture.counts.get('update') ?? 0).toBe(0);
	expect(fixture.counts.get('webHookKey') ?? 0).toBe(0);
});

for (const actions of [[], ['list'], ['logs']]) {
	test(`查看权限需要 list 与 logs 同时存在：${actions.join(',') || '无权限'}`, async ({ page }) => {
		const fixture = await setup(page, { updateActions: actions });
		await open(page);
		await expect(page.getByText('无权查看系统更新', { exact: true })).toBeVisible();
		// 有界观察窗口用于证明未发生轮询；不是等待页面加载。
		await page.waitForTimeout(750);
		expect([...fixture.counts.values()]).toEqual([]);
	});
}

test('只读账号仅观察；日志、备份空状态与服务错误明确区分', async ({ page }) => {
	const fixture = await setup(page, { readOnly: true });
	fixture.backups = [];
	fixture.logs = [];
	await open(page);
	await expect(page.getByText('暂无备份记录', { exact: true })).toBeVisible();
	await expect(page.getByText('暂无更新日志', { exact: true })).toBeVisible();
	for (const name of ['更新', '还原', '清空日志', '复制 WebHook 密钥']) await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
	fixture.fail.add('logs');
	fixture.fail.add('list');
	await page.getByRole('button', { name: '刷新记录', exact: true }).click();
	await expect(page.getByText('无法读取备份记录，已保留当前选择，请刷新记录重试', { exact: true })).toBeVisible();
	await expect(page.getByText('无法读取更新日志，已有日志可能不是最新记录', { exact: true })).toBeVisible();
	await expect(page.getByText('暂无备份记录', { exact: true })).toHaveCount(0);
	await expect(page.getByText('暂无更新日志', { exact: true })).toHaveCount(0);
});

test('离页停止轮询并释放等待，迟到响应不能回灌，重新激活恢复', async ({ page }) => {
	const fixture = await setup(page);
	await open(page);
	await expect(page.getByLabel('更新日志', { exact: true })).toContainText('尚未执行更新');
	const held = gate();
	let heldOnce = false;
	await page.route('**/prod-api/api/sysUpdate/logs', async (route) => {
		fixture.counts.set('logs', (fixture.counts.get('logs') ?? 0) + 1);
		if (!heldOnce) {
			heldOnce = true;
			await held.promise;
			try { await route.fulfill({ json: { code: 200, result: ['不可回灌的迟到日志'] } }); } catch { /* 请求已取消。 */ }
		} else await route.fulfill({ json: { code: 200, result: fixture.logs } });
	});
	try {
		await expect.poll(() => heldOnce).toBe(true);
		await page.evaluate(() => { location.hash = '/about'; });
		await expect(page).toHaveURL(/#\/about$/);
		await expect(page.locator('.system-update-page')).not.toBeVisible();
		const previous = fixture.counts.get('logs');
		await page.waitForTimeout(750);
		expect(fixture.counts.get('logs')).toBe(previous);
	} finally { held.release(); }
	await page.evaluate(() => { location.hash = '/system/update'; });
	await expect(page.getByLabel('更新日志', { exact: true })).toContainText('尚未执行更新');
	await expect(page.locator('.system-update-page')).not.toContainText('不可回灌的迟到日志');
});

test('密钥仅显式点击获取和复制，不出现在页面、存储、通知或 console，失败明确反馈', async ({ page }) => {
	const consoleMessages: string[] = [];
	page.on('console', (message) => consoleMessages.push(message.text()));
	await page.addInitScript(() => {
		const clipboard = { count: 0, matched: false, fail: false };
		(window as unknown as { updateClipboardProbe: typeof clipboard }).updateClipboardProbe = clipboard;
		Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (value: string) => { clipboard.count++; clipboard.matched = value === 'contract-private-webhook-key'; if (clipboard.fail) throw new Error('Clipboard unavailable'); } } });
	});
	const fixture = await setup(page);
	await open(page);
	expect(fixture.counts.get('webHookKey') ?? 0).toBe(0);
	await page.getByRole('button', { name: '复制 WebHook 密钥', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: 'WebHook 密钥已复制' })).toBeVisible();
	expect(await page.evaluate(() => { const probe = (window as unknown as { updateClipboardProbe: { count: number; matched: boolean } }).updateClipboardProbe; return { count: probe.count, matched: probe.matched }; })).toEqual({ count: 1, matched: true });
	await expect(page.locator('body')).not.toContainText(mockKey);
	expect(await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }).includes('contract-private-webhook-key'))).toBe(false);
	expect(consoleMessages.join('\n')).not.toContain(mockKey);
	await page.evaluate(() => { (window as unknown as { updateClipboardProbe: { fail: boolean } }).updateClipboardProbe.fail = true; });
	await page.getByRole('button', { name: '复制 WebHook 密钥', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: '复制 WebHook 密钥失败' })).toBeVisible();
	fixture.fail.add('webHookKey');
	await page.getByRole('button', { name: '复制 WebHook 密钥', exact: true }).click();
	await expect(page.getByRole('status').filter({ hasText: '复制 WebHook 密钥失败' })).toBeVisible();
	expect(await page.evaluate(() => (window as unknown as { updateClipboardProbe: { count: number } }).updateClipboardProbe.count)).toBe(2);
	await expect(page.locator('body')).not.toContainText(mockKey);
	expect(consoleMessages.join('\n')).not.toContain(mockKey);
});
