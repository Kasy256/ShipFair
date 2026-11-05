import { describe, expect, it } from 'vitest';
import { FILTERED, scrubBreadcrumb, scrubEvent, scrubPii, scrubText } from './scrub.ts';
import { workerSentryOptions } from './sentry-options.ts';

describe('scrubText', () => {
  it('blanks email addresses and leaves the rest', () => {
    expect(scrubText('mail ada.lovelace+x@example.co.uk now')).toBe(`mail ${FILTERED} now`);
    expect(scrubText('handle @maker1 and v1.2@3')).toBe('handle @maker1 and v1.2@3');
  });
});

describe('scrubPii', () => {
  it('drops chat lines, notes and credentials at any depth', () => {
    const input = {
      extra: { context: [{ text: 'hello there', ts: 1 }], note: 'he said…', count: 3 },
      request: { headers: { Authorization: 'Bearer abc', 'content-type': 'json' } },
      list: [{ text: 'hi' }, 'x@y.io'],
    };
    expect(scrubPii(input)).toEqual({
      extra: { context: FILTERED, note: FILTERED, count: 3 },
      request: { headers: { Authorization: FILTERED, 'content-type': 'json' } },
      list: [{ text: FILTERED }, FILTERED],
    });
    // The input is not modified.
    expect(input.extra.note).toBe('he said…');
  });
});

describe('scrubEvent', () => {
  it('keeps only the user id, drops typing breadcrumbs and request bodies', () => {
    const event = scrubEvent({
      message: 'failed for bob@example.com',
      user: { id: 'u1', email: 'bob@example.com', ip_address: '1.2.3.4' },
      request: { url: 'https://x.test/?e=bob@example.com', data: '{"text":"hi"}' },
      breadcrumbs: [
        { category: 'ui.input', message: 'input.chat' },
        { category: 'console', message: 'chat from bob@example.com' },
      ],
      contexts: { browser: { name: 'Chrome' } },
    });
    expect(event).toEqual({
      message: `failed for ${FILTERED}`,
      user: { id: 'u1' },
      request: { url: `https://x.test/?e=${FILTERED}` },
      breadcrumbs: [{ category: 'console', message: `chat from ${FILTERED}` }],
      contexts: { browser: { name: 'Chrome' } },
    });
  });

  it('removes a user without an id', () => {
    expect(scrubEvent({ user: { email: 'a@b.cd' } })).toEqual({});
  });
});

describe('scrubBreadcrumb', () => {
  it('drops input breadcrumbs and scrubs the others', () => {
    expect(scrubBreadcrumb({ category: 'ui.input' })).toBeNull();
    expect(
      scrubBreadcrumb({ category: 'fetch', data: { url: '/a?u=x@y.io', status: 500 } }),
    ).toEqual({
      category: 'fetch',
      data: { url: `/a?u=${FILTERED}`, status: 500 },
    });
  });
});

describe('workerSentryOptions', () => {
  it('is disabled without a DSN and scrubs events with one', () => {
    expect(workerSentryOptions({ ENVIRONMENT: 'development' }).enabled).toBe(false);
    const options = workerSentryOptions({
      SENTRY_DSN: 'https://k@o1.ingest.de.sentry.io/1',
      RELEASE: 'abc123',
      ENVIRONMENT: 'staging',
    });
    expect(options).toMatchObject({ enabled: true, release: 'abc123', environment: 'staging' });
    expect(options.tracesSampleRate).toBe(0);
    expect(options.beforeSend({ message: 'a@b.io', extra: { text: 'gg' } })).toEqual({
      message: FILTERED,
      extra: { text: FILTERED },
    });
  });
});
