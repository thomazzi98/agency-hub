import { ZodError } from 'zod';

export interface ErrorDetail {
  field: string;
  issue: string;
}

export interface ErrorPayload {
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
}

/**
 * `code` is the stable English identifier the frontend branches on; `message` is
 * pt-BR text that is always safe to display (docs/sdd/15-api-conventions.md).
 * Anything that would leak an implementation detail must not be constructed as an
 * AppError — it becomes a generic 500 in the error handler instead.
 */
export class AppError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
  }

  toPayload(): ErrorPayload {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export const badRequest = (code: string, message: string, details?: ErrorDetail[]): AppError =>
  new AppError(400, code, message, details);

export const unauthorized = (code: string, message: string): AppError =>
  new AppError(401, code, message);

export const forbidden = (code: string, message: string): AppError =>
  new AppError(403, code, message);

export const notFound = (code: string, message: string): AppError =>
  new AppError(404, code, message);

export const conflict = (code: string, message: string): AppError =>
  new AppError(409, code, message);

export const unprocessable = (code: string, message: string): AppError =>
  new AppError(422, code, message);

export const tooManyRequests = (code: string, message: string): AppError =>
  new AppError(429, code, message);

export function validationErrorFrom(error: ZodError): AppError {
  const details = error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    issue: issue.code,
  }));
  return badRequest(
    'validation_error',
    'Dados inválidos. Verifique os campos destacados.',
    details,
  );
}
