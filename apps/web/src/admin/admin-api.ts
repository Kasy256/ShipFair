import {
  AdminActionResponse,
  AdminFlags,
  AdminUserDetail,
  ApiError,
  type BanRequest,
  type FlagUpdate,
  type HideRequest,
  type LogFilter,
  LogPage,
  QueuePage,
  type RejectRequest,
  ReportPage,
  type ReportStatus,
  UserPage,
} from '@shipfair/shared';
import type * as z from 'zod';
import { accessToken } from '../state/use-auth-sync.ts';

// `/api/admin/*` from the browser. Every call sends the session's access token; the Worker
// re-checks it and the staff role each time. Responses are parsed with the shared schemas.

export class AdminApiError extends Error {
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'AdminApiError';
    this.code = code;
  }
}

async function authHeaders(): Promise<Record<string, string>> {
  const token = await accessToken();
  if (!token) throw new AdminApiError('unauthorized', 'Your session ended; sign in again');
  return { authorization: `Bearer ${token}` };
}

async function request<T>(
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  schema: z.ZodType<T>,
  body?: unknown,
): Promise<T> {
  const headers = await authHeaders();
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? headers : { ...headers, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  } catch (error) {
    throw new AdminApiError('network', "Couldn't reach the server; check your connection", {
      cause: error,
    });
  }
  const json: unknown = await res.json().catch(() => null);
  if (res.ok) return schema.parse(json);
  const error = ApiError.safeParse(json);
  // Staff see the server's message: it names the problem ("booth is not pending").
  throw error.success
    ? new AdminApiError(error.data.error.code, error.data.error.message)
    : new AdminApiError('network', `Request failed (${res.status})`);
}

const query = (params: Record<string, string | undefined>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : '';
};

export const fetchQueue = (cursor?: string) =>
  request('GET', `/api/admin/queue${query({ cursor })}`, QueuePage);
export const fetchReports = (cursor?: string) =>
  request('GET', `/api/admin/reports${query({ cursor })}`, ReportPage);
export const searchUsers = (q: string, cursor?: string) =>
  request('GET', `/api/admin/users${query({ q, cursor })}`, UserPage);
export const fetchUser = (id: string) => request('GET', `/api/admin/users/${id}`, AdminUserDetail);
export const fetchLog = (filter: LogFilter, cursor?: string) =>
  request('GET', `/api/admin/log${query({ ...filter, cursor })}`, LogPage);
export const fetchFlags = () => request('GET', '/api/admin/flags', AdminFlags);

export const approveBooth = (boothId: string) =>
  request('POST', `/api/admin/booths/${boothId}/approve`, AdminActionResponse, {});
export const rejectBooth = (boothId: string, body: RejectRequest) =>
  request('POST', `/api/admin/booths/${boothId}/reject`, AdminActionResponse, body);
export const hideTarget = (body: HideRequest) =>
  request('POST', '/api/admin/hide', AdminActionResponse, body);
export const banUser = (body: BanRequest) =>
  request('POST', '/api/admin/ban', AdminActionResponse, body);
export const unbanUser = (userId: string) =>
  request('POST', '/api/admin/unban', AdminActionResponse, { userId });
export const setReportStatus = (id: number, status: ReportStatus) =>
  request('POST', `/api/admin/reports/${id}`, AdminActionResponse, { status });
export const setFlag = (update: FlagUpdate) =>
  request('PUT', '/api/admin/flags', AdminActionResponse, update);

/** Media (pending or public) through the staff-only route, as a blob URL to revoke later. */
export async function fetchMediaUrl(key: string): Promise<string> {
  const res = await fetch(`/api/admin/media/${key}`, { headers: await authHeaders() });
  if (!res.ok) throw new AdminApiError('not_found', `No image (${res.status})`);
  return URL.createObjectURL(await res.blob());
}

/** Text for an error, for staff (who get the server's message). */
export const adminErrorText = (error: unknown): string =>
  error instanceof AdminApiError ? error.message : 'Something went wrong; try again';
