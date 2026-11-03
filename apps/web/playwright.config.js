import { defineConfig } from '@playwright/test';

const BASE_URL = 'http://127.0.0.1:4399';

// 默认用 Playwright 自带的 chromium（CI 里跑 `npx playwright install chromium`）。
// 本机没有下载 chromium 时，可以用 PLAYWRIGHT_CHANNEL=msedge 或 chrome 走已安装的浏览器，
// 省下约 160 MB 的下载。只影响本地调试，e2e 断言完全一样。
const channel = process.env.PLAYWRIGHT_CHANNEL;

export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    ...(channel ? { channel } : {}),
  },
  webServer: {
    command: 'node scripts/fake-server.js',
    url: `${BASE_URL}/api/state`,
    reuseExistingServer: false,
    timeout: 30000,
    stdout: 'pipe',
  },
});
