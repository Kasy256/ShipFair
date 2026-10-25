import { describe, expect, it } from 'vitest';
import { APP_NAME, APP_TAGLINE, APP_URL_DEFAULT } from './index.ts';

describe('brand', () => {
  it('exposes the app name, tagline and default URL', () => {
    expect(APP_NAME).toBe('ShipFair');
    expect(APP_TAGLINE.length).toBeGreaterThan(0);
    expect(new URL(APP_URL_DEFAULT).protocol).toBe('https:');
  });
});
