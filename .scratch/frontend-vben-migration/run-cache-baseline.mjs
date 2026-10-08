import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { startProductionProxy } from './production-proxy.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(root, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runtime = realpathSync(resolve(process.argv[2] ?? ''));
assert.equal(dirname(runtime).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtime), /^adminnet-vben-[a-f0-9]{32}$/);
const marker = JSON.parse(readFileSync(join(runtime, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(marker.runtimeRoot.toLowerCase(), runtime.toLowerCase());
const seed = readFileSync(join(root, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8');
const password = seed.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
assert.ok(password);
const evidence = join(runtime, 'evidence');
mkdirSync(evidence, { recursive: true });
const proxy = await startProductionProxy(join(root, 'Web/dist'), new URL(marker.baseUrl));
const browser = await chromium.launch({ channel: 'msedge' });
const report = { passed: false, scenarios: [] };
try {
	for (const device of [
		{ name: 'desktop-light', viewport: { width: 1440, height: 1000 }, colorScheme: 'light' },
		{ name: 'mobile-light', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: 'light' },
		{ name: 'narrow-dark', viewport: { width: 320, height: 740 }, isMobile: true, hasTouch: true, colorScheme: 'dark' },
	]) {
		const context = await browser.newContext(device);
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		const scenario = { device: device.name, passed: false, steps: [] };
		report.scenarios.push(scenario);
		let token;
		async function call(path) {
			const response = await context.request.get(`${proxy.baseUrl}/prod-api/api/${path}`, { headers: { Authorization: `Bearer ${token}` } });
			const data = await response.json();
			assert.equal(data.code, 200);
			return data.result;
		}
		async function activate(locator) {
			if (device.hasTouch) await locator.tap();
			else await locator.click();
		}
		try {
			await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fplatform%2Fcache`);
			await expect(page.locator('button[type=submit]')).toBeEnabled();
			await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
			await page.getByLabel('密码', { exact: true }).fill(password);
			const login = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/sysAuth/login'));
			await activate(page.locator('button[type=submit]'));
			const result = await (await login).json();
			assert.equal(result.code, 200);
			token = result.result.accessToken;
			await expect(page).toHaveURL(/#\/platform\/cache$/);
			await expect(page.getByRole('heading', { name: '缓存列表', exact: true })).toBeVisible();
			scenario.steps.push('real-login');
			if (await page.locator('html').evaluate((element) => element.classList.contains('dark')) !== (device.colorScheme === 'dark')) {
				await page.setViewportSize({ width: 1440, height: 1000 });
				await page.getByRole('button', { name: device.colorScheme, exact: true }).click();
				await page.setViewportSize(device.viewport);
			}
			await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(device.colorScheme === 'dark');
			const keys = await call('sysCache/keyList');
			// 仅操作隔离服务中的非身份缓存，报告不保存缓存值和认证令牌。
			const key = keys.find((value) => value === 'sys_config:sys_captcha');
			assert.ok(key, 'A disposable configuration or dictionary cache key must exist.');
			await page.getByLabel('筛选缓存键').fill(key);
			const leaf = page.locator('.ant-tree-title').filter({ hasText: key.includes(':') ? key.slice(key.indexOf(':') + 1) : key }).last();
			const reading = page.waitForResponse((response) => response.url().includes('/sysCache/value/'));
			await activate(leaf);
			const value = await (await reading).json();
			assert.equal(value.code, 200);
			await expect(page.locator('.cache-detail .vben-json-viewer, .cache-detail .cache-scalar')).toBeVisible();
			if (value.result === null || typeof value.result !== 'object') {
				await expect(page.locator('.cache-scalar')).toHaveText(String(value.result));
			}
			await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
			await page.screenshot({ path: join(evidence, `cache-${device.name}-value.png`), fullPage: true });
			scenario.steps.push('real-value');
			await activate(page.getByRole('button', { name: '删除缓存', exact: true }));
			await activate(page.locator('.ant-modal:visible').getByRole('button', { name: /^取\s*消$/ }));
			await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
			assert.ok((await call('sysCache/keyList')).includes(key));
			scenario.steps.push('cancel-keeps-key');
			await activate(page.getByRole('button', { name: '删除缓存', exact: true }));
			const deleting = page.waitForResponse((response) => response.url().includes('/sysCache/delete/'));
			await activate(page.locator('.ant-modal:visible').getByRole('button', { name: /^确\s*定$/ }));
			assert.equal((await (await deleting).json()).code, 200);
			await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
			assert.ok(!(await call('sysCache/keyList')).includes(key));
			scenario.steps.push('real-delete-confirmed-by-api');
			await page.getByLabel('筛选缓存键').clear();
			await activate(page.getByRole('button', { name: '清空全部缓存', exact: true }));
			await activate(page.locator('.ant-modal:visible').getByRole('button', { name: /^取\s*消$/ }));
			await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
			const beforeClear = await call('sysCache/keyList');
			assert.ok(beforeClear.length > 0);
			await activate(page.getByRole('button', { name: '清空全部缓存', exact: true }));
			const clearing = page.waitForResponse((response) => response.url().endsWith('/sysCache/clear'));
			await activate(page.locator('.ant-modal:visible').getByRole('button', { name: /^确\s*定$/ }));
			assert.equal((await (await clearing).json()).code, 200);
			await expect(page.locator('.ant-modal:visible')).toHaveCount(0);
			const afterClear = await call('sysCache/keyList');
			assert.ok(afterClear.length < beforeClear.length, 'Clear must remove actual cached entries.');
			scenario.steps.push('real-clear-confirmed-by-api');
			await expect(page.locator('.ant-notification-notice')).toHaveCount(0);
			assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
			await page.screenshot({ path: join(evidence, `cache-${device.name}.png`), fullPage: true });
			scenario.passed = true;
		} catch (error) {
			scenario.error = error.message;
			await page.screenshot({ path: join(evidence, `cache-${device.name}-failure.png`), fullPage: true });
			throw error;
		} finally {
			await context.close();
		}
	}
	const restricted = await browser.newContext();
	try {
		const page = await restricted.newPage();
		await page.goto(`${proxy.baseUrl}/#/auth/login`);
		await expect(page.locator('button[type=submit]')).toBeEnabled();
		await page.getByLabel('账号', { exact: true }).fill('TestUser3');
		await page.getByLabel('密码', { exact: true }).fill(password);
		const login = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/sysAuth/login'));
		await page.locator('button[type=submit]').click();
		const result = await (await login).json();
		assert.equal(result.code, 200);
		const identity = await restricted.request.get(`${proxy.baseUrl}/prod-api/api/sysAuth/userInfo`, {
			headers: { Authorization: `Bearer ${result.result.accessToken}` },
		});
		const identityBody = await identity.json();
		assert.equal(identityBody.code, 200);
		const cachePermissions = identityBody.result.buttons.filter((permission) => permission.startsWith('sysCache:'));
		assert.ok(!cachePermissions.includes('sysCache:delete') && !cachePermissions.includes('sysCache:clear'), `Fixture unexpectedly has cache write permissions: ${cachePermissions.join(',')}`);
		for (const action of ['delete/sys_config%3Asys_captcha', 'clear']) {
			const response = await restricted.request.post(`${proxy.baseUrl}/prod-api/api/sysCache/${action}`, {
				headers: { Authorization: `Bearer ${result.result.accessToken}` },
			});
			assert.equal((await response.json()).code, 403);
		}
		const deniedRead = await restricted.request.get(`${proxy.baseUrl}/prod-api/api/sysCache/value/sys_config%3Asys_captcha`, {
			headers: { Authorization: `Bearer ${result.result.accessToken}` },
		});
		assert.equal((await deniedRead.json()).code, 403);
		report.scenarios.push({ device: 'restricted-account', passed: true, steps: ['real-login', 'read-forbidden', 'delete-forbidden', 'clear-forbidden'] });
	} finally {
		await restricted.close();
	}
	if (process.argv.includes('--contracts')) {
		const { stdout } = await promisify(execFile)('pwsh', [
			'-NoProfile', '-Command',
			"$ErrorActionPreference = 'Stop'; corepack pnpm exec playwright test cache-contract.spec.ts --workers=2; if ($LASTEXITCODE -ne 0) { throw 'Production cache contracts failed.' }",
		], {
			cwd: join(root, 'Web'),
			env: { ...process.env, ADMINNET_E2E_BASE_URL: proxy.baseUrl },
			timeout: 180_000,
			maxBuffer: 2 * 1024 * 1024,
			windowsHide: true,
		});
		console.log(stdout);
		report.productionContractsPassed = true;
	}
	const outageContext = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
	try {
		const page = await outageContext.newPage();
		await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fplatform%2Fcache`);
		await expect(page.locator('button[type=submit]')).toBeEnabled();
		await page.getByLabel('账号', { exact: true }).fill('superAdmin.NET');
		await page.getByLabel('密码', { exact: true }).fill(password);
		await page.locator('button[type=submit]').tap();
		await expect(page.getByRole('heading', { name: '缓存列表', exact: true })).toBeVisible();
		await expect(page.locator('.ant-tree-title').first()).toBeVisible();
		await promisify(execFile)('pwsh', ['-NoProfile', '-File', join(root, '.scratch/frontend-vben-migration/stop-isolated-api.ps1'), '-RuntimeRoot', runtime], { windowsHide: true });
		await page.getByRole('button', { name: '刷新缓存列表' }).tap();
		await expect(page.locator('.cache-navigation').getByRole('alert')).toBeVisible();
		await expect(page.getByRole('button', { name: '刷新缓存列表' })).toBeEnabled();
		await expect(page.getByRole('button', { name: '删除缓存', exact: true })).toBeDisabled();
		report.scenarios.push({ device: 'mobile-api-outage', passed: true, steps: ['real-api-stopped', 'visible-error', 'no-stale-selection'] });
	} finally {
		await outageContext.close();
	}
	report.passed = true;
} finally {
	writeFileSync(join(evidence, 'cache-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	await browser.close();
	await proxy.close();
	console.log(JSON.stringify(report));
}
