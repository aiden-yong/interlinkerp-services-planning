/**
 * Every error code Planning can return, documented in /openapi.json (backlog item 19). The contract reserves the
 * generic ones; the rest name a business rule. errors.test.ts fails when code uses a code missing from this list.
 */
export const ERROR_CODES = [
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'PERSON_REQUIRED', 'RESOURCE_NOT_FOUND', 'METHOD_NOT_ALLOWED', 'PAYLOAD_TOO_LARGE', 'RATE_LIMITED', 'INTERNAL_ERROR',
  'NOT_ON_ROSTER', 'ROSTER_UNAVAILABLE', 'LAST_MANAGER', 'ROLE_NAME_TAKEN',
  'SHIFT_CONFLICT', 'STALE_SHIFT', 'SHIFT_CHANGED', 'SHIFT_STARTED', 'SHIFT_TAKEN', 'UNDO_EXPIRED',
  'NOT_ELIGIBLE', 'OWN_SHIFT', 'MODE_NOT_ACTIVE', 'ALREADY_UP_FOR_SWITCH', 'NOT_UP_FOR_SWITCH', 'OUTSIDE_UNASSIGN_WINDOW',
  'COUNTRY_NOT_SET', 'HOLIDAY_PROVIDER_NOT_CONFIGURED', 'PROVIDER_HOLIDAY',
  'RECURRENCE_PATTERN_SCOPE',
  'TEMPLATE_NAME_TAKEN',
  'SPLIT_OUTSIDE', 'BREAK_DOES_NOT_FIT',
  'PERIOD_TOO_LONG',
] as const;

/** An expected failure that becomes a non-2xx response with the error envelope (contract SS-5). */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details: unknown = null,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'HttpError';
  }

  static unauthorized(message: string): HttpError {
    return new HttpError(401, 'UNAUTHORIZED', message);
  }

  static forbidden(message: string, code = 'FORBIDDEN', details: unknown = null): HttpError {
    return new HttpError(403, code, message, details);
  }

  static notFound(message: string): HttpError {
    return new HttpError(404, 'RESOURCE_NOT_FOUND', message);
  }

  static conflict(code: string, message: string, details: unknown = null): HttpError {
    return new HttpError(409, code, message, details);
  }

  /** @param fields field name -> what is wrong */
  static validation(fields: Record<string, string>): HttpError {
    return new HttpError(422, 'VALIDATION_ERROR', 'The request has invalid fields.', fields);
  }
}
