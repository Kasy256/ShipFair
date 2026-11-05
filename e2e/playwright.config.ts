import { defineConfig, devices } from '@playwright/test';

// Expects `pnpm dev` to be running already (web on :5173, realtime on :1999). Against staging
// (deploy-staging.yml) E2E_BASE_URL is the staging site and only `@smoke` tests run.
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';
const isCI = Boolean(process.env.CI);

// SwiftShader gives headless Chromium a software WebGL implementation.
const swiftshader = {
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts',
  forbidOnly: isCI,
  // Flake control (prompt 15): one retry in CI only, and every test that needed it is reported
  // as flaky (scripts/e2e-report.ts reads reports/results.json). Locally a failure is a failure.
  retries: isCI ? 1 : 0,
  reporter: isCI
    ? [['github'], ['list'], ['json', { outputFile: 'reports/results.json' }]]
    : 'list',
  // Engine specs run thousands of physics steps on a software GPU.
  timeout: 120_000,
  use: {
    baseURL,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      testIgnore: [/\.mobile\.spec\.ts$/, /\.perf\.spec\.ts$/],
      use: { ...devices['Desktop Chrome'], launchOptions: swiftshader },
    },
    // Prompt 14: render budgets (e2e/perf-budgets.json). Its own CI job; it needs only the web
    // dev server (fake world, test mode), not Supabase or realtime.
    {
      name: 'perf',
      testMatch: /\.perf\.spec\.ts$/,
      use: { ...devices['Desktop Chrome'], launchOptions: swiftshader },
    },
    {
      name: 'mobile',
      testMatch: /\.mobile\.spec\.ts$/,
      use: { ...devices['Pixel 7'], launchOptions: swiftshader },
    },
  ],
});
