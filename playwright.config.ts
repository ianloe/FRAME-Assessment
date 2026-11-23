import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:8088',
    headless: true,
    viewport: { width: 1280, height: 800 }
  }
});
