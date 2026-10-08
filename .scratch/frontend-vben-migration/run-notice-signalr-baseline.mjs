import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, realpathSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
const seed = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8');
const password = seed.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
assert.ok(password);
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL(marker.baseUrl));
const browser = await chromium.launch({ channel: 'msedge' });
const contexts = [];
const report = { passed: false, proposalComplete: false, steps: [], pending: ['visual-acceptance'] };
let noticeId;

async function login(account, viewport = { width: 1440, height: 1000 }) {
	const context = await browser.newContext({ viewport });
	contexts.push(context);
	const page = await context.newPage();
	page.setDefaultTimeout(20_000);
	await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Fpos`);
	await page.getByLabel('账号', { exact: true }).fill(account);
	await page.getByLabel('密码', { exact: true }).fill(password);
	const response = page.waitForResponse((value) => new URL(value.url()).pathname.endsWith('/sysAuth/login'));
	await page.locator('button[type=submit]').click();
	const result = await (await response).json();
	assert.equal(result.code, 200);
	await expect(page).toHaveURL(/#\/system\/pos$/);
	return { context, page, ...result.result };
}

async function api(session, path, body, method = 'POST') {
	const response = await session.context.request.fetch(`${proxy.baseUrl}/prod-api/api/${path}`, {
		method,
		data: body,
		headers: { Authorization: `Bearer ${session.accessToken}` },
	});
	const result = await response.json();
	if (result.code === 200) return result;
	throw new Error(`${path}: ${result.code} ${result.message ?? ''}`);
}

try {
	const reader = await login('TestUser3', { width: 390, height: 844 });
	const foreign = await login('OnlineForeign', { width: 390, height: 844 });
	const publisher = await login('superAdmin.NET');
	await expect(reader.page.locator('.bell-button')).toHaveCount(1, { timeout: 20_000 });
	report.steps.push('real-reader-and-foreign-tenant-sessions');

	const title = `SignalR 通知 ${Date.now()}`;
	const created = await api(publisher, 'sysNotice/add', { title, content: '<p>真实 SignalR 通知内容</p>', type: 1 });
	const list = await api(publisher, `sysNotice/page`, { page: 1, pageSize: 20, title });
	const notice = list.result.items.find((item) => item.title === title);
	assert.ok(notice);
	noticeId = notice.id;
	await api(publisher, 'sysNotice/public', { id: notice.id });
	await expect(reader.page.getByRole('button', { name: /通知，1 条未读/ })).toBeVisible({ timeout: 30_000 });
	report.steps.push('real-public-notice-delivered-only-to-same-tenant');

	await reader.page.locator('button[aria-label^="通知"]').click();
	const inbox = reader.page.getByRole('region', { name: '未读通知', exact: true });
	await expect(inbox.getByText(title, { exact: true })).toBeVisible();
	await inbox.locator('.notice-item').filter({ hasText: title }).click();
	await expect(reader.page.getByRole('dialog', { name: '通知详情', exact: true }).getByText('真实 SignalR 通知内容')).toBeVisible();
	await expect(reader.page.locator('.bell-button')).toHaveAttribute('aria-label', '通知，0 条未读', { timeout: 20_000 });
	const received = await api(reader, 'sysNotice/unReadList', undefined, 'GET');
	assert.ok(!received.result.some((item) => String(item.id) === String(notice.id)));
	const foreignReceived = await api(foreign, 'sysNotice/unReadList', undefined, 'GET');
	assert.ok(!foreignReceived.result.some((item) => String(item.id) === String(notice.id)));
	report.steps.push('real-detail-set-read-and-offline-query-consistent');

	await reader.page.keyboard.press('Escape');
	await reader.page.goto(`${proxy.baseUrl}/#/dashboard/notice`);
	await expect(reader.page).toHaveURL(/#\/dashboard\/notice$/);
	await expect(reader.page.locator('main')).toBeVisible();
	await reader.page.screenshot({ path: join(runtime, 'evidence', 'notice-signalr-reader.png'), fullPage: true, animations: 'disabled' });
	report.pending = [];
	report.proposalComplete = true;
	report.passed = true;
} catch (error) {
	report.error = String(error.message).replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[redacted-token]');
	if (contexts[0]) {
		await contexts[0].pages()[0]?.screenshot({ path: join(runtime, 'evidence', 'notice-signalr-failure.png'), fullPage: true }).catch(() => {});
		report.url = contexts[0].pages()[0]?.url();
		report.buttons = await contexts[0].pages()[0]?.locator('button').evaluateAll((buttons) => buttons.slice(0, 20).map((button) => ({ aria: button.getAttribute('aria-label'), title: button.getAttribute('title'), className: button.className }))).catch(() => []);
	}
	process.exitCode = 1;
} finally {
	mkdirSync(join(runtime, 'evidence'), { recursive: true });
	writeFileSync(join(runtime, 'evidence', 'notice-signalr-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	for (const context of contexts) await context.close();
	await browser.close();
	await proxy.close();
	console.log(JSON.stringify(report));
}
