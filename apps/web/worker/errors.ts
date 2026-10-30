import type { ContentfulStatusCode } from 'hono/utils/http-status';

/** Codes the API returns in `{ error: { code, message } }`. The SPA maps them in `ui/errors.ts`. */
export type ErrorCode =
  | 'not_found'
  | 'world_unavailable'
  | 'internal'
  | 'bad_request'
  | 'unauthorized'
  | 'handle_mismatch'
  | 'unavailable';

/** Thrown inside services; the one `onError` handler turns it into the API error shape. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: ContentfulStatusCode;

  constructor(
    code: ErrorCode,
    status: ContentfulStatusCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}
