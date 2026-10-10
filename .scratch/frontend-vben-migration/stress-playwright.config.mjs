import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export default {
  testDir: join(root, 'Web/apps/web-antdv-next/e2e'),
  testMatch: ['stress-test-contract.spec.ts'],
  outputDir: join(root, 'Web/test-results/stress-desktop-contract'),
  workers: 2,
  fullyParallel: true,
  retries: 0,
  reporter: 'list',
  expect: { timeout: 10000 },
  use: { baseURL: process.env.ADMINNET_E2E_BASE_URL, channel: 'msedge', screenshot: 'only-on-failure', trace: 'off', reducedMotion: 'reduce' },
  projects: [{ name: 'desktop', use: { viewport: { width: 1440, height: 1000 } } }],
};
