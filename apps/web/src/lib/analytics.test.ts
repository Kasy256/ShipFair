import { describe, expect, it } from 'vitest';
import {
  type AnalyticsConfig,
  browserOptsOut,
  DEFAULT_POSTHOG_HOST,
  effectiveMode,
  eventProperties,
  posthogOptions,
  setBoothDistrictResolver,
} from './analytics.ts';

const CONFIG: AnalyticsConfig = {
  key: 'phc_test',
  host: DEFAULT_POSTHOG_HOST,
  release: 'abc123',
  environment: 'staging',
};

describe('consent', () => {
  it('Do Not Track and Global Privacy Control turn analytics off whatever the setting', () => {
    expect(browserOptsOut({ doNotTrack: '1' })).toBe(true);
    expect(browserOptsOut({ globalPrivacyControl: true })).toBe(true);
    expect(browserOptsOut({ doNotTrack: '0', globalPrivacyControl: false })).toBe(false);
    expect(effectiveMode('remember', { doNotTrack: '1' })).toBe('off');
    expect(effectiveMode('anonymous', { globalPrivacyControl: true })).toBe('off');
    expect(effectiveMode('anonymous', {})).toBe('anonymous');
    expect(effectiveMode('off', {})).toBe('off');
  });

  it('anonymous visitors get memory-only persistence; only "remember" stores an id', () => {
    expect(posthogOptions(CONFIG, 'anonymous').persistence).toBe('memory');
    expect(posthogOptions(CONFIG, 'remember').persistence).toBe('localStorage+cookie');
  });

  it('nothing is captured automatically and no remote code is loaded', () => {
    expect(posthogOptions(CONFIG, 'anonymous')).toMatchObject({
      api_host: 'https://eu.i.posthog.com',
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
      disable_session_recording: true,
      disable_surveys: true,
      disable_external_dependency_loading: true,
      respect_dnt: true,
    });
  });
});

describe('event properties', () => {
  it('are snake_case, carry the context, and booth events carry their booth’s district', () => {
    setBoothDistrictResolver((id) => (id === 'b1' ? 'dev-tools' : undefined));
    const context = { tier: 'low', deviceClass: 'touch' as const, district: 'plaza' };
    expect(
      eventProperties({ name: 'booth_open', props: { boothId: 'b1', source: 'walk' } }, context),
    ).toEqual({
      tier: 'low',
      device_class: 'touch',
      district: 'dev-tools',
      booth_id: 'b1',
      source: 'walk',
    });
    // An unknown booth keeps the player's district.
    expect(
      eventProperties({ name: 'booth_try_click', props: { boothId: 'zz' } }, context).district,
    ).toBe('plaza');
    expect(eventProperties({ name: 'chat_sent', props: { length: 12 } }, {})).toEqual({
      length: 12,
    });
  });
});
