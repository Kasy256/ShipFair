import { APP_NAME, Handle } from '@shipfair/shared';
import * as z from 'zod';
import {
  type AppContext,
  injectMeta,
  missingPage,
  OG_PLACEHOLDER_PATH,
  spaShell,
} from './share.ts';
import { selectAnon } from './supabase.ts';

// `GET /u/:handle` (prompt 13): the SPA with a maker's passport in its OG/Twitter tags. Profiles
// and stamps are public rows, read as anon like `/api/world`. The share image is prompt 16's.

const ProfileRow = z.object({ id: z.uuid(), handle: Handle, display_name: z.string() });

async function readProfile(
  c: AppContext,
  handle: string,
): Promise<{ name: string; stamps: number } | null> {
  const rows = await selectAnon(
    c.env,
    `public_profiles?handle=eq.${handle}&select=id,handle,display_name&limit=1`,
  );
  const profile = ProfileRow.safeParse(rows[0]);
  if (!profile.success) return null;
  const stamps = await selectAnon(
    c.env,
    `passport_stamps?user_id=eq.${profile.data.id}&select=stamp`,
  );
  return { name: profile.data.display_name, stamps: stamps.length };
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export async function profilePage(c: AppContext): Promise<Response> {
  const handle = c.req.param('handle') ?? '';
  const missing = () =>
    c.html(
      missingPage(
        'Maker not found',
        'Nobody here by that name',
        `No one in the city goes by @${handle}. They may have changed their handle.`,
      ),
      404,
    );
  if (!Handle.safeParse(handle).success) return missing();
  let profile: Awaited<ReturnType<typeof readProfile>>;
  try {
    profile = await readProfile(c, handle);
  } catch (error) {
    // Supabase down: the SPA still opens and shows its own retry.
    console.warn('profile page: no meta', error);
    return spaShell(c);
  }
  if (!profile) return missing();
  const origin = new URL(c.req.url).origin;
  return injectMeta(await spaShell(c), {
    title: `${profile.name} (@${handle}) · ${APP_NAME}`,
    description: `${profile.name}'s passport: ${plural(profile.stamps, 'stamp')} collected walking around ${APP_NAME}.`,
    url: `${origin}/u/${handle}`,
    image: `${origin}${OG_PLACEHOLDER_PATH}`,
  });
}
