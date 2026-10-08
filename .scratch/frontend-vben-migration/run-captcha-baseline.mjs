import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
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
const input = createInterface({ input: process.stdin, output: process.stdout });
const report = { baselinePassed: false, proposalComplete: false, scenarios: [] };
try {
	for (const device of [
		{ name: 'desktop', viewport: { width: 1440, height: 1000 }, account: 'superAdmin.NET' },
		{ name: 'mobile', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, account: 'Admin.NET' },
	]) {
		const context = await browser.newContext(device);
		const page = await context.newPage();
		page.setDefaultTimeout(15_000);
		let token;
		let captcha;
		page.on('response', async (response) => {
			if (new URL(response.url()).pathname.endsWith('/api/sysAuth/captcha')) captcha = (await response.json()).result;
		});
		try {
			await page.goto(`${proxy.baseUrl}/#/auth/login?redirect=%2Fsystem%2Fpos`);
			await expect(page.getByLabel('验证码', { exact: true })).toBeVisible();
			await expect(page.locator('button[type=submit]')).toBeEnabled();
			await page.getByLabel('账号', { exact: true }).fill(device.account);
			await page.getByLabel('密码', { exact: true }).fill(password);
			const firstId = captcha.id;
			async function submit(code, success) {
				await page.getByLabel('验证码', { exact: true }).fill(code);
				const loginResponse = page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/login'));
				const refreshed = success ? undefined : page.waitForResponse((response) => new URL(response.url()).pathname.endsWith('/api/sysAuth/captcha'));
				await page.locator('button[type=submit]').click();
				const response = await loginResponse;
				const body = await response.json();
				assert.notEqual(response.request().postDataJSON().password, password);
				if (success) {
					assert.equal(body.code, 200);
					token = body.result.accessToken;
					return response.request().postDataJSON();
				}
				assert.notEqual(body.code, 200);
				await refreshed;
				await expect(page.getByRole('alert').filter({ hasText: /验证码/ }).first()).toBeVisible();
				await expect(page.getByLabel('验证码', { exact: true })).toHaveValue('');
			}
			await submit('invalid', false);
			assert.notEqual(captcha.id, firstId);
			report.scenarios.push({ device: device.name, invalidCodeRejected: true, captchaRotatedAfterFailure: true, codeCleared: true });
			async function readChallenge(label) {
				await page.getByLabel('密码', { exact: true }).fill('');
				const path = join(outputRoot, `${device.name}-${label}.png`);
				await page.locator('.captcha-image').screenshot({ path });
				console.log(`Challenge image: ${path}`);
				const answer = (await input.question('Enter the answer shown in the isolated challenge image: ')).trim();
				assert.ok(answer);
				await page.getByLabel('密码', { exact: true }).fill(password);
				return answer;
			}
			const expiredAnswer = await readChallenge('expiry-challenge');
			assert.ok(captcha.expirySeconds > 0 && captcha.expirySeconds <= 120);
			console.log(`${device.name}: waiting ${captcha.expirySeconds + 1} seconds for real captcha expiry.`);
			await delay((captcha.expirySeconds + 1) * 1000);
			await submit(expiredAnswer, false);
			report.scenarios.push({ device: device.name, expiredCorrectCodeRejected: true });
			const validAnswer = await readChallenge('valid-challenge');
			const loginPayload = await submit(validAnswer, true);
			await expect(page).toHaveURL(/#\/system\/pos$/);
			await expect(page.getByRole('button', { name: '新增职位', exact: true })).toBeVisible();
			const replay = await context.request.post(new URL('/api/sysAuth/login', apiUrl).href, { data: loginPayload });
			assert.notEqual((await replay.json()).code, 200, 'A consumed captcha must not authenticate a replay.');
			report.scenarios.push({ device: device.name, correctCodeLoginPassed: true, consumedCodeReplayRejected: true });
			console.log(`${device.name}: wrong, expired, correct and replayed captcha scenarios passed.`);
		} finally {
			if (token) await context.request.post(new URL('/api/sysAuth/logout', apiUrl).href, { headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
			await context.close();
		}
	}
	report.baselinePassed = true;
} finally {
	writeFileSync(join(outputRoot, 'captcha-baseline.json'), JSON.stringify(report, null, 2), 'utf8');
	input.close();
	await browser.close();
	await proxy.close();
}
