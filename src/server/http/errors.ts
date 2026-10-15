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
