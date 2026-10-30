import { describe, expect, it } from 'vitest';
import { isBlockedHost } from './blocked-domains.ts';
import {
  blocklistCheck,
  imageCheck,
  type PrescreenCheck,
  type PrescreenInput,
  prescreen,
  safeBrowsingCheck,
  textCheck,
} from './prescreen.ts';
import { openAiModerator, uncheckedModerator } from './text-moderation.ts';
import { checkUrl } from './url-check.ts';

// Outbound fetches reach the test stub: *.site.test are fake sites (ok, down, hop, loop, insecure).

const input: PrescreenInput = {
  name: 'Nice App',
  tagline: 'Does a nice thing for nice people',
  description: null,
  url: 'https://ok.site.test/',
  images: [
    { key: 'u/x/logo.webp', kind: 'logo', w: 512, h: 512 },
    { key: 'u/x/a.webp', kind: 'screenshot', w: 1280, h: 720 },
  ],
};

const fake = (
  name: string,
  outcome: Awaited<ReturnType<PrescreenCheck['run']>>,
): PrescreenCheck => ({
  name,
  run: async () => outcome,
});

describe('prescreen', () => {
  it('merges flags from every check and sums their weights', async () => {
    const result = await prescreen(input, [
      fake('a', { flags: ['url_unreachable'], finalUrl: null }),
      fake('b', { flags: ['text_flagged', 'url_unreachable'] }),
      fake('c', { flags: [] }),
    ]);
    expect(result).toEqual({
      score: 7,
      flags: ['text_flagged', 'url_unreachable'],
      finalUrl: null,
    });
  });

  it('skips a check that throws instead of failing the submission', async () => {
    const broken: PrescreenCheck = {
      name: 'broken',
      run: async () => {
        throw new Error('vendor down');
      },
    };
    const result = await prescreen(input, [
      broken,
      fake('url', { flags: [], finalUrl: input.url }),
    ]);
    expect(result).toEqual({ score: 0, flags: [], finalUrl: input.url });
  });

  it('records the text as unchecked without a vendor, flagged on profanity either way', async () => {
    expect((await textCheck(uncheckedModerator).run(input)).flags).toEqual(['text_unchecked']);
    const rude = { ...input, tagline: 'The shittiest app you will ever use' };
    expect((await textCheck(uncheckedModerator).run(rude)).flags).toEqual(['text_flagged']);
  });

  it('treats a vendor error as unchecked, never as clean', async () => {
    const failing = openAiModerator('key', async () => new Response('no', { status: 500 }));
    expect(await failing.moderate(['hello'])).toBe('unchecked');
    const flagging = openAiModerator('key', async () =>
      Response.json({ results: [{ flagged: false }, { flagged: true }] }),
    );
    expect(await flagging.moderate(['a', 'b'])).toBe('flagged');
  });

  it('records Safe Browsing as unchecked without a key', async () => {
    expect((await safeBrowsingCheck(undefined).run(input)).flags).toEqual([
      'safe_browsing_unchecked',
    ]);
  });

  it('flags odd screenshot shapes', async () => {
    const tall = { ...input, images: [{ key: 'k', kind: 'screenshot' as const, w: 720, h: 1280 }] };
    expect((await imageCheck.run(tall)).flags).toEqual(['image_invalid']);
    expect((await imageCheck.run(input)).flags).toEqual([]);
  });

  it('flags blocklisted hosts, including subdomains', async () => {
    expect((await blocklistCheck().run({ ...input, url: 'https://bit.ly/abc' })).flags).toEqual([
      'url_blocklisted',
    ]);
    expect(isBlockedHost('https://go.bit.ly/x')).toBe(true);
    expect(isBlockedHost('https://notbit.ly/x')).toBe(false);
  });
});

describe('checkUrl', () => {
  it('answers ok for a 200', async () => {
    expect(await checkUrl('https://ok.site.test/')).toEqual({
      isReachable: true,
      isHttps: true,
      finalUrl: 'https://ok.site.test/',
    });
  });

  it('follows a redirect and records where it ends', async () => {
    expect((await checkUrl('https://hop.site.test/')).finalUrl).toBe(
      'https://ok.site.test/landing',
    );
  });

  it('fails on errors, redirect loops and a hop to plain http', async () => {
    expect(await checkUrl('https://down.site.test/')).toMatchObject({
      isReachable: false,
      isHttps: true,
    });
    expect(await checkUrl('https://loop.site.test/')).toMatchObject({
      isReachable: false,
      isHttps: true,
    });
    expect(await checkUrl('https://insecure.site.test/')).toMatchObject({
      isReachable: false,
      isHttps: false,
    });
  });

  it('never fetches IP literals or localhost', async () => {
    let fetched = 0;
    const counting = async () => {
      fetched++;
      return new Response('ok');
    };
    expect((await checkUrl('https://127.0.0.1/', counting)).isHttps).toBe(false);
    expect((await checkUrl('https://localhost/', counting)).isHttps).toBe(false);
    expect((await checkUrl('https://[::1]/', counting)).isHttps).toBe(false);
    expect(fetched).toBe(0);
  });

  it('gives up on a site that never answers', async () => {
    const hang = (_url: string, init: RequestInit) =>
      new Promise<Response>((_, reject) =>
        init.signal?.addEventListener('abort', () => reject(new Error('timeout'))),
      );
    const started = Date.now();
    expect((await checkUrl('https://slow.site.test/', hang)).isReachable).toBe(false);
    expect(Date.now() - started).toBeLessThan(6000);
  }, 10_000);
});
