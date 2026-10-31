import { CHAT_MAX_CHARS, filterProfanity, normaliseText } from '@shipfair/shared';
import { CHAT_MUTE_MS, CHAT_STRIKE_WINDOW_MS, CHAT_STRIKES } from '../limits.ts';

// Chat text handling (TRUST_AND_SAFETY.md "Chat"). Pure, so the rules are unit-tested.

// A scheme link, a www. link, or a bare domain with a common TLD, up to the next space.
const LINK =
  /\b(?:[a-z][a-z0-9+.-]*:\/\/\S+|www\.\S+|[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|net|org|io|ai|dev|app|co|xyz|me|gg|ly|sh|so|to|tv|info|biz|link|site|online|club|shop|ru|cn|uk|de)\b\S*)/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/**
 * Links become plain, unclickable text: the scheme is dropped and dots turn into `[.]`
 * ("https://evil.com/x" → "evil[.]com/x"). The client never linkifies either.
 */
export function delink(text: string): string {
  return text.replace(LINK, (link) => link.replace(SCHEME, '').replaceAll('.', '[.]'));
}

export interface PreparedChat {
  /** What everyone sees: normalised, de-linked, profanity starred out, ≤ CHAT_MAX_CHARS. */
  readonly text: string;
  /** The filter changed something (counts as a strike). */
  readonly isFiltered: boolean;
}

/** Null when nothing is left to send. */
export function prepareChat(raw: string): PreparedChat | null {
  const clean = normaliseText(raw);
  if (clean.length === 0) return null;
  const filtered = filterProfanity(clean);
  // De-linking adds characters, so trim back to the limit by code points.
  const text = Array.from(delink(filtered.text)).slice(0, CHAT_MAX_CHARS).join('');
  return { text, isFiltered: filtered.hasProfanity };
}

export interface StrikeResult {
  /** Strike times still inside the window, including this one. */
  readonly strikes: number[];
  /** Epoch ms the player is muted until, or 0 when this strike didn't trigger a mute. */
  readonly mutedUntil: number;
}

/** Records a filtered message; 3 within 5 minutes mean a 10-minute mute (and a fresh count). */
export function addStrike(strikes: readonly number[], nowMs: number): StrikeResult {
  const recent = strikes.filter((t) => nowMs - t < CHAT_STRIKE_WINDOW_MS);
  recent.push(nowMs);
  if (recent.length >= CHAT_STRIKES) return { strikes: [], mutedUntil: nowMs + CHAT_MUTE_MS };
  return { strikes: recent, mutedUntil: 0 };
}
