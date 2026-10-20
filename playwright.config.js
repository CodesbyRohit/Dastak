// Browser tests. The same specs run against the local server (project "local") and against a
// deployed URL (project "deployed", BASE_URL=https://...), so deployment is checked directly.
'use strict';

const { defineConfig } = require('@playwright/test');

const PORT = 3210;
const deployed = process.env.BASE_URL;

module.exports = defineConfig({
  testDir: 'test/e2e',
  timeout: 45000,
  fullyParallel: true,
  workers: process.env.CI ? 2 : 4,
  reporter: [['list'], ['json', { outputFile: 'test-results/e2e-results.json' }]],
  use: {
    browserName: 'chromium',
    viewport: { width: 600, height: 600 },
    trace: 'retain-on-failure'
  },
  projects: [
    { name: 'local', use: { baseURL: 'http://127.0.0.1:' + PORT } },
    { name: 'deployed', use: { baseURL: deployed } }
  ],
  webServer: deployed ? undefined : {
    command: 'node server.js',
    url: 'http://127.0.0.1:' + PORT + '/glasses.html',
    reuseExistingServer: false,
    env: { PORT: String(PORT), AI_API_KEY: '', AI_API_URL: '' }
  }
});
