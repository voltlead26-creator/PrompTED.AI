import { defineConfig } from '@playwright/test';
import { loadWorkspaceFixture } from './tests/e2e/workspace-fixtures';

const fixture = loadWorkspaceFixture();
export default defineConfig({
  testDir: './tests/e2e', testMatch: 'retained-uploads.spec.ts',
  fullyParallel: false, workers: 1, retries: 0, forbidOnly: true,
  timeout: 120_000, expect: { timeout: 15_000 },
  reporter: [['line'], ['json', { outputFile: `${fixture.outputDir}/playwright-results.json` }]],
  outputDir: fixture.outputDir,
  use: { baseURL: fixture.webOrigin, headless: true, acceptDownloads: true,
    serviceWorkers: 'block', trace: 'off', video: 'off', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop-chromium', use: { browserName: 'chromium', viewport: { width: 1440, height: 1000 } } },
    { name: 'narrow-chromium', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
