import { filterProfanity } from '@shipfair/shared';

// Text moderation behind an interface (TRUST_AND_SAFETY.md: v1 has no vendor yet). The built-in
// profanity filter always runs; a vendor runs only when MODERATION_API_KEY is set, otherwise the
// result is `unchecked` and humans review the text as they review everything.

export type TextVerdict = 'clean' | 'flagged' | 'unchecked';

export interface TextModerator {
  moderate(texts: readonly string[]): Promise<TextVerdict>;
}

/** The shared chat filter (obscenity + our list). Never `unchecked`. */
export const profanityModerator: TextModerator = {
  moderate: async (texts) =>
    texts.some((t) => filterProfanity(t).hasProfanity) ? 'flagged' : 'clean',
};

/** No vendor configured. */
export const uncheckedModerator: TextModerator = { moderate: async () => 'unchecked' };

/**
 * OpenAI's moderation endpoint (free with an API key): one candidate vendor, chosen at launch
 * (TRUST_AND_SAFETY.md). Any non-200 answer counts as `unchecked`, never as clean.
 */
export function openAiModerator(apiKey: string, fetcher: typeof fetch = fetch): TextModerator {
  return {
    async moderate(texts) {
      const res = await fetcher('https://api.openai.com/v1/moderations', {
        method: 'POST',
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'omni-moderation-latest', input: texts }),
      });
      if (!res.ok) return 'unchecked';
      const body = (await res.json()) as { results?: { flagged?: unknown }[] };
      if (!Array.isArray(body.results)) return 'unchecked';
      return body.results.some((r) => r.flagged === true) ? 'flagged' : 'clean';
    },
  };
}

/** The vendor for this Worker: OpenAI with a key, else none. */
export function textModeratorFor(apiKey: string | undefined): TextModerator {
  return apiKey ? openAiModerator(apiKey) : uncheckedModerator;
}
