import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: '**/*.e2e.ts', workers: 1, fullyParallel: false,
  timeout: 90_000, expect: { timeout: 12_000 }, reporter: 'list',
  outputDir: 'test-results', use: { trace: 'retain-on-failure' },
});
