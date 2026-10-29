import * as z from 'zod';
import { Handle } from './common.ts';
import { WorldSnapshot } from './world.ts';

// Request/response schemas for routes that exist. Each later prompt adds the ones for its routes.

/** The one error shape every `/api` route returns (ARCHITECTURE.md §6). */
export const ApiError = z.object({
  error: z.object({
    code: z.string().regex(/^[a-z][a-z0-9_]*$/),
    message: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** GET /api/world takes no parameters. Unknown query keys (cache busters) are dropped. */
export const WorldRequestQuery = z.object({});
export type WorldRequestQuery = z.infer<typeof WorldRequestQuery>;

export const WorldResponse = WorldSnapshot;
export type WorldResponse = z.infer<typeof WorldResponse>;

/** GET /api/health takes no parameters. */
export const HealthRequestQuery = z.object({});
export type HealthRequestQuery = z.infer<typeof HealthRequestQuery>;

export const HealthResponse = z.object({
  ok: z.boolean(),
  /** Build version (git sha or tag). */
  version: z.string().min(1),
  db: z.enum(['ok', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

/** POST /api/me/delete: the user types their handle to confirm. */
export const DeleteAccountRequest = z.object({ handle: Handle });
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequest>;

export const DeleteAccountResponse = z.object({
  ok: z.literal(true),
  /** Booth media keys queued for deletion after 30 days. */
  queuedMedia: z.int().nonnegative(),
});
export type DeleteAccountResponse = z.infer<typeof DeleteAccountResponse>;
