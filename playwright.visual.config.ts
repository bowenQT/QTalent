import { defineConfig } from '@playwright/test';
import base from './playwright.config';
export default defineConfig({
  ...base,
  testDir: './tests/visual',
  timeout: 180000,
  outputDir: 'test-results/visual',
});
