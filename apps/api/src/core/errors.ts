export interface AppErrorOptions {
  /** Structured, safe-to-expose context (e.g. offending fields). */
  details?: unknown;
  /** i18n key used to localise the message for the caller. */
  messageKey?: string;
  cause?: unknown;
}

/**
 * The only error type application code should throw deliberately.
 *
 * `message` is the developer-facing fallback; when `messageKey` is set the
 * error middleware localises it via the request's Accept-Language.
 */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly details?: unknown;
  readonly messageKey?: string;
  /** Marks errors we raised on purpose, as opposed to crashes. */
  readonly isOperational = true;

  constructor(statusCode: number, code: string, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = options.details;
    this.messageKey = options.messageKey;

    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, AppError);
    }
  }

  static badRequest(message: string, options?: AppErrorOptions): AppError {
    return new AppError(400, 'BAD_REQUEST', message, options);
  }

  static unauthorized(message: string, options?: AppErrorOptions): AppError {
    return new AppError(401, 'UNAUTHORIZED', message, options);
  }

  static forbidden(message: string, options?: AppErrorOptions): AppError {
    return new AppError(403, 'FORBIDDEN', message, options);
  }

  static notFound(message: string, options?: AppErrorOptions): AppError {
    return new AppError(404, 'NOT_FOUND', message, { messageKey: 'errors.notFound', ...options });
  }

  static conflict(message: string, options?: AppErrorOptions): AppError {
    return new AppError(409, 'CONFLICT', message, options);
  }

  static internal(message: string, options?: AppErrorOptions): AppError {
    return new AppError(500, 'INTERNAL_ERROR', message, {
      messageKey: 'errors.internal',
      ...options,
    });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}
