import type { AnalyticsMode } from '@shipfair/shared';
import type { PostHog } from 'posthog-js/dist/module.no-external';

// Product events (INFRASTRUCTURE.md §8, docs/ANALYTICS.md) sent to PostHog (prompt 15).
//
// Privacy rules, in order:
// - Do Not Track or Global Privacy Control, or "Don't track me" in Settings: PostHog never loads
//   and nothing is sent.
// - By default an anonymous visitor's PostHog id lives in memory only (no cookie, no storage), so
//   every visit is a new id. Only `remember` (an opt-in in Settings) stores it.
// - No autocapture, no session recording, no surveys, no remote scripts. Only the events below,
//   with ids, counts and tiers: never chat text, names or emails.
//
// The SDK is imported lazily (after the first interaction or IDLE_LOAD_MS); events tracked before
// that wait in a small queue. Non-production builds also expose them as `window.__shipfairEvents`
// for e2e.

export type AnalyticsEvent =
  | { name: 'world_loaded'; props: { loadMs: number; tier: string; booths: number } }
  | { name: 'booth_open'; props: { boothId: string; source: 'walk' | 'share_link' } }
  | { name: 'booth_try_click'; props: { boothId: string } }
  | { name: 'share_link_opened'; props: { slug: string; found: boolean } }
  | { name: 'submit_started'; props: { isEdit: boolean } }
  | {
      name: 'submit_completed';
      props: { boothId: string; kind: 'booth' | 'revision'; score: number };
    }
  | { name: 'chat_sent'; props: { length: number } }
  | { name: 'perf_sample'; props: { fps: number; tier: string; seconds: number } };

/** Context added to every event, kept current by the shell (`setAnalyticsContext`). */
export interface AnalyticsContext {
  /** Engine quality tier in use (`high` / `low`). */
  tier?: string;
  /** `touch` or `desktop` (pointer type). */
  deviceClass?: 'touch' | 'desktop';
  /** Slug of the district the player is in; `plaza` outside them. */
  district?: string;
}

export interface AnalyticsConfig {
  key: string | undefined;
  /** PostHog API host; EU cloud by default (docs/ANALYTICS.md). */
  host: string;
  release: string | undefined;
  environment: string;
}

export const DEFAULT_POSTHOG_HOST = 'https://eu.i.posthog.com';
export const IDLE_LOAD_MS = 15_000;
const MAX_BUFFERED = 200;
const INTERACTIONS = ['pointerdown', 'keydown', 'touchstart'] as const;

/** Non-production builds only: `?telemetry=e2e` turns PostHog and Sentry on with test keys. */
export const E2E_POSTHOG_KEY = 'phc_e2e_test_key';
export const isTelemetryE2e = (): boolean =>
  import.meta.env.MODE !== 'production' &&
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).get('telemetry') === 'e2e';

export function readAnalyticsConfig(): AnalyticsConfig {
  return {
    key: import.meta.env.VITE_POSTHOG_KEY || (isTelemetryE2e() ? E2E_POSTHOG_KEY : undefined),
    host: import.meta.env.VITE_POSTHOG_HOST || DEFAULT_POSTHOG_HOST,
    release: import.meta.env.VITE_RELEASE || undefined,
    environment: import.meta.env.MODE,
  };
}

interface PrivacySignals {
  doNotTrack?: string | null | undefined;
  globalPrivacyControl?: boolean | undefined;
}

/** The browser asks not to be tracked (DNT header setting or Global Privacy Control). */
export function browserOptsOut(signals: PrivacySignals | undefined): boolean {
  if (!signals) return false;
  return (
    signals.doNotTrack === '1' ||
    signals.doNotTrack === 'yes' ||
    signals.globalPrivacyControl === true
  );
}

export const browserSignals = (): PrivacySignals | undefined =>
  typeof navigator === 'undefined'
    ? undefined
    : {
        doNotTrack:
          navigator.doNotTrack ?? (window as { doNotTrack?: string | null }).doNotTrack ?? null,
        globalPrivacyControl: (navigator as { globalPrivacyControl?: boolean })
          .globalPrivacyControl,
      };

/** What actually happens for a mode, after the browser's own signals. */
export function effectiveMode(mode: AnalyticsMode, signals = browserSignals()): AnalyticsMode {
  return browserOptsOut(signals) ? 'off' : mode;
}

/** PostHog's options for a mode (never called for `off`). */
export function posthogOptions(config: AnalyticsConfig, mode: Exclude<AnalyticsMode, 'off'>) {
  return {
    api_host: config.host,
    persistence: mode === 'remember' ? ('localStorage+cookie' as const) : ('memory' as const),
    autocapture: false,
    capture_pageview: false,
    capture_pageleave: false,
    capture_dead_clicks: false,
    capture_exceptions: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_external_dependency_loading: true,
    advanced_disable_flags: true,
    respect_dnt: true,
    // No person profiles: these are anonymous visitors.
    person_profiles: 'identified_only' as const,
    save_referrer: false,
    save_campaign_params: false,
    mask_personal_data_properties: true,
  };
}

let districtOfBooth: (boothId: string) => string | undefined = () => undefined;

/** How booth events get their booth's district (the world store knows; set by the shell). */
export function setBoothDistrictResolver(resolve: (boothId: string) => string | undefined): void {
  districtOfBooth = resolve;
}

const snake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

/** PostHog property names are snake_case (`boothId` → `booth_id`). */
export function eventProperties(
  event: AnalyticsEvent,
  context: AnalyticsContext,
): Record<string, string | number | boolean> {
  const props: Record<string, string | number | boolean> = {};
  // A booth event's district is the booth's, not where the player happens to stand.
  const district = 'boothId' in event.props ? districtOfBooth(event.props.boothId) : undefined;
  const boothDistrict = district ? { district } : {};
  for (const [key, value] of Object.entries({ ...context, ...event.props, ...boothDistrict })) {
    if (value !== undefined) props[snake(key)] = value;
  }
  return props;
}

// --- runtime -------------------------------------------------------------------------------------

const buffer: AnalyticsEvent[] = [];
let pending: { event: AnalyticsEvent; props: Record<string, string | number | boolean> }[] = [];
let context: AnalyticsContext = {};
let mode: AnalyticsMode = 'off';
let config: AnalyticsConfig = readAnalyticsConfig();
let client: PostHog | null = null;
let loading: Promise<PostHog | null> | null = null;
let disarm: (() => void) | null = null;

export function setAnalyticsContext(patch: AnalyticsContext): void {
  context = { ...context, ...patch };
}

export function track(event: AnalyticsEvent): void {
  buffer.push(event);
  if (buffer.length > MAX_BUFFERED) buffer.shift();
  if (import.meta.env.MODE !== 'production') window.__shipfairEvents = buffer;
  if (mode === 'off' || !config.key) return;
  const props = eventProperties(event, context);
  if (client) client.capture(event.name, props);
  else if (pending.length < MAX_BUFFERED) pending.push({ event, props });
}

async function load(): Promise<PostHog | null> {
  const active = mode;
  if (active === 'off' || !config.key) return null;
  loading ??= import('posthog-js/dist/module.no-external').then(
    ({ default: posthog }) => {
      // The mode may have changed while the SDK downloaded.
      if (mode === 'off') return null;
      posthog.init(config.key ?? '', {
        ...posthogOptions(config, mode === 'remember' ? 'remember' : 'anonymous'),
        // PostHog drops headless browsers as bots; e2e (`?telemetry=e2e`) is one on purpose.
        ...(isTelemetryE2e() ? { opt_out_useragent_filter: true } : {}),
      });
      posthog.register({ release: config.release ?? 'dev', environment: config.environment });
      client = posthog;
      if (import.meta.env.MODE !== 'production') window.__shipfairPosthog = posthog;
      for (const { event, props } of pending.splice(0)) posthog.capture(event.name, props);
      return posthog;
    },
    (error: unknown) => {
      console.warn('Analytics could not load', error);
      loading = null;
      return null;
    },
  );
  return loading;
}

function arm(): void {
  if (disarm || client || !config.key) return;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const go = () => {
    disarm?.();
    void load();
  };
  disarm = () => {
    for (const type of INTERACTIONS) window.removeEventListener(type, go, true);
    if (timer !== undefined) clearTimeout(timer);
    disarm = null;
  };
  for (const type of INTERACTIONS) {
    window.addEventListener(type, go, { capture: true, once: true, passive: true });
  }
  timer = setTimeout(go, IDLE_LOAD_MS);
}

/** Wipes PostHog's id from storage (if it was stored) and from memory. */
function forget(posthog: PostHog): void {
  posthog.set_config({ persistence: 'memory' });
  posthog.reset();
}

/**
 * Applies the Settings choice (and the browser's DNT/GPC). Call at start and on every change:
 * `off` stops sending and forgets PostHog's id; `remember` → `anonymous` forgets the stored id.
 * PostHog's own opt-out isn't used: it would store a flag, and `track` already sends nothing.
 */
export function applyAnalyticsMode(requested: AnalyticsMode, next = readAnalyticsConfig()): void {
  config = next;
  const previous = mode;
  mode = effectiveMode(requested);
  if (mode === 'off') {
    pending = [];
    disarm?.();
    if (client && previous !== 'off') forget(client);
    return;
  }
  if (client) {
    if (previous === 'remember' && mode === 'anonymous') forget(client);
    if (mode === 'remember') client.set_config({ persistence: 'localStorage+cookie' });
    return;
  }
  arm();
}
