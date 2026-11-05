import {
  AdminCursor,
  BanRequest,
  DeleteAccountRequest,
  FlagUpdate,
  Handle,
  HealthRequestQuery,
  HideRequest,
  LogFilter,
  MergeRequest,
  RejectRequest,
  ReportStatusRequest,
  Slug,
  StampRequest,
  SubmitBoothRequest,
  SubmitRevisionRequest,
  UnbanRequest,
  UploadSignRequest,
  UrlCheckRequest,
  UserSearchQuery,
  Uuid,
  WorldRequestQuery,
} from '@shipfair/shared';
import * as z from 'zod';

// The contract of every route the web Worker serves (prompt 15 security pass): who may call it
// and the zod schema of each input. Bodies are parsed with these same schema objects (from
// packages/shared); params and queries with the same schemas or equivalent checks.
// `routes.test.ts` enumerates `app.routes`, fails if a route is missing here, and checks the
// contract against the running Worker: protected routes refuse anonymous and non-staff calls,
// bodies that fail their schema get a 400, and malformed ids never reach a 5xx.

export type RouteAuth =
  /** Anyone; rate-limited where it writes. */
  | 'public'
  /** A signed-in user (Supabase access token). */
  | 'user'
  /** Staff (moderator or admin), checked by the /api/admin middleware. */
  | 'staff'
  /** 404 outside `ENVIRONMENT=development`. */
  | 'dev';

export interface RouteContract {
  auth: RouteAuth;
  /** Path parameters (`:id`, `*`), validated before use. */
  params?: z.ZodType;
  query?: z.ZodType;
  /** JSON body. Every POST/PUT has one, or says why not in `noBody`. */
  body?: z.ZodType;
  noBody?: string;
}

const Id = z.object({ id: Uuid });
const Cursor = z.object({ cursor: AdminCursor.optional() });
/** Approved media keys staff may fetch (`u/<owner>/<sha256>.webp`). */
export const AdminMediaKey = z.string().regex(/^u\/[0-9a-f-]{36}\/[0-9a-f]{64}\.webp$/);

export const ROUTES = {
  'GET /api/health': { auth: 'public', query: HealthRequestQuery },
  'GET /api/world': { auth: 'public', query: WorldRequestQuery },
  'GET /b/:slug': { auth: 'public', params: z.object({ slug: Slug }) },
  'GET /u/:handle': { auth: 'public', params: z.object({ handle: Handle }) },
  'POST /api/me/delete': { auth: 'user', body: DeleteAccountRequest },
  'POST /api/uploads/sign': { auth: 'user', body: UploadSignRequest },
  'PUT /api/uploads/local': {
    auth: 'dev',
    query: z.object({ t: z.string() }),
    noBody: 'raw image bytes, checked against the signed token (size, type, sha256)',
  },
  'POST /api/booths/check-url': { auth: 'user', body: UrlCheckRequest },
  'POST /api/booths/:id/submit': { auth: 'user', params: Id, body: SubmitBoothRequest },
  'POST /api/booths/:id/revision': { auth: 'user', params: Id, body: SubmitRevisionRequest },
  'POST /api/passport/stamp': { auth: 'user', body: StampRequest },
  'POST /api/passport/merge': { auth: 'user', body: MergeRequest },
  'POST /api/booths/:id/try': {
    auth: 'public',
    params: Id,
    noBody: 'a click counter; limited per IP',
  },
  'GET /api/submissions/status': { auth: 'public' },
  'GET /api/admin/me': { auth: 'staff' },
  'GET /api/admin/queue': { auth: 'staff', query: Cursor },
  'GET /api/admin/reports': { auth: 'staff', query: Cursor },
  'GET /api/admin/users': {
    auth: 'staff',
    query: Cursor.extend({ q: UserSearchQuery.optional() }),
  },
  'GET /api/admin/users/:id': { auth: 'staff', params: Id },
  'GET /api/admin/log': { auth: 'staff', query: Cursor.extend(LogFilter.shape) },
  'GET /api/admin/flags': { auth: 'staff' },
  'GET /api/admin/media/*': { auth: 'staff', params: z.object({ key: AdminMediaKey }) },
  'POST /api/admin/booths/:id/approve': {
    auth: 'staff',
    params: Id,
    noBody: 'the booth id is the whole request',
  },
  'POST /api/admin/booths/:id/reject': { auth: 'staff', params: Id, body: RejectRequest },
  'POST /api/admin/hide': { auth: 'staff', body: HideRequest },
  'POST /api/admin/ban': { auth: 'staff', body: BanRequest },
  'POST /api/admin/unban': { auth: 'staff', body: UnbanRequest },
  'POST /api/admin/reports/:id': {
    auth: 'staff',
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: ReportStatusRequest,
  },
  'PUT /api/admin/flags': { auth: 'staff', body: FlagUpdate },
  'GET /u/:owner/:file': {
    auth: 'dev',
    params: z.object({ owner: Uuid, file: z.string().regex(/^[0-9a-f]{64}\.webp$/) }),
  },
  'GET /api/dev/ping-realtime': { auth: 'dev' },
} as const satisfies Record<string, RouteContract>;

export type RouteKey = keyof typeof ROUTES;
