import { ADMIN_PAGE_SIZE, AdminCursor } from '@shipfair/shared';
import type * as z from 'zod';
import { AppError } from '../errors.ts';

// Keyset pagination over PostgREST for `GET /api/admin/*`. A cursor is the sort key of the last
// row on a page, as base64url JSON; the next page asks for rows after it with an `or=(…)` filter.

export type KeyValue = string | number;

export interface SortKey {
  readonly column: string;
  readonly isDesc?: boolean;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeCursor(values: readonly KeyValue[]): string {
  let binary = '';
  for (const byte of encoder.encode(JSON.stringify(values))) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

/** The cursor's values, or null for the first page. A cursor that doesn't parse is a 400. */
export function decodeCursor<T>(cursor: string | undefined, schema: z.ZodType<T>): T | null {
  if (cursor === undefined || cursor === '') return null;
  try {
    const base64 = AdminCursor.parse(cursor).replaceAll('-', '+').replaceAll('_', '/');
    const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0));
    return schema.parse(JSON.parse(decoder.decode(bytes)));
  } catch (error) {
    throw new AppError('bad_request', 400, 'That page link is out of date; start again', {
      cause: error,
    });
  }
}

/** A PostgREST value: quoted unless it is plainly safe (uuids, numbers, handles). */
export function pgValue(value: KeyValue): string {
  const text = String(value);
  return /^[A-Za-z0-9_.:-]+$/.test(text) && !text.includes('..')
    ? text
    : `"${text.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

/** `in.(a,b,c)` with each value quoted as needed. */
export const inList = (values: readonly KeyValue[]) => `in.(${values.map(pgValue).join(',')})`;

/** `(a.gt.x,and(a.eq.x,b.gt.y),…)`: rows strictly after `values` in the `keys` order. */
export function afterFilter(keys: readonly SortKey[], values: readonly KeyValue[]): string {
  const parts = keys.map((key, i) => {
    const equal = keys.slice(0, i).map((k, j) => `${k.column}.eq.${pgValue(values[j] ?? '')}`);
    const after = `${key.column}.${key.isDesc ? 'lt' : 'gt'}.${pgValue(values[i] ?? '')}`;
    return equal.length > 0 ? `and(${[...equal, after].join(',')})` : after;
  });
  return `(${parts.join(',')})`;
}

export const orderParam = (keys: readonly SortKey[]) =>
  keys.map((k) => `${k.column}.${k.isDesc ? 'desc' : 'asc'}`).join(',');

/** One more row than a page, so the last one tells whether there is a next page. */
export const PAGE_FETCH = String(ADMIN_PAGE_SIZE + 1);

/** Splits a fetched page into its rows and the cursor for the next page. */
export function pageOf<T>(
  rows: readonly T[],
  keyOf: (row: T) => readonly KeyValue[],
): { rows: T[]; nextCursor: string | null } {
  const page = rows.slice(0, ADMIN_PAGE_SIZE);
  const last = page.at(-1);
  return {
    rows: page,
    nextCursor: rows.length > ADMIN_PAGE_SIZE && last ? encodeCursor(keyOf(last)) : null,
  };
}
