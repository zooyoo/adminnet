import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.ADMINNET_E2E_BASE_URL || 'http://127.0.0.1:8890';

export default defineConfig({
	testDir: './apps/web-antdv-next/e2e',
	fullyParallel: true,
	workers: 2,
	expect: { timeout: 10_000 },
	forbidOnly: Boolean(process.env.CI),
	retries: process.env.CI ? 1 : 0,
	reporter: 'list',
	use: {
		baseURL,
		channel: process.platform === 'win32' ? 'msedge' : undefined,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
	},
	projects: [
		{ name: 'desktop', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } },
		{ name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
	],
	webServer: process.env.ADMINNET_E2E_BASE_URL
		? undefined
		: {
				command: 'pnpm --filter @vben/web-antdv-next dev --port 8890 --host 127.0.0.1',
				url: baseURL,
				reuseExistingServer: !process.env.CI,
				timeout: 60_000,
			},
});
