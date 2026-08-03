const { defineConfig, devices } = require('@playwright/test');
module.exports = defineConfig({
  testDir: './tests',
  testMatch: 'e2e.spec.js',
  timeout: 30000,
  use: { baseURL: process.env.BASE || 'http://localhost:8777', ...devices['iPhone 12'] },
  // Поднимите статику отдельно (npm run serve) или раскомментируйте webServer:
  // webServer: { command: 'python3 -m http.server 8777', port: 8777, reuseExistingServer: true },
});
