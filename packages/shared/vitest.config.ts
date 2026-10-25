import { vitestPreset } from '@shipfair/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(
  vitestPreset,
  defineConfig({
    test: {
      coverage: {
        provider: 'v8',
        include: ['src/**/*.ts'],
        exclude: ['src/**/*.test.ts', 'src/**/*.d.ts'],
        reporter: ['text', 'json-summary'],
        // CODING_STANDARDS.md §8: 80% lines for packages/shared.
        thresholds: { lines: 80 },
      },
    },
  }),
);
