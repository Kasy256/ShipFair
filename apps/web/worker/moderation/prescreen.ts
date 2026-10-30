import type { PrescreenFlag, PrescreenResult } from '@shipfair/shared';
import type { Env } from '../env.ts';
import type { VerifiedMedia } from '../media-check.ts';
import { isBlockedHost } from './blocked-domains.ts';
import { isListedUnsafe } from './safe-browsing.ts';
import { profanityModerator, type TextModerator, textModeratorFor } from './text-moderation.ts';
import { checkUrl, type Fetcher } from './url-check.ts';

// The submit pre-screen (ARCHITECTURE.md §6, TRUST_AND_SAFETY.md "Booths"). It never blocks a
// submission: a human reviews every booth, and the score only sorts the queue (0 = clean first).
// Checks are pluggable so tests (and later vendors) can swap them. A check that throws is logged
// and skipped, so a vendor outage can't stop submissions.

export interface PrescreenInput {
  readonly name: string;
  readonly tagline: string;
  readonly description: string | null;
  readonly url: string;
  readonly images: readonly VerifiedMedia[];
}

export interface CheckOutcome {
  readonly flags: readonly PrescreenFlag[];
  /** Set by the URL check. */
  readonly finalUrl?: string | null;
}

export interface PrescreenCheck {
  readonly name: string;
  run(input: PrescreenInput): Promise<CheckOutcome>;
}

/** How much each flag pushes a booth down the queue. */
export const FLAG_WEIGHT: Readonly<Record<PrescreenFlag, number>> = {
  url_unsafe: 10,
  url_blocklisted: 5,
  text_flagged: 5,
  url_not_https: 3,
  url_unreachable: 2,
  image_invalid: 2,
  text_unchecked: 0,
  safe_browsing_unchecked: 0,
};

/** Screenshots outside these width:height ratios get a second look (16:9 is ~1.78). */
const SCREENSHOT_RATIO = { min: 1, max: 2.5 } as const;

export function urlCheck(fetcher?: Fetcher): PrescreenCheck {
  return {
    name: 'url',
    async run({ url }) {
      const result = await checkUrl(url, fetcher);
      const flags: PrescreenFlag[] = [];
      if (!result.isHttps) flags.push('url_not_https');
      else if (!result.isReachable) flags.push('url_unreachable');
      return { flags, finalUrl: result.finalUrl };
    },
  };
}

export function blocklistCheck(blocked?: readonly string[]): PrescreenCheck {
  return {
    name: 'blocklist',
    run: async ({ url }) => ({ flags: isBlockedHost(url, blocked) ? ['url_blocklisted'] : [] }),
  };
}

export function safeBrowsingCheck(apiKey: string | undefined): PrescreenCheck {
  return {
    name: 'safe_browsing',
    async run({ url }) {
      if (!apiKey) return { flags: ['safe_browsing_unchecked'] };
      return { flags: (await isListedUnsafe(apiKey, [url])) ? ['url_unsafe'] : [] };
    },
  };
}

/** The built-in profanity filter always runs; `vendor` adds a second opinion when configured. */
export function textCheck(vendor: TextModerator): PrescreenCheck {
  return {
    name: 'text',
    async run({ name, tagline, description }) {
      const texts = [name, tagline, description ?? ''].filter(Boolean);
      const [local, remote] = await Promise.all([
        profanityModerator.moderate(texts),
        vendor.moderate(texts),
      ]);
      if (local === 'flagged' || remote === 'flagged') return { flags: ['text_flagged'] };
      return { flags: remote === 'unchecked' ? ['text_unchecked'] : [] };
    },
  };
}

/** Sizes are already enforced at upload; this only flags odd screenshot shapes for reviewers. */
export const imageCheck: PrescreenCheck = {
  name: 'images',
  run: async ({ images }) => ({
    flags: images.some(
      (m) =>
        m.kind === 'screenshot' &&
        (m.w / m.h < SCREENSHOT_RATIO.min || m.w / m.h > SCREENSHOT_RATIO.max),
    )
      ? ['image_invalid']
      : [],
  }),
};

/** The checks this Worker runs, from its secrets. */
export function defaultChecks(env: Env): PrescreenCheck[] {
  return [
    urlCheck(),
    blocklistCheck(),
    safeBrowsingCheck(env.SAFE_BROWSING_KEY),
    textCheck(textModeratorFor(env.MODERATION_API_KEY)),
    imageCheck,
  ];
}

export async function prescreen(
  input: PrescreenInput,
  checks: readonly PrescreenCheck[],
): Promise<PrescreenResult> {
  const outcomes = await Promise.all(
    checks.map((check) =>
      check.run(input).catch((error: unknown): CheckOutcome => {
        console.error(`pre-screen check "${check.name}" failed; skipped`, error);
        return { flags: [] };
      }),
    ),
  );
  const flags = [...new Set(outcomes.flatMap((o) => o.flags))].sort();
  const score = flags.reduce((sum, flag) => sum + FLAG_WEIGHT[flag], 0);
  const finalUrl = outcomes.find((o) => o.finalUrl !== undefined)?.finalUrl ?? null;
  return { score, flags, finalUrl };
}
