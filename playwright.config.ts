import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5173',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    { command: 'npm run dev -w server', url: 'http://127.0.0.1:3001/health', reuseExistingServer: true, timeout: 60_000 },
    { command: 'npm run dev -w client', url: 'http://127.0.0.1:5173', reuseExistingServer: true, timeout: 60_000 },
  ],
});
