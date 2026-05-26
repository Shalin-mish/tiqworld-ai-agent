import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir:   './tests/e2e',
  timeout:   30_000,
  retries:   1,
  reporter:  [['list'], ['json', { outputFile: 'tests/results/e2e-results.json' }]],
  use: {
    baseURL:       'http://localhost:3001',
    headless:      true,
    screenshot:    'only-on-failure',
    video:         'retain-on-failure',
    trace:         'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
  // Start the web server automatically before tests
  webServer: {
    command: 'node src/web/server.js',
    url:     'http://localhost:3001/api/status',
    timeout: 15_000,
    reuseExistingServer: true,
  },
});
