import type { Env } from './env.ts';
import { pendingKey } from './uploads.ts';

// Approval makes media public (TRUST_AND_SAFETY.md "Uploads are private until approved"): each
// object is copied from `pending/<key>` to `<key>`, which the media host serves, then the pending
// copy is deleted. Keys are content hashes, so a key that is already public is left as it is.
// Used by the approve routes (prompt 09; the development helper in dev.ts until then).

/** Cached for a year: a key never changes content (INFRASTRUCTURE.md §6). */
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

/** Publishes `keys`. Returns the keys that had no object anywhere (nothing to show for them). */
export async function publishMedia(env: Env, keys: readonly string[]): Promise<string[]> {
  const missing: string[] = [];
  for (const key of new Set(keys)) {
    if (await env.MEDIA.head(key)) continue;
    const pending = await env.MEDIA.get(pendingKey(key));
    if (!pending) {
      missing.push(key);
      continue;
    }
    // Buffered: R2 needs a known length, and these are at most 600 KB.
    await env.MEDIA.put(key, await pending.arrayBuffer(), {
      httpMetadata: { contentType: 'image/webp', cacheControl: PUBLIC_CACHE_CONTROL },
    });
    await env.MEDIA.delete(pendingKey(key));
  }
  return missing;
}
