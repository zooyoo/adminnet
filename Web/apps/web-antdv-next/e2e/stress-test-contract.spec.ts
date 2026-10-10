import type { Page } from '@playwright/test';

import { expect, test } from '@playwright/test';

import { loginAdmin, mockAdminSession } from './fixtures/admin-session';

// 通过 ADMINNET_E2E_BASE_URL 指向生产构建服务；本文件仅验证页面与 Mock API 契约。
const policy = {
	targets: [{ name: '隔离 Probe', requestUri: 'http://127.0.0.1:43123/probe/' }],
	maxTotalRequests: 10_000,
	maxConcurrency: 64,
	maxRounds: 100,
	maxRequestsPerRound: 1000,
	requestTimeoutSeconds: 10,
};
const result = {
	totalRequests: 100,
	successfulRequests: 98,
	failedRequests: 2,
	queriesPerSecond: 50,
	totalTimeInSeconds: 2,
	minResponseTime: 1,
	maxResponseTime: 90,
	averageResponseTime: 12,
	percentile10ResponseTime: 2,
	percentile25ResponseTime: 4,
	percentile50ResponseTime: 8,
	percentile75ResponseTime: 15,
	percentile90ResponseTime: 30,
	percentile99ResponseTime: 70,
	percentile999ResponseTime: 89,
};
const undeclared = new WeakMap<Page, string[]>();
const isRun = (url: string) => new URL(url).pathname === '/prod-api/api/sysCommon/stressTest';

async function pair(page: Page, group: string, row: number, key: string, value: string) {
	await page.getByRole('tab', { name: group, exact: true }).click();
	await page.getByLabel(`添加 ${group} 参数`, { exact: true }).click();
	await page.getByLabel(`${group} 参数名 ${row}`, { exact: true }).fill(key);
	await page.getByLabel(`${group} 参数值 ${row}`, { exact: true }).fill(value);
}

test.beforeEach(async ({ page, isMobile }) => {
	test.skip(isMobile, '本提案仅验收桌面端');
	const unexpected: string[] = [];
	undeclared.set(page, unexpected);
	await page.route('**/prod-api/**', async (route) => {
		unexpected.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`);
		await route.abort();
	});
	await mockAdminSession(page, 'stressTest', { superAdmin: true });
	await page.route('**/prod-api/api/sysCommon/stressTestTargets', (route) => route.fulfill({ json: { code: 200, result: policy } }));
	await page.route('**/prod-api/api/sysCommon/stressTest', (route) => route.fulfill({ json: { code: 200, result } }));
});

test.afterEach(async ({ page }) => {
	expect(undeclared.get(page) ?? [], 'Mock 契约拒绝未声明的后端请求').toEqual([]);
});

for (const colorScheme of ['light', 'dark'] as const) {
	test(`压测配置与完整统计保持桌面 ${colorScheme} 可读`, async ({ page }, testInfo) => {
		await page.emulateMedia({ colorScheme });
		await loginAdmin(page, 'stressTest');
		if ((await page.locator('html').getAttribute('class'))?.includes('dark') !== (colorScheme === 'dark')) {
			await page.getByRole('button', { name: colorScheme, exact: true }).click();
		}
		await expect.poll(() => page.locator('html').evaluate((element) => element.classList.contains('dark'))).toBe(colorScheme === 'dark');
		await expect(page.getByLabel('开始压测', { exact: true })).toBeEnabled();
		await expect(page.getByLabel('请求地址', { exact: true })).toHaveValue(policy.targets[0]!.requestUri);
		await page.getByRole('combobox', { name: '请求方式', exact: true }).click();
		await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').filter({ hasText: /^POST$/ }).click();
		await page.getByLabel('请求地址', { exact: true }).fill(`${policy.targets[0]!.requestUri}path/{id}`);
		await page.getByLabel('每轮请求量', { exact: true }).fill('50');
		await page.getByLabel('压测轮数', { exact: true }).fill('2');
		await page.getByLabel('最大并行量', { exact: true }).fill('0');
		await pair(page, 'Headers', 1, 'X-Probe', 'contract');
		await pair(page, 'Body', 1, 'tag', 'one');
		await pair(page, 'Body', 2, 'tag', 'two');
		await pair(page, 'Path', 1, 'id', '42');
		await pair(page, 'Query', 1, 'page', '2');
		const [request] = await Promise.all([page.waitForRequest((item) => item.method() === 'POST' && isRun(item.url())), page.getByLabel('开始压测', { exact: true }).click()]);
		expect(request.postDataJSON()).toEqual({
			requestUri: `${policy.targets[0]!.requestUri}path/{id}`,
			requestMethod: 'POST',
			numberOfRequests: 50,
			numberOfRounds: 2,
			maxDegreeOfParallelism: 0,
			requestParameters: [
				{ key: 'tag', value: 'one' },
				{ key: 'tag', value: 'two' },
			],
			headers: { 'X-Probe': 'contract' },
			pathParameters: { id: '42' },
			queryParameters: { page: '2' },
		});
		const statistics = page.getByLabel('执行结果', { exact: true });
		await expect(statistics).toContainText('压测已完成，存在失败请求');
		await expect(statistics).toContainText('HTTP 非 2xx');
		for (const label of ['总请求数', '成功请求', '失败请求', 'QPS', '总耗时', '最短响应', '平均响应', '最长响应', 'P10', 'P25', 'P50', 'P75', 'P90', 'P99', 'P99.9']) {
			await expect(statistics).toContainText(label);
		}
		await expect(page.locator('.ant-message-notice, .ant-notification-notice')).toHaveCount(0);
		await expect.poll(() => page.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running' && Number.isFinite(animation.effect?.getComputedTiming().endTime)).length)).toBe(0);
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
		await page.locator('.stress-page').evaluate((element) => {
			for (let current: HTMLElement | null = element as HTMLElement; current; current = current.parentElement) {
				if (current.scrollHeight > current.clientHeight) current.scrollTop = 0;
			}
		});
		await page.screenshot({ path: testInfo.outputPath(`stress-test-${colorScheme}.png`), fullPage: true });
		await statistics.screenshot({ path: testInfo.outputPath(`stress-test-${colorScheme}-results.png`) });
	});
}

test('空配置和读取失败不允许开始压测，也不预填外网地址', async ({ page }) => {
	await page.route('**/prod-api/api/sysCommon/stressTestTargets', (route) => route.fulfill({ json: { code: 200, result: { ...policy, targets: [] } } }));
	await loginAdmin(page, 'stressTest');
	await expect(page.getByLabel('开始压测', { exact: true })).toBeDisabled();
	await expect(page.getByLabel('请求地址', { exact: true })).toHaveValue('');
	await expect(page.locator('.stress-config').getByRole('alert')).toContainText('服务端未配置授权压测目标');
	await page.route('**/prod-api/api/sysCommon/stressTestTargets', (route) => route.fulfill({ status: 500, json: { message: '授权目标读取失败' } }));
	await page.getByLabel('刷新压测目标', { exact: true }).click();
	await expect(page.getByLabel('开始压测', { exact: true })).toBeDisabled();
	await expect(page.locator('.stress-config').getByRole('alert')).toContainText('授权目标读取失败');
});

test('超过总量上限显示字段错误，执行 API 不收到请求', async ({ page }) => {
	let called = 0;
	await page.route('**/prod-api/api/sysCommon/stressTest', (route) => {
		called++;
		return route.fulfill({ json: { code: 200, result } });
	});
	await loginAdmin(page, 'stressTest');
	await expect(page.getByLabel('开始压测', { exact: true })).toBeEnabled();
	await page.getByLabel('每轮请求量', { exact: true }).fill('1000');
	await page.getByLabel('压测轮数', { exact: true }).fill('11');
	await page.getByLabel('开始压测', { exact: true }).click();
	await expect(page.getByText('每轮请求量 × 压测轮数不得超过 10000 次', { exact: true })).toBeVisible();
	expect(called).toBe(0);
});

test('运行期间锁定编辑与重复执行，取消后给出明确状态', async ({ page }) => {
	let release!: () => void;
	const pending = new Promise<void>((resolve) => {
		release = resolve;
	});
	await page.route('**/prod-api/api/sysCommon/stressTest', async (route) => {
		await pending;
		try {
			await route.fulfill({ json: { code: 200, result } });
		} catch {
			/* 取消后浏览器可已经关闭该请求。 */
		}
	});
	try {
		await loginAdmin(page, 'stressTest');
		await expect(page.getByLabel('开始压测', { exact: true })).toBeEnabled();
		await Promise.all([page.waitForRequest((request) => isRun(request.url())), page.getByLabel('开始压测', { exact: true }).click()]);
		await expect(page.getByLabel('请求地址', { exact: true })).toBeDisabled();
		await expect(page.getByLabel('每轮请求量', { exact: true })).toBeDisabled();
		await expect(page.getByLabel('添加 Headers 参数', { exact: true })).toBeDisabled();
		await expect(page.getByLabel('开始压测', { exact: true })).toBeDisabled();
		await expect(page.getByLabel('取消压测', { exact: true })).toBeEnabled();
		await page.getByLabel('取消压测', { exact: true }).click();
		await expect(page.getByLabel('执行结果', { exact: true })).toContainText('压测请求已取消');
		await expect(page.getByLabel('开始压测', { exact: true })).toBeEnabled();
	} finally {
		release();
	}
});

test('全部请求失败仍显示完成，但不给出成功结论', async ({ page }) => {
	await page.route('**/prod-api/api/sysCommon/stressTest', (route) => route.fulfill({ json: { code: 200, result: { ...result, successfulRequests: 0, failedRequests: 100 } } }));
	await loginAdmin(page, 'stressTest');
	await expect(page.getByLabel('开始压测', { exact: true })).toBeEnabled();
	await page.getByLabel('开始压测', { exact: true }).click();
	await expect(page.getByLabel('执行结果', { exact: true })).toContainText('压测已完成，所有请求均失败');
});

for (const options of [{ superAdmin: false }, { superAdmin: true, readOnly: true }]) {
	test(`超级管理员与端点权限缺一不可 ${JSON.stringify(options)}`, async ({ page }) => {
		await mockAdminSession(page, 'stressTest', options);
		await loginAdmin(page, 'stressTest');
		await expect(page.locator('.stress-page').getByRole('alert')).toContainText('当前账号不可执行压测');
		await expect(page.getByLabel('开始压测', { exact: true })).toHaveCount(0);
	});
}
