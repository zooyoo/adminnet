import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { startProductionProxy } from './production-proxy.mjs';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(repositoryRoot, 'Web/package.json'));
const { chromium, expect } = require('@playwright/test');
const runtimeRoot = realpathSync(resolve(process.argv[2] ?? ''));
const marker = JSON.parse(readFileSync(join(runtimeRoot, 'isolated-run.json'), 'utf8').replace(/^\uFEFF/, ''));
assert.equal(dirname(runtimeRoot).toLowerCase(), realpathSync(tmpdir()).toLowerCase());
assert.match(basename(runtimeRoot), /^adminnet-vben-[a-f0-9]{32}$/);
assert.equal(marker.runtimeRoot.toLowerCase(), runtimeRoot.toLowerCase());
const apiUrl = new URL(marker.baseUrl);
const outputRoot = join(runtimeRoot, 'evidence');
mkdirSync(outputRoot, { recursive: true });
const passwordSeed = readFileSync(join(repositoryRoot, 'Admin.NET/Admin.NET.Core/SeedData/SysConfigSeedData.cs'), 'utf8');
const password = passwordSeed.match(/Code=ConfigConst\.SysPassword,\s*Value="([^"]+)"/)?.[1];
assert.ok(password);
const proxy = await startProductionProxy(join(repositoryRoot, 'Web/dist'), apiUrl);
const browser = await chromium.launch({ channel: 'msedge' });
const report = { baselinePassed: false, proposalComplete: false, scenarios: [], pending: ['image-captcha', 'mobile-touch-logout', 'visual-acceptance'] };
let currentDevice;
let stage = 'initialization';
async function responseDuring(page, path, action) {
	const [response] = await Promise.all([
		page.waitForResponse((response) => new URL(response.url()).pathname.endsWith(path)),
		action(),
	]);
	return response;
}
try {
	for (const device of [
		{ name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, account: 'Admin.NET' },
		{ name: 'desktop', viewport: { width: 1440, height: 1000 }, account: 'superAdmin.NET' },
	]) {
		currentDevice = device.name;
		stage = 'login-page';
		const context = await browser.newContext(device);
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		const navigation = [];
		const pageErrors = [];
		page.on('framenavigated', (frame) => {
			if (frame !== page.mainFrame()) return;
			const url = new URL(frame.url());
			navigation.push({ stage, origin: url.origin, path: url.pathname, route: url.hash.split('?')[0] });
		});
		page.on('pageerror', (error) => pageErrors.push({ stage, name: error.name }));
		page.on('crash', () => pageErrors.push({ stage, name: 'PageCrashed' }));
		let activeToken;
		try {
			let loginRequests = 0;
			page.on('request', (request) => {
				if (new URL(request.url()).pathname.endsWith('/api/sysAuth/login')) {
					loginRequests++;
					assert.notEqual(request.postDataJSON().password, password);
					assert.match(request.postDataJSON().password, /^[a-f0-9]{192,}$/i);
				}
			});
			const configResponse = await responseDuring(page, '/api/sysConfig/sysInfo', () =>
				page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Fpos`));
			assert.equal((await configResponse.json()).result.secondVer, 1);
			await expect(page.locator('button[type=submit]')).toBeEnabled();
			await page.getByLabel('账号', { exact: true }).fill(device.account);
			await page.getByLabel('密码', { exact: true }).fill(password);
			await page.locator('button[type=submit]').click();
			await expect(page.getByRole('alert').filter({ hasText: '请先完成验证' })).toBeVisible();
			assert.equal(loginRequests, 0, 'The slider gate must block login submission.');
			const handle = page.locator('[name=captcha-action]');
			const handleBox = await handle.boundingBox();
			const sliderBox = await handle.locator('..').boundingBox();
			assert.ok(handleBox && sliderBox);
			const x = handleBox.x + handleBox.width / 2;
			const y = handleBox.y + handleBox.height / 2;
			const endX = sliderBox.x + sliderBox.width - 2;
			stage = 'slider-drag';
			if (device.hasTouch) {
				const cdp = await context.newCDPSession(page);
				try {
					await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
					for (let step = 1; step <= 12; step++) {
						const currentX = x + (endX - x) * step / 12;
						await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: currentX, y }] });
						await delay(20);
					}
					await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [{ x: endX, y }] });
				} finally {
					await cdp.detach();
				}
			} else {
				await page.mouse.move(x, y);
				await page.mouse.down();
				await page.mouse.move(endX, y, { steps: 12 });
				await page.mouse.up();
			}
			await expect(page.getByText('验证通过', { exact: true })).toBeVisible({ timeout: 5000 });
			stage = 'login-after-slider';
			const loginResponse = await responseDuring(page, '/api/sysAuth/login', () =>
				page.locator('button[type=submit]').click());
			const result = await loginResponse.json();
			assert.equal(result.code, 200);
			activeToken = result.result.accessToken;
			const originalRefreshToken = result.result.refreshToken;
			const payload = JSON.parse(Buffer.from(activeToken.split('.')[1], 'base64url').toString('utf8'));
			const waitMs = Math.max(0, payload.exp * 1000 - Date.now() + 6500);
			assert.ok(waitMs < 75_000, 'Use the short-lived isolated authentication fixture.');
			await expect(page).toHaveURL(/#\/system\/pos$/);
			await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
			report.scenarios.push({ device: device.name, sliderBlocksSubmission: true, sliderInput: device.hasTouch ? 'touch' : 'mouse', encryptedLogin: true });
			console.log(`${device.name}: slider and real encrypted login passed; waiting ${Math.ceil(waitMs / 1000)} seconds for real access-token expiry.`);
			await delay(waitMs);
			stage = 'token-renewal';
			const renewed = await responseDuring(page, '/api/sysPos/list', () =>
				page.getByRole('button', { name: '查询', exact: true }).click());
			const sentHeaders = await renewed.request().allHeaders();
			assert.equal(sentHeaders.authorization, `Bearer ${activeToken}`);
			assert.equal(sentHeaders['x-authorization'], `Bearer ${originalRefreshToken}`);
			assert.equal((await renewed.json()).code, 200);
			const renewedHeaders = await renewed.allHeaders();
			assert.ok(renewedHeaders['access-token']);
			assert.ok(renewedHeaders['x-access-token']);
			assert.notEqual(renewedHeaders['access-token'], activeToken);
			activeToken = renewedHeaders['access-token'];
			const next = await responseDuring(page, '/api/sysPos/list', () =>
				page.getByRole('button', { name: '查询', exact: true }).click());
			assert.equal((await next.request().allHeaders()).authorization, `Bearer ${activeToken}`);
			assert.equal((await next.json()).code, 200);
			report.scenarios.push({ device: device.name, realExpiredAccess: true, refreshHeaderSent: true, tokensRenewed: true, nextRequestUsesRenewedToken: true });
			console.log(`${device.name}: real expired access token renewed, subsequent request adopted new token.`);

			// 从真实服务撤销令牌，再让仍持有旧会话的浏览器触发失效处理。
			const revoke = await context.request.post(new URL('/api/sysAuth/logout', apiUrl).href, { headers: { Authorization: `Bearer ${activeToken}` } });
			assert.equal((await revoke.json()).code, 200);
			stage = 'revoked-session';
			const rejected = await responseDuring(page, '/api/sysPos/list', () =>
				page.getByRole('button', { name: '查询', exact: true }).click());
			const rejectedBody = await rejected.json();
			const rejectedHeaders = await rejected.allHeaders();
			report.scenarios.push({
				device: device.name, revocationResponseStatus: rejected.status(), revocationBusinessCode: rejectedBody.code,
				invalidTokenHeader: rejectedHeaders['access-token'] === 'invalid_token',
			});
			console.log(`${device.name}: revoked-token response status=${rejected.status()}, code=${rejectedBody.code}, invalid-token=${rejectedHeaders['access-token'] === 'invalid_token'}.`);
			assert.ok(rejected.status() === 401 || rejectedBody.code === 401 || rejectedHeaders['access-token'] === 'invalid_token');
			await expect(page).toHaveURL(/#\/auth\/login/);
			await expect(page.getByText('登录已失效', { exact: true })).toBeVisible();
			await page.getByLabel('密码', { exact: true }).fill('');
			await page.screenshot({ path: join(outputRoot, `${device.name}-session-expired.png`), fullPage: true });
			await page.reload();
			await page.goto(`${proxy.baseUrl}/#/system/pos`);
			await expect(page).toHaveURL(/#\/auth\/login/);
			report.scenarios.push({ device: device.name, revokedTokenRejected: true, expiryNoticeVisible: true, clearedSessionSurvivesReload: true });
			activeToken = undefined;
		} catch (error) {
			report.failure = { device: currentDevice, stage, name: error.name, navigation, pageErrors };
			writeFileSync(join(outputRoot, 'auth-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
			await page.getByLabel('密码', { exact: true }).fill('', { timeout: 2000 }).catch(() => {});
			await page.screenshot({ path: join(outputRoot, `${device.name}-auth-failure.png`), fullPage: true }).catch(() => {});
			throw error;
		} finally {
			if (activeToken) await context.request.post(new URL('/api/sysAuth/logout', apiUrl).href, { headers: { Authorization: `Bearer ${activeToken}` } }).catch(() => {});
			await context.close();
		}
	}
	report.baselinePassed = true;
} catch (error) {
	report.failure ??= { device: currentDevice, stage, name: error.name };
	throw error;
} finally {
	writeFileSync(join(outputRoot, 'auth-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	await browser.close();
	await proxy.close();
}
