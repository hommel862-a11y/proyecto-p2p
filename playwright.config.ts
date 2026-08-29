import { defineConfig } from '@playwright/test';

// Web-shell e2e: serves the built Angular bundle and runs happy-path specs.
export default defineConfig({
  testDir: './e2e/web',
  timeout: 30000,
  expect: { timeout: 10000 },
  use: {
    baseURL: 'http://localhost:4321',
    headless: true,
  },
  webServer: {
    command: 'node e2e/serve.mjs',
    port: 4321,
    reuseExistingServer: true,
    timeout: 60000,
  },
});
