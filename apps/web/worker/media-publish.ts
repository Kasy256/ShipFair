import type { Env } from './env.ts';
import { pendingKey } from './uploads.ts';

// Approval makes media public (TRUST_AND_SAFETY.md "Uploads are private until approved"): each
// object is copied from `pending/<key>` to `<key>`, which the media host serves. Keys are content
// hashes, so a key that is already public is left as it is. The pending copies are only deleted
// once the approval has committed; if it fails, the new public copies are removed again, so an
// unapproved image never stays public. Used by the admin approve route (prompt 09).

/** Cached for a year: a key never changes content (INFRASTRUCTURE.md §6). */
const PUBLIC_CACHE_CONTROL = 'public, max-age=31536000, immutable';

export interface PublishedMedia {
  /** Keys with no object anywhere (nothing to show for them). */
  readonly missing: string[];
  /** Keys this call made public. */
  readonly copied: string[];
}

/** Copies `keys` from `pending/` to the public prefix. */
export async function publishMedia(env: Env, keys: readonly string[]): Promise<PublishedMedia> {
  const missing: string[] = [];
  const copied: string[] = [];
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
    copied.push(key);
  }
  return { missing, copied };
}

/** After the approval committed: the pending copies are no longer needed. */
export async function finishPublish(env: Env, published: PublishedMedia): Promise<void> {
  if (published.copied.length > 0) await env.MEDIA.delete(published.copied.map(pendingKey));
}

/** The approval failed: take back what `publishMedia` made public. The pending copies remain. */
export async function undoPublish(env: Env, copied: readonly string[]): Promise<void> {
  if (copied.length > 0) await env.MEDIA.delete([...copied]);
}
