import { configDefaults, defineConfig } from 'vitest/config';

/** Shared Vitest settings. Packages merge their own options on top with `mergeConfig`. */
export const vitestPreset = defineConfig({
  test: {
    include: ['src/**/*.test.{ts,tsx}', 'worker/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: [...configDefaults.exclude, '**/reference/**'],
    passWithNoTests: false,
  },
});
