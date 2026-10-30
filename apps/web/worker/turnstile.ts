import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';

// Cloudflare Turnstile server-side check. Tokens are single use, so callers verify after the cheap
// checks (auth, ownership) and before the expensive ones. Locally `wrangler.jsonc` sets
// Cloudflare's always-pass test secret; `2x0000000000000000000000000000000AA` always fails.

const SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

const SiteverifyResponse = z.object({
  success: z.boolean(),
  'error-codes': z.array(z.string()).default([]),
});

export async function verifyTurnstile(
  env: Env,
  token: string,
  remoteIp: string | undefined,
): Promise<void> {
  const secret = env.TURNSTILE_SECRET;
  if (!secret) throw new AppError('unavailable', 503, 'Bot protection is not configured');
  const form = new FormData();
  form.set('secret', secret);
  form.set('response', token);
  if (remoteIp) form.set('remoteip', remoteIp);
  let body: unknown;
  try {
    const res = await fetch(SITEVERIFY_URL, { method: 'POST', body: form });
    body = await res.json();
  } catch (error) {
    throw new AppError('unavailable', 503, 'Turnstile is unreachable', { cause: error });
  }
  const parsed = SiteverifyResponse.safeParse(body);
  if (!parsed.success) throw new AppError('unavailable', 503, 'Turnstile sent an odd answer');
  if (!parsed.data.success) {
    throw new AppError('turnstile_failed', 403, 'The bot check failed; try it again');
  }
}
