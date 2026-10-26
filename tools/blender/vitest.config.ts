import { vitestPreset } from '@shipfair/config/vitest';
import { defineConfig, mergeConfig } from 'vitest/config';

export default mergeConfig(vitestPreset, defineConfig({ test: { include: ['*.test.ts'] } }));
