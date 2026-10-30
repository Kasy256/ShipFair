import { DeleteAccountRequest, type DeleteAccountResponse } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from './env.ts';
import { AppError } from './errors.ts';
import { serviceDb } from './service.ts';

// POST /api/me/delete (ARCHITECTURE.md §6). The caller proves who they are with their Supabase
// access token (checked by Supabase Auth itself, so a revoked session fails too) and types their
// handle to confirm. The service role then runs `delete_account`, which queues the booth media
// for R2 cleanup and deletes the auth user in one transaction; everything else cascades.

export { requireUser } from './service.ts';

const HandleRow = z.array(z.object({ handle: z.string() })).max(1);

export async function deleteAccount(
  env: Env,
  userId: string,
  body: unknown,
): Promise<DeleteAccountResponse> {
  const request = DeleteAccountRequest.safeParse(body);
  if (!request.success) throw new AppError('bad_request', 400, 'Type your handle to confirm');
  const db = serviceDb(env);

  const rows = HandleRow.safeParse(await db.select('profiles', { id: `eq.${userId}` }, 'handle'));
  const handle = rows.success ? rows.data[0]?.handle : undefined;
  if (!handle) throw new AppError('not_found', 404, 'This account no longer exists');
  if (handle.toLowerCase() !== request.data.handle.toLowerCase()) {
    throw new AppError('handle_mismatch', 400, "That isn't your handle");
  }

  const queued = z
    .int()
    .nonnegative()
    .safeParse(await db.rpc('delete_account', { uid: userId }));
  return { ok: true, queuedMedia: queued.success ? queued.data : 0 };
}
