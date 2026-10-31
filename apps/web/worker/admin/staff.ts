import { type AdminMe, StaffRole } from '@shipfair/shared';
import * as z from 'zod';
import type { Env } from '../env.ts';
import { AppError } from '../errors.ts';
import { requireUser, serviceDb } from '../service.ts';

// Every `/api/admin/*` request: Supabase Auth says who the bearer token belongs to, then the
// service role reads that profile's role. Nothing the browser says about itself is trusted.

const RoleRow = z.array(z.object({ handle: z.string(), role: z.string() })).max(1);

export type Staff = AdminMe;

export async function requireStaff(env: Env, authorization: string | undefined): Promise<Staff> {
  const userId = await requireUser(env, authorization);
  const [row] = RoleRow.parse(
    await serviceDb(env).select('profiles', { id: `eq.${userId}` }, 'handle,role'),
  );
  const role = StaffRole.safeParse(row?.role);
  if (!row || !role.success) throw new AppError('forbidden', 403, 'Staff only');
  return { userId, handle: row.handle, role: role.data };
}
