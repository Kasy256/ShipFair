import { defineConfig, devices } from '@playwright/test';

// Expects `pnpm dev` to be running already (web on :5173, realtime on :1999).
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173';

// SwiftShader gives headless Chromium a software WebGL implementation.
const swiftshader = {
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
};

export default defineConfig({
  testDir: './tests',
  outputDir: './artifacts',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
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
